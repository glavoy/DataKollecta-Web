/**
 * Whole-document emission and parsing.
 */

import { XMLParser } from 'fast-xml-parser';
import type { SurveyForm, SurveyQuestion } from '@/types/survey';
import { el, renderDocument } from './emit';
import { emitQuestion, parseQuestion } from './question';
import { stripGeneratedQuestions, withSystemFields } from './systemFields';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Preserve leading zeros: an id of '096' must not become 96.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

export function generateFormXml(form: SurveyForm): string {
  const questions = withSystemFields(form.questions ?? [], form.endOfQuestionsText);
  return renderDocument(el('survey', {}, questions.map(emitQuestion)));
}

/**
 * Parse a survey document into the questions a person authored.
 *
 * The generated rows -- reserved system variables and the end screen -- are
 * stripped, so what gets persisted is only authored content and re-emitting
 * cannot accumulate duplicates.
 */
export function parseSurveyDocument(xml: string): {
  questions: SurveyQuestion[];
  endText?: string;
} {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const survey = parsed.survey as Record<string, unknown> | undefined;
  if (!survey) return { questions: [] };

  const raw = survey.question;
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []) as Record<string, unknown>[];

  return stripGeneratedQuestions(list.map((q, i) => parseQuestion(q, i)));
}

/**
 * Back-compatible entry point: just the authored questions.
 * Prefer `parseSurveyDocument` where the custom end-screen text matters.
 */
export function parseSurveyXml(xml: string): SurveyQuestion[] {
  return parseSurveyDocument(xml).questions;
}
