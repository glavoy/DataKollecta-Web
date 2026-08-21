/**
 * Survey package (zip) assembly.
 *
 * One implementation, used by both the download button and the Supabase save
 * path -- those had drifted into two copies that disagreed about the filename.
 */

import JSZip from 'jszip';
import type { SurveyPackage } from '@/types/survey';
import { generateFormXml } from './form';
import { generateManifestGistx } from './manifest';

/** Flat archive: manifest, one XML per form, then any CSVs. No directories. */
export async function buildSurveyZip(pkg: SurveyPackage): Promise<Blob> {
  const zip = new JSZip();

  zip.file('survey_manifest.gistx', generateManifestGistx(pkg));

  for (const form of pkg.forms) {
    zip.file(`${form.tablename}.xml`, generateFormXml(form));
  }

  for (const csv of pkg.csvFiles ?? []) {
    zip.file(csv.filename, csv.content);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function surveyZipFilename(pkg: SurveyPackage): string {
  const base = pkg.surveyId || pkg.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  return `${base}.zip`;
}

export function downloadFile(content: string, filename: string, type = 'text/xml'): void {
  triggerDownload(new Blob([content], { type }), filename);
}

export async function downloadSurveyZip(pkg: SurveyPackage): Promise<void> {
  triggerDownload(await buildSurveyZip(pkg), surveyZipFilename(pkg));
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
