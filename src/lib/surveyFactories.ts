import { SurveyForm, SurveyQuestion, QuestionType } from "@/types/survey";

/**
 * The starting shape of a newly added question or form in the designer.
 *
 * Split out of `SurveyDesigner.tsx`. These four were module-level and pure
 * already; what they lacked was a test, and living inside a 1,033-line
 * component is why they never got one.
 *
 * `getDefaultFieldType` is the only definition of a question type's default
 * field type. `QuestionEditor.tsx` used to carry an identical copy and now
 * imports this one; its `getAvailableFieldTypes` makes the returned value the
 * *only* selectable option for date, datetime, information and checkbox, so
 * these arms are pinned individually by the test rather than only checked for
 * being non-empty.
 */

export const getDefaultFieldType = (
  type: QuestionType,
): SurveyQuestion["fieldtype"] => {
  switch (type) {
    case "radio":
      return "integer";
    case "checkbox":
      return "text";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "information":
      return "n/a";
    case "calculated":
      return "integer";
    case "combobox":
      return "text";
    case "text":
    default:
      return "text";
  }
};

// `Date.now()` reads the same millisecond for two items created in a fast
// double-click or a duplicate-then-duplicate, producing identical
// fieldnames/tablenames -- the validation engine now catches the resulting
// duplicate, but the generator shouldn't produce it. A short random suffix
// derived from the same `crypto` already used for `id` is enough entropy to
// make a same-tick collision practically impossible without needing a
// counter to be threaded through and persisted anywhere.
export const shortId = (): string =>
  crypto.randomUUID().replace(/-/g, "").slice(0, 8);

export const createDefaultQuestion = (type: QuestionType): SurveyQuestion => ({
  id: crypto.randomUUID(),
  type,
  fieldname: `field_${shortId()}`,
  fieldtype: getDefaultFieldType(type),
  text: "",
  responses: ["radio", "checkbox", "combobox"].includes(type) ? [] : undefined,
  // 80 matches the overwhelming majority of free-text widths in real SurveyGen
  // output -- a starting point to adjust, not a rule to satisfy blindly.
  maxCharacters: type === "text" ? 80 : undefined,
});

export const createDefaultForm = (): SurveyForm => ({
  id: crypto.randomUUID(),
  tablename: `form_${shortId()}`,
  displayname: "New Form",
  displayOrder: 0,
  autoStartRepeat: 0,
  repeatEnforceCount: 1,
  questions: [],
});
