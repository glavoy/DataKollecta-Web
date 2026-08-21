export type QuestionType =
  | 'text'
  | 'radio'
  | 'checkbox'
  | 'combobox'
  | 'date'
  | 'datetime'
  | 'information'
  | 'calculated'
  | 'button';

/**
 * `text_id` and `phone_num` were retired -- both behaved exactly like `text`
 * in the app, no survey used them, and SurveyGen (the Excel path) already
 * rejects them. A phone number is `text_integer` with a fixed length (`=10`).
 */
export type FieldType =
  | 'text'
  | 'integer'
  | 'text_integer'
  | 'text_decimal'
  | 'hourmin'
  | 'date'
  | 'datetime'
  | 'n/a';

export type SkipCondition = '=' | '<>' | '<' | '>' | '>=' | '<=' | 'contains' | 'does not contain';

export type CalculationType =
  | 'age_from_date'
  | 'age_at_date'
  | 'date_diff'
  | 'date_offset'
  | 'date_part'
  | 'case'
  | 'concat'
  | 'math'
  | 'constant'
  | 'lookup'
  | 'query';

export type MathOperator = '+' | '-' | '*' | '/';

/** `date_diff` units. */
export type DateDiffUnit = 'y' | 'm' | 'w' | 'd';

/** `date_part` units -- the same five tokens as the Computed Automatic Variables. */
export type DatePartUnit = 'yyyy' | 'yy' | 'mm' | 'dd' | 'doy';

/**
 * `age_at_date` units. These are the literal strings the app matches on
 * (`auto_fields.dart` `_calculateAgeDifference`) -- not 'y'/'m' abbreviations.
 */
export type AgeUnit = 'years' | 'months' | 'days';

export type CalculationUnit = DateDiffUnit | DatePartUnit;

export type CaseOperator =
  | '='
  | '!='
  | '<'
  | '>'
  | '<='
  | '>='
  | 'contains'
  | 'does not contain';

export interface ResponseOption {
  id: string;
  value: string;
  label: string;
}

export interface DynamicResponseConfig {
  source: 'csv' | 'database';
  file?: string;
  table?: string;
  displayColumn: string;
  valueColumn: string;
  filters: Array<{
    column: string;
    operator: string;
    value: string;
  }>;
  distinct?: boolean;
  emptyMessage?: string;
  dontKnow?: { value: string; label: string };
  notInList?: { value: string; label: string };
}

export interface NumericCheck {
  minValue?: number;
  maxValue?: number;
  otherValues?: string;
  message: string;
}

export interface DateRange {
  minDate?: string;
  maxDate?: string;
  // Ensure the parser handles "0" as string if needed, string type is correct here
}

export interface LogicCheck {
  condition: string; // e.g., "age > 18"
  message: string;
}

export interface SkipRule {
  id: string;
  fieldname: string;
  condition: SkipCondition;
  response: string;
  response_type?: 'fixed' | 'dynamic';
  skipToFieldname: string;
}

export interface CalculationParameter {
  name: string;
  field: string;
}

export interface CalculationCase {
  id: string;
  field: string;
  operator: CaseOperator;
  value: string;
  /**
   * The app parses `<result>` through the same recursive function as
   * `<calculation>`, so a case branch can return any calculation -- not only a
   * constant. Use `constantOf()` for the common case.
   */
  result: CalculationConfig;
}

/**
 * One `<calculation>`, `<part>` or `<result>` node.
 *
 * Deliberately a wide all-optional record rather than a discriminated union.
 * A union would make the historical `age_at_date` attribute bug
 * unrepresentable, but it would also break every `onChange({ ...calculation })`
 * spread in the designer -- which is the separately-scoped UI rewrite. The
 * per-type knowledge lives in `CALC_SPEC` (`lib/xml/calculation.ts`) instead,
 * which is what actually decides the emitted attributes.
 */
export interface CalculationConfig {
  type: CalculationType;

  /**
   * Meaning varies by type, matching what the app reads:
   *   constant                  -> the literal value
   *   age_at_date/age_from_date -> the UNIT ('years' | 'months' | 'days')
   *   date_offset               -> the offset expression ('+28d')
   *   date_diff                 -> the END date (a field name, or 'today')
   * Unused by math/concat/case/date_part/query/lookup.
   */
  value?: string;

  /** Source field. Stored bare; a `[[wrapped]]` reference is unwrapped on parse. */
  field?: string;

  /**
   *   concat      -> the joiner between parts
   *   age_at_date -> the TARGET DATE: a literal '2025-03-31' or a '[[startdate]]' ref
   *
   * The `age_at_date` usage looks odd but is the app's actual contract; it
   * returns an empty string when `separator` is absent.
   */
  separator?: string;

  /** `math` only. */
  operator?: MathOperator;

  /** `date_diff` (y|m|w|d) and `date_part` (yyyy|yy|mm|dd|doy). */
  unit?: CalculationUnit;

  /** `math`/`concat` operands, emitted as `<part>`. Recursive. */
  parts?: CalculationConfig[];

  /** `case` branches, emitted as `<when>`. */
  cases?: CalculationCase[];

  /** `case` fallback, emitted as `<else><result>`. */
  defaultResult?: CalculationConfig;

  /** `query` only. */
  sql?: string;
  params?: CalculationParameter[];

  /**
   * Emitted as `preserve='true'`. The app keeps an already-stored value instead
   * of recomputing it on edit. Nothing in the Excel generator can author this.
   */
  preserve?: boolean;
}

/** The overwhelmingly common case result: a literal. */
export const constantOf = (value: string): CalculationConfig => ({
  type: 'constant',
  value,
});

export const isConstant = (c?: CalculationConfig): boolean => c?.type === 'constant';

/** Text of a constant calculation, or '' if it is anything more complex. */
export const constantText = (c?: CalculationConfig): string =>
  c?.type === 'constant' ? c.value ?? '' : '';

export interface SurveyQuestion {
  id: string;
  type: QuestionType;
  fieldname: string;
  fieldtype: FieldType;
  text: string;

  /** Numeric only. A leading '=' in the XML means fixed length -> `fixedLength`. */
  maxCharacters?: number;
  /** `<maxCharacters>=3</maxCharacters>` -- exactly 3 characters, not "up to". */
  fixedLength?: boolean;
  /** `<numeric_range>`: zero-pads a numeric answer to this width. */
  numericRange?: number;

  mask?: string;

  /**
   * Which response block to emit. The app reads only the *first* `<responses>`
   * element, so emitting both a static and a dynamic one silently discards the
   * second; this discriminator makes that unrepresentable.
   */
  responseMode?: 'static' | 'dynamic';
  responses?: ResponseOption[];
  dynamicResponses?: DynamicResponseConfig;
  numericCheck?: NumericCheck;
  dateRange?: DateRange;
  logicCheck?: LogicCheck[];
  uniqueCheck?: { message: string };
  preskip?: SkipRule[];
  postskip?: SkipRule[];
  calculation?: CalculationConfig;
  dontKnow?: string;
  refuse?: string;
  na?: string;
}

// Manifest (CRFS) Types
export type AutoStartRepeat = 0 | 1 | 2;
export type RepeatEnforceCount = 0 | 1 | 2 | 3;

export interface IdConfigField {
  name: string;
  length: number;
}

export interface IdConfig {
  prefix: string;
  fields: IdConfigField[];
  incrementLength: number;
}

export interface SurveyForm {
  id: string;
  tablename: string;
  displayname: string;
  displayOrder: number;
  parenttable?: string;
  linkingfield?: string;
  displayFields?: string;
  
  // New/Updated fields
  idconfig?: IdConfig;
  repeatCountField?: string;
  repeatCountSource?: string; // UI helper, likely not in manifest
  autoStartRepeat: AutoStartRepeat;
  repeatEnforceCount: RepeatEnforceCount;
  
  primaryKey?: string;
  incrementField?: string;
  entry_condition?: string;
  /** Emitted as `isbase`; defaults to "has no parent table". */
  isBase?: boolean;
  /** Emitted as `requireslink`. Defaults to 1 for child forms, absent for base forms. */
  requiresLink?: 0 | 1;

  /**
   * Custom wording for the end-of-survey screen. Left unset, the app's own
   * translated default is used -- which is why a French build shows French
   * text without regenerating the package. Only set this to override.
   */
  endOfQuestionsText?: string;

  /**
   * Authored questions only. The reserved system variables and the end screen
   * are added at generation time by `withSystemFields`, never stored here.
   */
  questions: SurveyQuestion[];
}

export interface CsvFile {
  id: string;
  filename: string;
  content: string; // CSV content as string
}

export interface SurveyPackage {
  id: string; // Database UUID
  surveyId: string; // Logical ID (e.g. prism_css_v1), maps to survey_packages.name
  name: string; // Display Name, maps to survey_packages.display_name
  forms: SurveyForm[];

  // Global Manifest settings
  databaseName?: string;
  xmlFiles?: string[];
  csvFiles?: CsvFile[]; // CSV files included in the survey package
}
