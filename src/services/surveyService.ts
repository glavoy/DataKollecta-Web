import { supabase } from "@/lib/supabase";
import { SurveyPackage, CsvFile } from "@/types/survey";
import { generateManifestGistx } from "@/lib/xml/manifest";
import { buildSurveyZip } from "@/lib/xml/package";
import { normalizeStoredQuestions } from "@/lib/xml/normalize";
import JSZip from "jszip";

export const surveyService = {
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
    status: 'draft' | 'active' | 'ready' = 'draft'
  ) {
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
        name: pkg.surveyId, // Use pkg.surveyId for the name column
        display_name: pkg.name, // Use pkg.name for the display_name column
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
  async getSurveyPackage(surveyPackageId: string): Promise<{ pkg: SurveyPackage; serverUpdatedAt: string | null }> {
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
    const manifest = survey.manifest as any;
    const pkg: SurveyPackage = {
      id: survey.id,
      surveyId: survey.name, // The logical ID
      name: survey.display_name, // The display name
      databaseName: manifest?.databaseName || `${survey.name}.sqlite`,
      xmlFiles: manifest?.xmlFiles || [],
      csvFiles: csvFiles,
      forms: (crfs || []).map(crf => {
        // Extract additional form config from idconfig._formConfig if stored there
        const idConfig = crf.id_config as any;
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
          idconfig: cleanIdConfig?.prefix !== undefined || cleanIdConfig?.fields?.length > 0
            ? cleanIdConfig
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
    return { pkg, serverUpdatedAt: survey.updated_at ?? null };
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
  }
};
