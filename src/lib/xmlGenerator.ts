/**
 * Compatibility shim.
 *
 * The generator now lives in `src/lib/xml/`, split by concern. This file keeps
 * the original import path working; prefer importing from `@/lib/xml/...`
 * directly in new code.
 */

export { generateFormXml } from './xml/form';
export { generateManifestGistx, buildManifest } from './xml/manifest';
export {
  buildSurveyZip,
  downloadFile,
  downloadSurveyZip,
  surveyZipFilename,
} from './xml/package';
