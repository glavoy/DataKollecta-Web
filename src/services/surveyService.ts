import { supabase } from "@/lib/supabase";
import { SurveyPackage, CsvFile, IdConfig } from "@/types/survey";
import { generateManifestGistx } from "@/lib/xml/manifest";
import { buildSurveyZip } from "@/lib/xml/package";
import { normalizeStoredQuestions } from "@/lib/xml/normalize";
import { SurveyStatus, isSurveyLocked } from "@/lib/surveyStatus";
import { SurveyLockedError, findSurveyIdConflict, surveyIdConflictMessage } from "@/lib/errors/surveyErrors";
import { versionedSurveyId, versionedDisplayName, nextVersionNumber } from "@/lib/surveyVersion";
import { fetchAllRows, chunkIds } from "@/lib/supabasePaging";
import JSZip from "jszip";

export const surveyService = {
  /**
   * Throws SurveyLockedError if the given survey_packages row exists and its
   * status locks content edits (see LOCKED_STATUSES in surveyStatus.ts). A
   * missing row is treated as "not yet created" and allowed through -- the
   * caller is about to insert it.
   *
   * This is a preflight, not the enforcement -- the DB trigger
   * (enforce_survey_package_lifecycle / enforce_crf_parent_unlocked) is the
   * real backstop and fires regardless of whether this ran. The preflight
   * exists so saveSurveyPackage can refuse BEFORE overwriting the storage
   * zip, which the trigger cannot undo.
   */
  async assertEditable(surveyPackageId: string): Promise<void> {
    const { data: existing, error } = await supabase
      .from('survey_packages')
      .select('id, name, display_name, status')
      .eq('id', surveyPackageId)
      .maybeSingle();

    if (error) throw error;
    if (!existing) return; // New survey -- nothing to protect yet.

    if (isSurveyLocked(existing.status as SurveyStatus)) {
      throw new SurveyLockedError(
        existing.name as string,
        (existing.display_name as string) ?? (existing.name as string),
        existing.status as SurveyStatus
      );
    }
  },

  /**
   * The lineage an existing row already belongs to, or a fresh one for a
   * survey being created. An ordinary designer save must never MOVE a survey
   * between lineages or renumber it -- the version it belongs to was decided
   * when the row was created, and for a locked survey the DB trigger refuses
   * the change outright.
   */
  async resolveLineage(
    surveyPackageId: string,
    surveyName: string
  ): Promise<{ surveyCode: string; version: number }> {
    const { data: existing, error } = await supabase
      .from('survey_packages')
      .select('survey_code, version')
      .eq('id', surveyPackageId)
      .maybeSingle();

    if (error) throw error;
    if (existing?.survey_code) {
      return {
        surveyCode: existing.survey_code as string,
        version: (existing.version as number) ?? 1,
      };
    }

    // A survey being created starts its own lineage, keyed by its own
    // Survey ID, at version 1.
    return { surveyCode: surveyName, version: 1 };
  },

  /**
   * Every version of one survey, newest first. The (project_id, survey_code)
   * index backs this.
   */
  async getLineageVersions(projectId: string, surveyCode: string) {
    const { data, error } = await supabase
      .from('survey_packages')
      .select('id, name, display_name, survey_code, version, version_date, status, manifest')
      .eq('project_id', projectId)
      .eq('survey_code', surveyCode)
      .order('version', { ascending: false });

    if (error) throw error;
    return data || [];
  },

  /**
   * The lineage in this project whose versions declare `databaseName`, or null.
   *
   * This is how an uploaded ZIP finds the survey it is a version of. Matching
   * is on databaseName alone -- never on a naming convention, never on
   * surveyId -- because databaseName is the thing that actually decides data
   * continuity on the device: DbService opens one SQLite file per
   * databaseName, so two packages declaring the same one ARE the same dataset
   * whatever they are called.
   *
   * enforce_survey_database_binding guarantees at most one lineage can match,
   * which is what lets the upload flow treat the result as a determination
   * rather than a question to put to the user.
   */
  async findLineageByDatabaseName(projectId: string, databaseName: string) {
    if (!databaseName) return null;

    const { data, error } = await supabase
      .from('survey_packages')
      .select('id, name, display_name, survey_code, version, version_date, status')
      .eq('project_id', projectId)
      .eq('manifest->>databaseName', databaseName)
      .order('version', { ascending: false });

    if (error) throw error;
    if (!data || data.length === 0) return null;

    return {
      surveyCode: data[0].survey_code as string,
      displayName: data[0].display_name as string,
      versions: data,
      nextVersion: nextVersionNumber(data as { version: number }[]),
      latestId: data[0].id as string,
    };
  },

  /**
   * Saves the survey package (forms/CRFs) to a new survey_packages record.
   * Creates a new survey version with display_name and name.
   */
  async saveSurveyPackage(
    pkg: SurveyPackage,
    projectId: string,
    userId: string,
    surveyDisplayName: string,
    surveyName: string,
    status: SurveyStatus = 'draft',
    lineage?: { surveyCode: string; version: number }
  ) {
    // Which survey this package is a version OF. Resolved here rather than
    // pushed onto every caller: the designer neither knows nor should decide
    // it, and the upsert below lists its columns explicitly, so a missing
    // survey_code would null out the lineage on every ordinary save (and
    // fail the NOT NULL). Callers that genuinely own the answer --
    // createSurveyVersion, duplicateSurveyPackage, and the ZIP upload --
    // pass it explicitly.
    const resolvedLineage = lineage ?? (await this.resolveLineage(pkg.id, surveyName));
    // 0. Refuse before touching storage. The upload below is `upsert: true`
    // and happens BEFORE the DB write -- if a locked survey's save reached
    // that upload, the deployed package's zip would already be overwritten
    // by the time the DB trigger rejected the update, and the next phone to
    // log in would download the edited content under an unchanged
    // "deployed" row (app-login re-signs from zip_file_path on every
    // login). This preflight is a TOCTOU-narrowed guard, not a replacement
    // for the trigger.
    await this.assertEditable(pkg.id);

    // 0.5. Refuse before touching storage, for the same TOCTOU reason as
    // assertEditable above -- but that check alone is not enough. A
    // genuinely NEW row (different pkg.id) passes assertEditable even when
    // its chosen Survey ID text collides with an EXISTING row's, because
    // assertEditable only ever looks up pkg.id. The storage upload below
    // computes its path purely from the sanitized surveyName, with
    // upsert:true -- so it would silently overwrite that other survey's
    // zip before the DB's unique-constraint error (which only fires
    // afterward, in step 3) ever surfaces. This is exactly how one
    // deployed survey's zip was destroyed on 2026-08-23: a brand-new
    // throwaway survey was saved with the same Survey ID text, its tiny
    // zip overwrote the real one, and the save then failed with a clean
    // "already exists" error -- which looked like nothing had happened,
    // while the damage was already done.
    const conflict = await findSurveyIdConflict(surveyName, projectId, userId, { excludeId: pkg.id });
    if (conflict) {
      throw new Error(surveyIdConflictMessage(conflict));
    }

    // 1. Generate the Zip content -- same builder the download button uses, so
    // what is stored and what a user downloads cannot drift apart.
    const manifestJson = generateManifestGistx(pkg);
    const zipBlob = await buildSurveyZip(pkg);

    // 2. Upload Zip to Storage (Bucket: 'surveys')
    // Use surveyId as the filename (surveyId should include version info like geoff_css_2026-01-24)
    const sanitizedName = surveyName.replace(/[^a-z0-9_-]/gi, '_').toLowerCase();
    const filePath = `${projectId}/${sanitizedName}.zip`;

    // `upsert: true` overwrites the object atomically from the client's
    // perspective. The previous implementation deleted the object first and
    // uploaded second -- if the upload then failed (a dropped connection
    // mid-zip is exactly the kind of thing that fails), the previous zip
    // was already gone. That matters beyond "no download link": CSV content
    // lives only inside this zip (see `loadCsvFilesFromZip`), so a failed
    // save after a delete-then-upload could permanently destroy every CSV
    // in the survey while the database row still pointed at nothing.
    const { error: uploadError } = await supabase.storage
      .from('surveys')
      .upload(filePath, zipBlob, { upsert: true, contentType: 'application/zip' });

    if (uploadError) throw uploadError;

    // 3. Create or update 'survey_packages' table record
    const { data: surveyPackage, error: surveyError } = await supabase
      .from('survey_packages')
      .upsert({
        id: pkg.id, // Use existing ID if updating, or new UUID if creating
        project_id: projectId,
        // The surveyName/surveyDisplayName PARAMETERS, not pkg.surveyId/pkg.name
        // directly -- the caller (SurveyDesigner.handleSaveToProject) computes a
        // fallback from the display name when pkg.surveyId is blank, specifically
        // so a survey can never be published with an empty Survey ID. Reading
        // pkg.surveyId/pkg.name here instead silently discarded that fallback and
        // let a blank id/name reach the database untouched -- which is exactly
        // how one already-deployed survey ended up with name = ''.
        name: surveyName,
        display_name: surveyDisplayName,
        survey_code: resolvedLineage.surveyCode,
        version: resolvedLineage.version,
        version_date: new Date().toISOString().split('T')[0],
        description: null, // Optional description field
        manifest: JSON.parse(manifestJson),
        zip_file_path: filePath,
        status: status,
        created_by: userId,
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (surveyError) throw surveyError;

    // 4. Update/Insert individual CRFs (linked to survey_package)
    for (const form of pkg.forms) {
      // Store form configuration including additional fields in the fields JSONB
      // We'll include form-level config as a special entry
      // The crfs table has no columns for these, so they ride along inside
      // id_config. See DESIGN.md for why this indirection exists.
      const formConfig = {
        incrementField: form.incrementField,
        repeatCountField: form.repeatCountField,
        entry_condition: form.entry_condition,
        endOfQuestionsText: form.endOfQuestionsText,
      };

      const { error: crfError } = await supabase
        .from('crfs')
        .upsert({
          id: form.id,
          survey_package_id: surveyPackage.id, // Link to survey package
          project_id: projectId,
          table_name: form.tablename,
          display_name: form.displayname,
          display_order: form.displayOrder,
          parent_table: form.parenttable,
          linking_field: form.linkingfield,
          primary_key: form.primaryKey,
          id_config: form.idconfig ? {
            ...form.idconfig,
            // Also store additional form config here for portability
            _formConfig: formConfig
          } : { _formConfig: formConfig },
          display_fields: form.displayFields,
          fields: form.questions, // JSONB column
          auto_start_repeat: form.autoStartRepeat || 0,
          repeat_enforce_count: form.repeatEnforceCount,
        });

      if (crfError) throw crfError;
    }

    // 4b. Delete `crfs` rows for forms no longer in the package. Without
    // this, deleting a form in the designer only removes it from local
    // state -- the row survives, and `getSurveyPackage` selects every row
    // for the survey, so the "deleted" form comes back on the next load.
    // Skipped when the package has no forms at all: that shape is almost
    // certainly a bug upstream (a load gone wrong, an adoption race), and
    // mass-deleting every CRF on the strength of it is not recoverable.
    if (pkg.forms.length > 0) {
      const currentFormIds = pkg.forms.map(f => f.id);
      const { error: pruneError } = await supabase
        .from('crfs')
        .delete()
        .eq('survey_package_id', surveyPackage.id)
        .not('id', 'in', `(${currentFormIds.join(',')})`);

      if (pruneError) throw pruneError;
    }

    // 5. Store CSV file metadata in survey_packages manifest for retrieval
    // CSV content is stored in the zip file; metadata stored in manifest
    // We'll update the manifest to include csvFiles list
    if (pkg.csvFiles && pkg.csvFiles.length > 0) {
      const manifestWithCsv = {
        ...JSON.parse(manifestJson),
        csvFiles: pkg.csvFiles.map(f => f.filename)
      };

      await supabase
        .from('survey_packages')
        .update({ manifest: manifestWithCsv })
        .eq('id', surveyPackage.id);
    }

    return surveyPackage;
  },

  /**
   * Loads the survey package for a specific survey_package_id.
   * Returns the survey with all its CRFs/questionnaires.
   */
  async getSurveyPackage(surveyPackageId: string): Promise<{ pkg: SurveyPackage; serverUpdatedAt: string | null; status: SurveyStatus; surveyCode: string; version: number }> {
    // 1. Fetch the survey package
    const { data: survey, error: surveyError } = await supabase
      .from('survey_packages')
      .select('*, projects(name)')
      .eq('id', surveyPackageId)
      .single();

    if (surveyError) throw surveyError;

    // 2. Fetch the CRFs associated with this survey package
    const { data: crfs, error: crfsError } = await supabase
      .from('crfs')
      .select('*')
      .eq('survey_package_id', surveyPackageId)
      .order('display_order');

    if (crfsError) throw crfsError;

    // 3. Load CSV files from the zip if available
    let csvFiles: CsvFile[] = [];
    if (survey.zip_file_path) {
      csvFiles = await this.loadCsvFilesFromZip(survey.zip_file_path);
    }

    // 4. Construct the SurveyPackage object
    const manifest = survey.manifest as {
      databaseName?: string;
      xmlFiles?: string[];
      crfs?: unknown[];
    } | null;
    const pkg: SurveyPackage = {
      id: survey.id,
      surveyId: survey.name, // The logical ID
      name: survey.display_name, // The display name
      databaseName: manifest?.databaseName || `${survey.name}.sqlite`,
      xmlFiles: manifest?.xmlFiles || [],
      csvFiles: csvFiles,
      forms: (crfs || []).map(crf => {
        // Extract additional form config from idconfig._formConfig if stored there
        // JSONB again. `_formConfig` is this portal's own addition to the
        // idconfig object -- the app never reads it -- and is stripped below
        // before the config goes back out.
        // The stored idconfig is an IdConfig plus `_formConfig`, this
        // portal's own extension -- the app never reads that key, and it is
        // stripped again below. Only these four fields are read off it.
        const idConfig = crf.id_config as
          | (Partial<IdConfig> & {
              _formConfig?: {
                endOfQuestionsText?: string;
                incrementField?: string;
                repeatCountField?: string;
                entry_condition?: string;
              };
            })
          | null;
        const formConfig = idConfig?._formConfig || {};

        // Clean idconfig by removing _formConfig before returning
        const cleanIdConfig = idConfig ? { ...idConfig } : undefined;
        if (cleanIdConfig?._formConfig) {
          delete cleanIdConfig._formConfig;
        }

        // Normalize empty strings to undefined for optional fields
        const normalizeEmpty = (val: string | null | undefined) =>
          val && val.trim() !== '' ? val : undefined;

        // Upgrade on read: packages saved before the type model gained
        // recursive calculations and an explicit response mode would
        // otherwise emit XML the app misreads. Also strips any reserved
        // system field or end_of_questions row a package saved before the
        // import-side strip (fc08169) still carries -- see the doc comment
        // on normalizeStoredQuestions.
        const normalized = normalizeStoredQuestions(crf.fields);

        return {
          id: crf.id,
          tablename: crf.table_name,
          displayname: crf.display_name,
          displayOrder: crf.display_order,
          parenttable: normalizeEmpty(crf.parent_table),
          linkingfield: normalizeEmpty(crf.linking_field),
          displayFields: normalizeEmpty(crf.display_fields),
          idconfig: cleanIdConfig?.prefix !== undefined ||
                    (cleanIdConfig?.fields?.length ?? 0) > 0
            ? (cleanIdConfig as IdConfig)
            : undefined,
          questions: normalized.questions,
          // _formConfig is the explicit setting; a recovered end-screen
          // string pulled out of a stray stored row is the fallback.
          endOfQuestionsText:
            normalizeEmpty(formConfig.endOfQuestionsText) ?? normalized.endText,
          autoStartRepeat: typeof crf.auto_start_repeat === 'number' ? crf.auto_start_repeat : (crf.auto_start_repeat ? 1 : 0),
          repeatEnforceCount: crf.repeat_enforce_count || 1,
          primaryKey: normalizeEmpty(crf.primary_key),
          incrementField: normalizeEmpty(formConfig.incrementField) || normalizeEmpty(crf.increment_field),
          repeatCountField: normalizeEmpty(formConfig.repeatCountField),
          entry_condition: normalizeEmpty(formConfig.entry_condition) || normalizeEmpty(crf.entry_condition),
        };
      })
    };
    return {
      pkg,
      serverUpdatedAt: survey.updated_at ?? null,
      status: survey.status as SurveyStatus,
      surveyCode: (survey.survey_code as string) ?? survey.name,
      version: (survey.version as number) ?? 1,
    };
  },

  /**
   * Load CSV files from a zip file in storage
   */
  async loadCsvFilesFromZip(zipFilePath: string): Promise<CsvFile[]> {
    try {
      const { data, error } = await supabase.storage
        .from('surveys')
        .download(zipFilePath);

      if (error || !data) {
        console.error('Error downloading zip for CSV extraction:', error);
        return [];
      }

      const zip = new JSZip();
      const loadedZip = await zip.loadAsync(data);
      const csvFiles: CsvFile[] = [];

      const filePromises: Promise<void>[] = [];
      loadedZip.forEach((relativePath, file) => {
        if (relativePath.toLowerCase().endsWith('.csv') && !file.dir) {
          const promise = file.async('string').then(content => {
            csvFiles.push({
              id: crypto.randomUUID(),
              filename: relativePath,
              content: content
            });
          });
          filePromises.push(promise);
        }
      });

      await Promise.all(filePromises);
      return csvFiles;
    } catch (err) {
      console.error('Error loading CSV files from zip:', err);
      return [];
    }
  },

  /**
   * Gets the most recent active survey package for a project.
   * Useful for loading the latest survey version.
   */
  async getLatestSurveyForProject(projectId: string): Promise<{ pkg: SurveyPackage; serverUpdatedAt: string | null } | null> {
    // Fetch the most recent survey package
    const { data: survey, error: surveyError } = await supabase
      .from('survey_packages')
      .select('*')
      .eq('project_id', projectId)
      .order('version_date', { ascending: false })
      .limit(1)
      .single();

    if (surveyError) {
      if (surveyError.code === 'PGRST116') {
        // No survey found
        return null;
      }
      throw surveyError;
    }

    return this.getSurveyPackage(survey.id);
  },

  /**
   * Gets all survey packages for a project.
   * Returns list of all versions.
   */
  async getAllSurveysForProject(projectId: string) {
    const { data: surveys, error } = await supabase
      .from('survey_packages')
      .select('*, crfs(count)')
      .eq('project_id', projectId)
      .order("version_date", { ascending: false });

    if (error) throw error;
    return surveys || [];
  },

  /**
   * Fetch ALL surveys across ALL projects.
   */
  async getAllSurveys() {
    const { data: surveys, error } = await supabase
      .from('survey_packages')
      .select('*, projects(name), crfs(count)')
      .order('updated_at', { ascending: false });

    if (error) throw error;
    return surveys || [];
  },

  /**
   * Generates a signed download URL for a survey package zip file.
   * valid for 1 hour.
   */
  async getSurveyDownloadUrl(filePath: string): Promise<string | null> {
    const { data, error } = await supabase.storage
      .from('surveys')
      .createSignedUrl(filePath, 3600);

    if (error) {
      console.error('Error generating download URL:', error);
      return null;
    }

    return data.signedUrl;
  },

  /**
   * Moves a survey to a new lifecycle status. This is the ONLY place status
   * should be written -- it sends exactly {status, updated_at, published_at?}
   * and nothing else, because the DB lock trigger's content-change check
   * compares every other column between OLD and NEW; sending along a stale
   * version_date or manifest here would trip it even though nothing about
   * the survey's content actually changed.
   *
   * The DB trigger (enforce_survey_package_lifecycle) is the authority on
   * which transitions are legal; this does not duplicate that check
   * client-side beyond what the UI needs to decide which buttons to show
   * (see LEGAL_TRANSITIONS in surveyStatus.ts).
   */
  async updateSurveyStatus(surveyPackageId: string, next: SurveyStatus): Promise<void> {
    const update: Record<string, unknown> = {
      status: next,
      updated_at: new Date().toISOString(),
    };
    // Set once, on the first move into 'deployed' -- left alone on every
    // other transition, including a later deployed -> complete -> deployed.
    if (next === 'deployed') {
      update.published_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('survey_packages')
      .update(update)
      .eq('id', surveyPackageId);

    if (error) throw error;
  },

  /**
   * Duplicates a survey into a new, independent draft with a new survey ID.
   * This is the sanctioned way to revise a locked (deployed/complete)
   * survey -- edits are refused in place, so a copy is the only path
   * forward. Works for surveys created via either path (designer save or
   * ZIP upload), since both write `crfs` rows in the same shape that
   * getSurveyPackage reconstructs from.
   *
   * Every id in the copied package is regenerated. This is the sharp edge:
   * saveSurveyPackage upserts survey_packages on pkg.id and crfs on
   * form.id, so reusing the SOURCE's ids here would silently overwrite the
   * source's row (and repoint its forms at the copy) instead of creating a
   * new one. Field NAMES are left untouched -- skip logic, linkingfield,
   * primaryKey, display_fields and the generated XML all key off names, not
   * ids.
   *
   * databaseName defaults to `${newSurveyId}.sqlite` rather than carrying
   * over the source's -- see the design note in the lifecycle plan. The
   * "database name must stay stable" rule is about versions of the SAME
   * survey id, which the unique indexes on `name` make impossible anyway;
   * a duplicate is a different survey, and sharing a database file across
   * two different surveys' schemas is corruption (colliding tables, one
   * shared id sequence, ids from the copy minted under the source's
   * counter), not a convenience. Callers may still override it.
   */
  async duplicateSurveyPackage(args: {
    sourceId: string;
    targetProjectId: string;
    newSurveyId: string;
    newDisplayName: string;
    userId: string;
    databaseName?: string;
  }) {
    const { pkg: source } = await this.getSurveyPackage(args.sourceId);

    const copy: SurveyPackage = {
      ...source,
      id: crypto.randomUUID(),
      surveyId: args.newSurveyId,
      name: args.newDisplayName,
      databaseName: args.databaseName || `${args.newSurveyId}.sqlite`,
      csvFiles: (source.csvFiles || []).map(f => ({ ...f, id: crypto.randomUUID() })),
      forms: source.forms.map(form => ({
        ...form,
        id: crypto.randomUUID(),
        // Question ids are remapped; field NAMES are left alone on purpose
        // (see the doc comment above) -- only .id changes here.
        questions: form.questions.map(q => ({ ...q, id: crypto.randomUUID() })),
      })),
    };

    // A fork starts its OWN lineage at version 1. Inheriting the source's
    // survey_code here would be actively wrong: the copy carries a different
    // databaseName (see the doc comment above), so its data lives in a
    // different SQLite file on every device -- grouping the two as versions
    // of one survey would merge two datasets in the portal that are not
    // merged anywhere else. Use createSurveyVersion when the intent is a
    // revision rather than a fork.
    const saved = await this.saveSurveyPackage(
      copy,
      args.targetProjectId,
      args.userId,
      args.newDisplayName,
      args.newSurveyId,
      'draft',
      { surveyCode: args.newSurveyId, version: 1 }
    );

    const { error } = await supabase
      .from('survey_packages')
      .update({ copied_from: args.sourceId })
      .eq('id', saved.id);

    if (error) throw error;

    return saved;
  },

  /**
   * Creates the next VERSION of an existing survey: a new editable draft that
   * belongs to the same survey and collects into the same dataset.
   *
   * This is the sanctioned way to revise a deployed survey. It is not the same
   * operation as duplicateSurveyPackage, and the difference is the whole point:
   *
   *   duplicate -> a different study.  New survey_code, new databaseName,
   *                its own dataset, subject-ID counters start from scratch.
   *   version   -> the same study.     Same survey_code, SAME databaseName,
   *                so the phone opens the existing SQLite file, ALTER TABLEs
   *                any new questions in, and the subject-ID counter continues.
   *
   * Carrying databaseName over is the load-bearing part. Regenerating it (as
   * duplicateSurveyPackage deliberately does) is exactly what made "add one
   * question to a deployed survey" split the data in two.
   *
   * Everything else follows duplicateSurveyPackage: every id in the copied
   * package is regenerated, because saveSurveyPackage upserts survey_packages
   * on pkg.id and crfs on form.id -- reusing the source's ids would overwrite
   * the source instead of creating a new row. Field NAMES are left untouched;
   * skip logic, linkingfield, primaryKey, display_fields and the generated XML
   * all key off names.
   *
   * The new version's Survey ID is minted as `${surveyCode}_v${n}` because the
   * designer owns the IDs it creates. A version arriving by ZIP upload keeps
   * its manifest's own surveyId instead -- see surveyVersion.ts.
   */
  async createSurveyVersion(args: {
    sourceId: string;
    projectId: string;
    userId: string;
  }) {
    const { pkg: source } = await this.getSurveyPackage(args.sourceId);

    const { data: sourceRow, error: sourceError } = await supabase
      .from('survey_packages')
      .select('survey_code, display_name')
      .eq('id', args.sourceId)
      .single();

    if (sourceError) throw sourceError;

    const surveyCode = sourceRow.survey_code as string;
    const siblings = await this.getLineageVersions(args.projectId, surveyCode);
    const version = nextVersionNumber(siblings as { version: number }[]);
    const newSurveyId = versionedSurveyId(surveyCode, version);

    // The version has to be DISTINGUISHABLE BY NAME, not just by id. This
    // name becomes the manifest's surveyName, which is what the phone lists
    // and what it stores as the active survey -- two versions sharing it
    // would show as two identical rows, and getActiveSurveyId would resolve
    // the choice to whichever folder the OS listed first. See
    // versionedDisplayName.
    const newDisplayName = versionedDisplayName(
      sourceRow.display_name as string,
      version
    );

    const next: SurveyPackage = {
      ...source,
      id: crypto.randomUUID(),
      surveyId: newSurveyId,
      // pkg.name is the DISPLAY name, and generateManifestGistx writes it
      // straight into the manifest as surveyName.
      name: newDisplayName,
      // databaseName is deliberately NOT regenerated -- it is what makes this
      // a version rather than a fork.
      databaseName: source.databaseName,
      csvFiles: (source.csvFiles || []).map(f => ({ ...f, id: crypto.randomUUID() })),
      forms: source.forms.map(form => ({
        ...form,
        id: crypto.randomUUID(),
        questions: form.questions.map(q => ({ ...q, id: crypto.randomUUID() })),
      })),
    };

    const saved = await this.saveSurveyPackage(
      next,
      args.projectId,
      args.userId,
      newDisplayName,
      newSurveyId,
      'draft',
      { surveyCode, version }
    );

    const { error } = await supabase
      .from('survey_packages')
      .update({ copied_from: args.sourceId })
      .eq('id', saved.id);

    if (error) throw error;

    return saved;
  },

  /**
   * Deletes a survey package and everything hanging off it, in order.
   *
   * Storage zip, then formchanges, then submissions, then crfs, then the
   * package row. Moved here from `ProjectDetail.handleDeleteSurvey` so the page
   * keeps the decision and the dialogs while this keeps the sequence.
   *
   * **The caller must refuse an undeletable survey before calling this.** The
   * database's own guard triggers only cover `crfs` and `survey_packages`,
   * which are the last two steps -- by the time one fires, the zip and every
   * submission are already gone, leaving a deployed row with no data behind it.
   * `isSurveyDeletable` is a preflight, not a nicety, and it stays at the call
   * site because refusing needs the survey's name and a toast.
   */
  async deleteSurveyCascade(args: {
    surveyId: string;
    zipFilePath: string | null;
  }): Promise<void> {
    const { surveyId, zipFilePath } = args;

    // Delete the zip file from storage first
    if (zipFilePath) {
      const { error: storageError } = await supabase.storage
        .from('surveys')
        .remove([zipFilePath]);

      if (storageError) {
        console.error("Error deleting file from storage:", storageError);
        // Don't throw - continue with database deletion even if storage fails
        // The file might already be deleted or not exist
      }
    }

    // Delete dependent Submissions and History. The submissions delete
    // below isn't row-capped (a DELETE with no representation isn't
    // subject to PostgREST's max_rows response cap), but this SELECT is
    // -- so it must be paged, or a survey with more than 1000 submissions
    // only has the first 1000 records' formchanges cleaned up, leaving
    // the rest to later brick project deletion (formchanges has no
    // ON DELETE CASCADE from projects).
    const submissionsData = await fetchAllRows<{ id: string; local_unique_id: string | null }>(
      (from, to) =>
        supabase
          .from('submissions')
          .select('id, local_unique_id')
          .eq('survey_package_id', surveyId)
          .range(from, to),
    );

    if (submissionsData.length > 0) {
      const recordUuids = submissionsData
        .map(s => s.local_unique_id)
        .filter((id): id is string => id !== null);

      if (recordUuids.length > 0) {
        // Chunked -- 1000+ UUIDs in one .in() exceeds a GET querystring's
        // practical length ceiling and fails as a 414.
        for (const chunk of chunkIds(recordUuids)) {
          await supabase.from('formchanges').delete().in('record_uuid', chunk);
        }
      }

      await supabase
        .from('submissions')
        .delete()
        .eq('survey_package_id', surveyId);
    }

    // Delete CRFs
    await supabase
      .from('crfs')
      .delete()
      .eq('survey_package_id', surveyId);

    // Delete Survey Package
    const { error } = await supabase
      .from('survey_packages')
      .delete()
      .eq('id', surveyId);

    if (error) throw error;
  },
};
