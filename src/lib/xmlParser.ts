/**
 * Compatibility shim.
 *
 * The parser now lives in `src/lib/xml/`. `parseSurveyDocument` is the fuller
 * entry point -- it also returns any customised end-of-survey wording, which
 * `parseSurveyXml` discards.
 */

export { parseSurveyXml, parseSurveyDocument } from './xml/form';
