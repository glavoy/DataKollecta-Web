import { describe, it, expect } from "vitest";
import { QuestionType, SurveyQuestion } from "@/types/survey";

import {
  getDefaultFieldType,
  shortId,
  createDefaultQuestion,
  createDefaultForm,
} from "@/lib/surveyFactories";

const ALL_TYPES: QuestionType[] = [
  "text",
  "radio",
  "checkbox",
  "combobox",
  "date",
  "datetime",
  "information",
  "calculated",
];

describe("getDefaultFieldType", () => {
  it("gives a radio an integer fieldtype, because its answer is a code", () => {
    expect(getDefaultFieldType("radio")).toBe("integer");
  });

  it("gives a checkbox text, because its answer is a list", () => {
    expect(getDefaultFieldType("checkbox")).toBe("text");
  });

  it("matches the fieldtype to the type for date and datetime", () => {
    expect(getDefaultFieldType("date")).toBe("date");
    expect(getDefaultFieldType("datetime")).toBe("datetime");
  });

  it("gives an information question n/a, since nothing is stored", () => {
    expect(getDefaultFieldType("information")).toBe("n/a");
  });

  it("pins every arm, because QuestionEditor offers no alternative", () => {
    // Not just `toBeTruthy()`. QuestionEditor.getAvailableFieldTypes falls
    // through to `[{ value: getDefaultFieldType(type) }]` for every type it
    // has no explicit list for -- date, datetime, information, checkbox --
    // so for those the value here is the ONLY option the dropdown offers. A
    // wrong answer isn't a bad default a user can correct; it's a correct
    // one they cannot reach. The switch's `default` means a newly added
    // QuestionType silently gets 'text', and this table is what fails when
    // that happens.
    const expected: Record<QuestionType, SurveyQuestion["fieldtype"]> = {
      text: "text",
      radio: "integer",
      checkbox: "text",
      combobox: "text",
      date: "date",
      datetime: "datetime",
      information: "n/a",
      calculated: "integer",
    };

    for (const type of ALL_TYPES) {
      expect(getDefaultFieldType(type)).toBe(expected[type]);
    }
  });
});

describe("shortId", () => {
  it("is 8 lowercase hex characters", () => {
    expect(shortId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it("does not collide within a single tick", () => {
    // The reason this function exists: Date.now() read the same millisecond
    // for two items created by a fast double-click, so two questions got the
    // same fieldname.
    const ids = new Set(Array.from({ length: 500 }, () => shortId()));
    expect(ids.size).toBe(500);
  });
});

describe("createDefaultQuestion", () => {
  it("gives every question a unique id and fieldname", () => {
    const a = createDefaultQuestion("text");
    const b = createDefaultQuestion("text");

    expect(a.id).not.toBe(b.id);
    expect(a.fieldname).not.toBe(b.fieldname);
    expect(a.fieldname).toMatch(/^field_[0-9a-f]{8}$/);
  });

  it("derives fieldtype from the type", () => {
    expect(createDefaultQuestion("radio").fieldtype).toBe("integer");
    expect(createDefaultQuestion("date").fieldtype).toBe("date");
  });

  it("gives selection types an empty responses array, and others none", () => {
    for (const type of ["radio", "checkbox", "combobox"] as QuestionType[]) {
      expect(createDefaultQuestion(type).responses).toEqual([]);
    }
    for (const type of ["text", "date", "datetime", "information"] as QuestionType[]) {
      expect(createDefaultQuestion(type).responses).toBeUndefined();
    }
  });

  it("sets maxCharacters only for text", () => {
    expect(createDefaultQuestion("text").maxCharacters).toBe(80);
    expect(createDefaultQuestion("radio").maxCharacters).toBeUndefined();
    expect(createDefaultQuestion("date").maxCharacters).toBeUndefined();
  });
});

describe("createDefaultForm", () => {
  it("gives every form a unique id and tablename", () => {
    const a = createDefaultForm();
    const b = createDefaultForm();

    expect(a.id).not.toBe(b.id);
    expect(a.tablename).not.toBe(b.tablename);
    expect(a.tablename).toMatch(/^form_[0-9a-f]{8}$/);
  });

  it("starts with no questions and enforce mode 1", () => {
    const form = createDefaultForm();

    expect(form.questions).toEqual([]);
    expect(form.autoStartRepeat).toBe(0);
    // Not 0: mode 0 means "any number of children is acceptable", which is a
    // deliberate authoring choice rather than a default.
    expect(form.repeatEnforceCount).toBe(1);
  });
});
