/**
 * The validation engine's shared vocabulary.
 *
 * This ports the survey-correctness rules SurveyGen (the Excel path)
 * enforces on every data dictionary -- ~97 checks that block XML generation
 * outright. The web designer has never had an equivalent, and the gap is not
 * theoretical: a logic check referencing a field defined *later* in the form
 * shipped through this designer to a real device before anyone noticed. See
 * the plan this engine was built from for the full rationale.
 */

/**
 * Stable, dot-namespaced identifiers, collected in one catalogue rather than
 * scattered string literals so a rule id typo is a compile error and there is
 * one place that enumerates every rule this engine knows about.
 */
export const RULE = {
  // identity
  fieldnameEmpty: 'question.fieldname.empty',
  fieldnameLeadingDigit: 'question.fieldname.leadingDigit',
  fieldnameLeadingUnderscore: 'question.fieldname.leadingUnderscore',
  fieldnameCharset: 'question.fieldname.charset',
  fieldnameReserved: 'question.fieldname.reserved',
  fieldnameDuplicate: 'question.fieldname.duplicate',
  textRequired: 'question.text.required',

  // shape
  maskOnNonText: 'question.mask.nonText',
  optionalOnNonText: 'question.optional.nonText',
  maxCharsRequired: 'question.maxCharacters.required',
  maxCharsHourmin: 'question.maxCharacters.hourmin',
  hourminHasRange: 'question.range.hourmin',
  numericRangeHalfSet: 'question.numericCheck.halfSet',
  numericRangeInverted: 'question.numericCheck.inverted',
  dateRangeMissing: 'question.dateRange.missing',
  dateRangeFormat: 'question.dateRange.format',
  fieldTypeInvalidForQuestionType: 'question.fieldtype.invalidForQuestionType',
  specialAnswerCollides: 'question.specialAnswers.collides',
  specialAnswerUnconventional: 'question.specialAnswers.unconventional',

  // responses
  selectionNoOptions: 'question.responses.none',
  optionValueDuplicate: 'question.responses.duplicateValue',
  optionLabelBlank: 'question.responses.blankLabel',
  dynamicCsvNoFile: 'question.dynamicResponses.csvNoFile',
  dynamicDbNoTable: 'question.dynamicResponses.dbNoTable',
  dynamicNoColumns: 'question.dynamicResponses.missingColumns',
  dynamicCsvMissing: 'question.dynamicResponses.csvNotUploaded',

  // calculation
  calcMissing: 'question.calculation.missing',
  calcOperandMissing: 'question.calculation.operandMissing',
  calcUnitInvalid: 'question.calculation.unitInvalid',
  calcOffsetFormat: 'question.calculation.offsetFormat',

  // references
  refUnknown: 'ref.unknown',
  refUnknownLiteral: 'ref.unknownLiteral',
  refTrailingSystem: 'ref.trailingSystem',
  refForward: 'ref.forward',
  refUndeclaredAutomatic: 'ref.undeclaredAutomatic',
  skipTestsReserved: 'skip.testsReserved',
  skipTestsUnknown: 'skip.testsUnknown',
  skipTestsForward: 'skip.testsForward',
  skipToReserved: 'skip.toReserved',
  skipToUnknown: 'skip.toUnknown',
  skipToBackwards: 'skip.toBackwards',
  skipToSelf: 'skip.toSelf',
  preskipTestsSelf: 'skip.preskipTestsSelf',
  messagePlaceholder: 'message.placeholder',

  // form / package
  tablenameDuplicate: 'form.tablename.duplicate',
  tablenameInvalid: 'form.tablename.invalid',
  parentMissing: 'form.parenttable.missing',
  parentCycle: 'form.parenttable.cycle',
  linkingFieldMissing: 'form.linkingfield.missing',
  linkingFieldUnknown: 'form.linkingfield.unknown',
  manifestFieldUnknown: 'form.manifest.unknownField',
  entryConditionUnknown: 'form.entryCondition.unknownField',
  repeatCountFieldUnknown: 'form.repeatCountField.unknownField',
  baseFormCount: 'package.baseForm.count',
  surveyIdMissing: 'package.surveyId.missing',
  databaseNameInvalid: 'package.databaseName.invalid',
} as const;

export type RuleId = (typeof RULE)[keyof typeof RULE];

export type FindingSeverity = 'error' | 'warning';
export type FindingScope = 'package' | 'form' | 'question';

/**
 * Which authored sub-object a finding is about. Doubles as the key for
 * choosing which `QuestionEditor` tab to open when a finding is clicked.
 */
export type FindingPart =
  | 'identity'
  | 'text'
  | 'maxCharacters'
  | 'mask'
  | 'optional'
  | 'numericCheck'
  | 'dateRange'
  | 'logicCheck'
  | 'uniqueCheck'
  | 'responses'
  | 'dynamicResponses'
  | 'calculation'
  | 'preskip'
  | 'postskip'
  | 'specialAnswers'
  | 'manifest'
  | 'globalSettings';

/**
 * One reported problem. Deliberately flat rather than a nested `location`
 * object: the two hot paths are `f.questionId === q.id` grouping and
 * `toMatchObject({ ruleId, subject })` in tests, and nesting buys nothing for
 * either while adding a `.location.` to every access site.
 */
export interface Finding {
  ruleId: RuleId;
  severity: FindingSeverity;
  scope: FindingScope;
  /** One sentence, already naming the field/form the problem is in. */
  message: string;
  /** Why it matters, or what to do about it. Shown as secondary text. */
  hint?: string;

  formId?: string;
  tablename?: string;

  /** The jump key. Never resolve a click by index -- array position changes on drag. */
  questionId?: string;
  /** Display only ("Q7"). */
  questionIndex?: number;
  fieldname?: string;

  part?: FindingPart;
  /** Index within a repeated part, e.g. `logicCheck[1]`, `preskip[0]`. */
  partIndex?: number;
  /** Nested calculation trail, e.g. `parts[1].cases[0].field`. */
  path?: string;
  /** The offending token: a bad reference, a duplicate value, an invalid unit. */
  subject?: string;
}

/**
 * A stable identity for a `Finding`, for React keys and dedup. Not a random
 * id -- a generated uuid would change on every recompute and thrash any list
 * keyed on it, since `Finding`s are recreated wholesale each validation pass.
 */
export function findingKey(f: Finding): string {
  return [
    f.ruleId,
    f.formId ?? '',
    f.questionId ?? '',
    f.part ?? '',
    f.partIndex ?? '',
    f.path ?? '',
    f.subject ?? '',
  ].join('|');
}

export interface ValidationReport {
  findings: Finding[];
  errorCount: number;
  warningCount: number;
  hasErrors: boolean;
  byQuestionId: ReadonlyMap<string, Finding[]>;
  byFormId: ReadonlyMap<string, Finding[]>;
}

export function buildReport(findings: Finding[]): ValidationReport {
  const byQuestionId = new Map<string, Finding[]>();
  const byFormId = new Map<string, Finding[]>();
  let errorCount = 0;
  let warningCount = 0;

  for (const f of findings) {
    if (f.severity === 'error') errorCount++;
    else warningCount++;

    if (f.questionId) {
      const list = byQuestionId.get(f.questionId) ?? [];
      list.push(f);
      byQuestionId.set(f.questionId, list);
    }
    if (f.formId) {
      const list = byFormId.get(f.formId) ?? [];
      list.push(f);
      byFormId.set(f.formId, list);
    }
  }

  return {
    findings,
    errorCount,
    warningCount,
    hasErrors: errorCount > 0,
    byQuestionId,
    byFormId,
  };
}
