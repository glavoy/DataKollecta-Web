import JSZip from "jszip";

import { parseSurveyDocument } from "@/lib/xmlParser";

/** The parts of an uploaded survey_manifest.gistx the portal reads.
 *
 *  Untrusted input: this is a file a user picked off disk, so everything is
 *  optional and every field is validated before use. */
export interface UploadedManifest {
  surveyId?: string;
  surveyName?: string;
  databaseName?: string;
  description?: string;
  crfs?: Record<string, unknown>[];
}

/** A `crfs` row ready to insert, minus the ids the caller supplies. */
export type CrfRow = Record<string, unknown>;

/**
 * Reads and validates `survey_manifest.gistx` out of an uploaded zip.
 *
 * Split out of `ProjectDetail.tsx` for a reason the repo already learned the
 * hard way. `crfs` is optional on the manifest, and the check that it is
 * present and non-empty used to live in `handleFileUpload` while the loop that
 * iterated it lived in `performSurveyUpload` -- a different function, so
 * nothing at the loop guaranteed the check had run. Turning on `strict` is
 * what surfaced it, and the comment recording that is still in
 * `tsconfig.app.json`. Keeping the validation and the use in one module is the
 * structural version of that fix: this function is the only way to obtain a
 * manifest, and it refuses to return one that has not been checked.
 *
 * Throws with the message the user should see. The caller catches and toasts.
 */
export async function readManifestFromZip(
  // The browser hands this a `File`. The wider union is what JSZip actually
  // accepts, and it is what lets this be tested without a DOM -- Node's own
  // `Blob` is not a type JSZip recognises, so a test builds an ArrayBuffer.
  file: Blob | ArrayBuffer | Uint8Array,
): Promise<{ zip: JSZip; manifest: UploadedManifest; surveyId: string }> {
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(file);

  // A direct lookup rather than a forEach that mutates a variable.
  // TypeScript cannot see that a callback ran, so under strict the
  // variable stayed narrowed to `null` and the later `.async("string")`
  // resolved against `never`. `JSZipObject.name` is the same relative
  // path forEach hands out.
  const manifestFile = Object.values(loadedZip.files).find((f) =>
    f.name.toLowerCase().endsWith("survey_manifest.gistx"),
  );

  if (!manifestFile) {
    throw new Error("Invalid ZIP: survey_manifest.gistx is missing.");
  }

  const manifestContent = await manifestFile.async("string");
  const manifest = JSON.parse(manifestContent) as UploadedManifest;

  if (!manifest.crfs || !Array.isArray(manifest.crfs) || manifest.crfs.length === 0) {
    throw new Error("Invalid Manifest: 'crfs' array is missing or empty.");
  }

  // Get surveyId from manifest (this is the unique identifier)
  const surveyId = manifest.surveyId;
  if (!surveyId) {
    throw new Error("Invalid Manifest: 'surveyId' is required.");
  }

  return { zip: loadedZip, manifest, surveyId };
}

/**
 * Turns each `crfs` entry into a row for the `crfs` table, reading that form's
 * XML out of the same zip.
 *
 * A form named in the manifest whose `.xml` is absent from the zip is skipped
 * with a console warning rather than failing the upload -- unchanged from the
 * behaviour this was lifted from.
 */
export async function buildCrfRows({
  zip,
  manifest,
  surveyPackageId,
  projectId,
}: {
  zip: JSZip;
  manifest: UploadedManifest;
  surveyPackageId: string;
  projectId: string;
}): Promise<CrfRow[]> {
  const crfsToInsert: CrfRow[] = [];

  for (const crfEntry of manifest.crfs ?? []) {
    const xmlFileName = `${crfEntry.tablename}.xml`;
    const xmlFile = Object.values(zip.files).find((file) =>
      file.name.toLowerCase().endsWith(xmlFileName.toLowerCase()),
    );

    if (!xmlFile) {
      console.warn(`XML file ${xmlFileName} not found in ZIP.`);
      continue;
    }

    const xmlContent = await xmlFile.async("string");
    // Reserved system variables and the end screen are stripped here; they
    // are re-added at generation time, so an imported package can be saved
    // and re-exported without accumulating duplicates.
    const { questions, endText } = parseSurveyDocument(xmlContent);

    // Store additional form config in id_config._formConfig for retrieval
    const formConfig = {
      incrementField: crfEntry.incrementfield,
      repeatCountField: crfEntry.repeat_count_field,
      entry_condition: crfEntry.entry_condition,
      endOfQuestionsText: endText,
    };

    crfsToInsert.push({
      survey_package_id: surveyPackageId,
      project_id: projectId,
      table_name: crfEntry.tablename,
      display_name: crfEntry.displayname,
      display_order: crfEntry.display_order || 0,
      is_base: crfEntry.isbase === 1,
      primary_key: crfEntry.primarykey || null,
      linking_field: crfEntry.linkingfield || null,
      parent_table: crfEntry.parenttable || null,
      id_config: crfEntry.idconfig
        ? { ...(crfEntry.idconfig as Record<string, unknown>), _formConfig: formConfig }
        : { _formConfig: formConfig },
      display_fields: crfEntry.display_fields || null,
      auto_start_repeat: crfEntry.auto_start_repeat || 0,
      repeat_enforce_count: crfEntry.repeat_enforce_count || 1,
      fields: questions,
    });
  }

  return crfsToInsert;
}
