/**
 * Reference integrity and ordering -- the highest-value rule group, and the
 * one that would have caught the real incident this engine exists because
 * of: a logic check on `dose_count` referencing `severity`, a field defined
 * *later* in the same form. SurveyGen would have rejected that outright; the
 * designer accepted it, and it shipped to a device before anyone read the
 * generated XML by hand and noticed.
 *
 * Ported from `_check_logic_field_names` / `_check_skip_to_field_names` /
 * `_check_reserved_variable_reads` / `_check_preskip_does_not_test_itself` in
 * `excel_reader.py`, plus new coverage SurveyGen has no equivalent for at
 * all: calculation field references, `[[placeholder]]`s in question text and
 * response filters, and skip rules whose tested value comes from another
 * field (`response_type: 'dynamic'`).
 */

import type { SurveyForm, SurveyQuestion, SkipRule } from '@/types/survey';
import { RULE, type Finding } from '../types';
import { calculationRefs, expressionRefs, placeholderRefs } from '../refs';
import { buildFormScope, type FormScope } from '../scope';

/**
 * A reference classified against one question's position, collapsing
 * `FieldRef`'s five kinds into the six outcomes the rules below actually
 * branch on. Kept separate from `FormScope.resolve()` itself because
 * "before or at the current index" means something different to each
 * caller: normal for a logic check reading its own field, an error for a
 * preskip testing its own field, an error for a skip target equal to the
 * current question.
 */
type RefClass =
  | { tag: 'leading' }
  | { tag: 'trailing' }
  | { tag: 'ok'; index: number } // authored, at or before the current question
  | { tag: 'forward'; index: number } // authored, after the current question
  | { tag: 'undeclaredAutomatic' }
  | { tag: 'unknown' };

function classifyRef(scope: FormScope, name: string, currentIndex: number): RefClass {
  const ref = scope.resolve(name);
  switch (ref.kind) {
    case 'leadingSystem':
      return { tag: 'leading' };
    case 'trailingSystem':
      return { tag: 'trailing' };
    case 'automatic':
      return { tag: 'undeclaredAutomatic' };
    case 'unknown':
      return { tag: 'unknown' };
    case 'authored':
      return ref.index! > currentIndex
        ? { tag: 'forward', index: ref.index! }
        : { tag: 'ok', index: ref.index! };
  }
}

const undeclaredAutomaticFinding = (
  base: Omit<Finding, 'ruleId' | 'severity' | 'message' | 'hint'>,
  name: string,
): Finding => ({
  ...base,
  ruleId: RULE.refUndeclaredAutomatic,
  severity: 'warning',
  subject: name,
  message: `References the Computed Automatic Variable '${name}', but no question named '${name}' is declared on this form.`,
  hint: `Add a '${name}' question (type Calculated, no calculation block), or it will compute to nothing.`,
});

// ---------------------------------------------------------------------------
// Free-text expressions (logic check conditions): unknown references are
// downgraded to a warning rather than an error. Blocking Publish on a
// correct survey is the worst outcome this engine can produce, and an
// unquoted literal comparison value (`status = yes`) is genuinely
// indistinguishable from a stale field reference by the same regex that
// finds real ones.
// ---------------------------------------------------------------------------

function logicCheckFindings(scope: FormScope, q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];

  (q.logicCheck ?? []).forEach((check, i) => {
    const base = {
      scope: 'question' as const,
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: 'logicCheck' as const,
      partIndex: i,
    };

    for (const name of expressionRefs(check.condition)) {
      const cls = classifyRef(scope, name, index);
      switch (cls.tag) {
        case 'trailing':
          findings.push({
            ...base,
            ruleId: RULE.refTrailingSystem,
            severity: 'error',
            subject: name,
            message: `Logic check reads '${name}', which is still empty while the questionnaire is being answered.`,
            hint: "That variable is written after the last question. Use 'startdate' if the interview date is what was meant.",
          });
          break;
        case 'forward':
          findings.push({
            ...base,
            ruleId: RULE.refForward,
            severity: 'error',
            subject: name,
            message: `Logic check references '${name}', which comes after this question.`,
            hint: 'A field must be answered before a logic check can read it.',
          });
          break;
        case 'undeclaredAutomatic':
          findings.push(undeclaredAutomaticFinding(base, name));
          break;
        case 'unknown':
          findings.push({
            ...base,
            ruleId: RULE.refUnknownLiteral,
            severity: 'warning',
            subject: name,
            message: `Logic check references '${name}', which is not a field on this form.`,
            hint: "If this is meant to be a literal value rather than a field, quote it, e.g. status = 'yes'.",
          });
          break;
        case 'leading':
        case 'ok':
          break; // legal: reads an earlier answer, or its own field
      }
    }

    for (const name of placeholderRefs(check.message)) {
      findings.push({
        ...base,
        ruleId: RULE.messagePlaceholder,
        severity: 'warning',
        subject: name,
        message: `Logic check message contains '[[${name}]]'.`,
        hint: 'Messages are shown exactly as written -- the interviewer would see the brackets, not a value. Word the message without it.',
      });
    }
  });

  if (q.uniqueCheck) {
    for (const name of placeholderRefs(q.uniqueCheck.message)) {
      findings.push({
        scope: 'question',
        questionId: q.id,
        questionIndex: index,
        fieldname: q.fieldname,
        part: 'uniqueCheck',
        ruleId: RULE.messagePlaceholder,
        severity: 'warning',
        subject: name,
        message: `Unique-check message contains '[[${name}]]'.`,
        hint: 'Messages are shown exactly as written -- the interviewer would see the brackets, not a value. Word the message without it.',
      });
    }
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Structured references: calculation fields, response filters, question
// text. All three come from a dropdown or an explicit [[placeholder]]
// convention, so an unresolvable one is unambiguous -- unlike a logic-check
// bareword, there is no "maybe it's a literal" reading. Unknown stays an
// error here.
// ---------------------------------------------------------------------------

function structuredRefFinding(
  cls: RefClass,
  name: string,
  base: Omit<Finding, 'ruleId' | 'severity' | 'message' | 'hint' | 'subject'>,
  describe: string,
): Finding | undefined {
  switch (cls.tag) {
    case 'trailing':
      return {
        ...base,
        ruleId: RULE.refTrailingSystem,
        severity: 'error',
        subject: name,
        message: `${describe} reads '${name}', which is still empty while the questionnaire is being answered.`,
        hint: "That variable is written after the last question. Use 'startdate' if the interview date is what was meant.",
      };
    case 'forward':
      return {
        ...base,
        ruleId: RULE.refForward,
        severity: 'error',
        subject: name,
        message: `${describe} references '${name}', which comes after this question.`,
        hint: 'A field must be answered before this question can read it.',
      };
    case 'unknown':
      return {
        ...base,
        ruleId: RULE.refUnknown,
        severity: 'error',
        subject: name,
        message: `${describe} references '${name}', which is not a field on this form.`,
        hint: 'Check for a typo, or a field that was renamed or deleted after this reference was written.',
      };
    case 'undeclaredAutomatic':
      return undeclaredAutomaticFinding(base, name);
    case 'leading':
    case 'ok':
      return undefined;
  }
}

function calculationFindings(scope: FormScope, q: SurveyQuestion, index: number): Finding[] {
  if (!q.calculation) return [];
  const findings: Finding[] = [];

  for (const ref of calculationRefs(q.calculation)) {
    // 'today' is a literal sentinel every date-based calc type accepts in
    // place of a field name (auto_fields.dart special-cases it), not a
    // reference.
    if (ref.name.trim().toLowerCase() === 'today') continue;

    const cls = classifyRef(scope, ref.name, index);
    const finding = structuredRefFinding(
      cls,
      ref.name,
      {
        scope: 'question',
        questionId: q.id,
        questionIndex: index,
        fieldname: q.fieldname,
        part: 'calculation',
        path: ref.path,
      },
      'Calculation',
    );
    if (finding) findings.push(finding);
  }

  return findings;
}

function responseFilterFindings(scope: FormScope, q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];
  const filters = q.dynamicResponses?.filters ?? [];

  filters.forEach((filter, i) => {
    for (const name of placeholderRefs(filter.value)) {
      const cls = classifyRef(scope, name, index);
      const finding = structuredRefFinding(
        cls,
        name,
        {
          scope: 'question',
          questionId: q.id,
          questionIndex: index,
          fieldname: q.fieldname,
          part: 'dynamicResponses',
          partIndex: i,
        },
        'Response filter',
      );
      if (finding) findings.push(finding);
    }
  });

  return findings;
}

function questionTextFindings(scope: FormScope, q: SurveyQuestion, index: number): Finding[] {
  const findings: Finding[] = [];

  for (const name of placeholderRefs(q.text)) {
    const cls = classifyRef(scope, name, index);
    const finding = structuredRefFinding(
      cls,
      name,
      {
        scope: 'question',
        questionId: q.id,
        questionIndex: index,
        fieldname: q.fieldname,
        part: 'text',
      },
      'Question text',
    );
    if (finding) findings.push(finding);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Skips. SurveyGen's ordering rules run in the opposite direction from logic
// checks: the TESTED field must not come after the current question (it
// must already be answered), and the TARGET must come strictly after (a
// skip is always forward, never a loop back). Both slots forbid reserved
// variables entirely -- including the leading pair, which logic checks are
// allowed to read -- because branching or landing on a value the generator
// supplies would make one package behave differently depending on when it
// runs, or on where the generator happens to place its own fields.
// ---------------------------------------------------------------------------

function skipRuleFindings(
  scope: FormScope,
  q: SurveyQuestion,
  index: number,
  kind: 'preskip' | 'postskip',
  rules: SkipRule[],
): Finding[] {
  const findings: Finding[] = [];

  rules.forEach((rule, i) => {
    const base = {
      scope: 'question' as const,
      questionId: q.id,
      questionIndex: index,
      fieldname: q.fieldname,
      part: kind,
      partIndex: i,
    };

    // The tested field.
    const testedClass = classifyRef(scope, rule.fieldname, index);
    switch (testedClass.tag) {
      case 'leading':
      case 'trailing':
        findings.push({
          ...base,
          ruleId: RULE.skipTestsReserved,
          severity: 'error',
          subject: rule.fieldname,
          message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} tests the reserved variable '${rule.fieldname}'.`,
          hint: 'Which questions get asked must not depend on a value the generator supplies -- branching on an interview timestamp would make one package ask different questions on different days.',
        });
        break;
      case 'forward':
        findings.push({
          ...base,
          ruleId: RULE.skipTestsForward,
          severity: 'error',
          subject: rule.fieldname,
          message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} tests '${rule.fieldname}', which comes after this question.`,
          hint: 'The tested field must already be answered.',
        });
        break;
      case 'undeclaredAutomatic':
        findings.push(undeclaredAutomaticFinding(base, rule.fieldname));
        break;
      case 'unknown':
        findings.push({
          ...base,
          ruleId: RULE.skipTestsUnknown,
          severity: 'error',
          subject: rule.fieldname,
          message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} tests '${rule.fieldname}', which is not a field on this form.`,
          hint: 'Check for a typo, or a field that was renamed or deleted after this rule was written.',
        });
        break;
      case 'ok':
        if (kind === 'preskip' && rule.fieldname.trim().toLowerCase() === q.fieldname.trim().toLowerCase()) {
          findings.push({
            ...base,
            ruleId: RULE.preskipTestsSelf,
            severity: 'error',
            subject: rule.fieldname,
            message: `Preskip tests its own field, '${q.fieldname}'.`,
            hint: 'It cannot fire on a new record (nothing is answered yet), and on an existing record it erases the answer before the jump. Use a postskip instead.',
          });
        }
        break;
    }

    // A dynamic response reads another field's current answer -- new
    // coverage, no SurveyGen equivalent.
    if (rule.response_type === 'dynamic' && rule.response) {
      const responseClass = classifyRef(scope, rule.response, index);
      const finding = structuredRefFinding(
        responseClass,
        rule.response,
        base,
        `${kind === 'preskip' ? 'Preskip' : 'Postskip'} comparison value`,
      );
      if (finding) findings.push(finding);
    }

    // The jump target. 'end' is the app's own end-of-form sentinel -- see
    // survey_navigation_service.dart's _advanceToEnd -- not a fieldname.
    if (rule.skipToFieldname.trim().toLowerCase() === 'end') return;

    const targetClass = classifyRef(scope, rule.skipToFieldname, index);
    switch (targetClass.tag) {
      case 'leading':
      case 'trailing':
        findings.push({
          ...base,
          ruleId: RULE.skipToReserved,
          severity: 'error',
          subject: rule.skipToFieldname,
          message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} skips to the reserved variable '${rule.skipToFieldname}'.`,
          hint: "The generator places reserved variables itself (starttime/startdate before the first question, the rest after the last), so a skip to one can't land where the survey intends. Skip to a real question, or to End of Form.",
        });
        break;
      case 'ok':
        findings.push({
          ...base,
          ruleId: targetClass.index === index ? RULE.skipToSelf : RULE.skipToBackwards,
          severity: 'error',
          subject: rule.skipToFieldname,
          message:
            targetClass.index === index
              ? `${kind === 'preskip' ? 'Preskip' : 'Postskip'} skips to the current question.`
              : `${kind === 'preskip' ? 'Preskip' : 'Postskip'} skips to '${rule.skipToFieldname}', which comes before this question.`,
          hint: 'A skip always moves forward. The jump clears every answer between here and the target, including anything already entered for a question it passes over.',
        });
        break;
      case 'undeclaredAutomatic':
      case 'unknown':
        findings.push({
          ...base,
          ruleId: RULE.skipToUnknown,
          severity: 'error',
          subject: rule.skipToFieldname,
          message: `${kind === 'preskip' ? 'Preskip' : 'Postskip'} skips to '${rule.skipToFieldname}', which is not a field on this form.`,
          hint: "Check for a typo, or use 'End of Form' if that was the intent.",
        });
        break;
      case 'forward':
        break; // correct: a skip target must be strictly forward
    }
  });

  return findings;
}

/** All reference-integrity findings for one form. */
export function referenceFindings(form: SurveyForm): Finding[] {
  const scope = buildFormScope(form);
  const findings: Finding[] = [];

  form.questions.forEach((q, index) => {
    findings.push(...logicCheckFindings(scope, q, index));
    findings.push(...calculationFindings(scope, q, index));
    findings.push(...responseFilterFindings(scope, q, index));
    findings.push(...questionTextFindings(scope, q, index));
    findings.push(...skipRuleFindings(scope, q, index, 'preskip', q.preskip ?? []));
    findings.push(...skipRuleFindings(scope, q, index, 'postskip', q.postskip ?? []));
  });

  return findings.map((f) => ({ ...f, formId: form.id, tablename: form.tablename }));
}
