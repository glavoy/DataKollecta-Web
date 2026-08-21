/**
 * XML emission as a node tree.
 *
 * The point of building a tree rather than pushing template literals is that
 * `renderDocument` becomes the *only* place a string is produced, so escaping
 * cannot be forgotten. The previous string-concatenation generator escaped some
 * attributes and not others -- a `math` expression containing `<` emitted XML
 * the Flutter app could not parse at all.
 *
 * The consumer (`survey_loader.dart`) parses with `package:xml`, a real XML
 * parser, so formatting here is for human readability only. Indentation, line
 * endings and attribute spacing carry no meaning; element names, attribute
 * names and values carry all of it.
 */

export type AttrValue = string | number | boolean | undefined | null;

export interface XmlElement {
  name: string;
  attrs?: Record<string, AttrValue>;
  /** Text content. Mutually exclusive with `children`; `children` wins if both. */
  text?: string | number;
  children?: readonly XmlChild[];
}

/** `false`/`null`/`undefined` children are dropped, so callers can write `cond && el(...)`. */
export type XmlChild = XmlElement | null | undefined | false;

export function el(
  name: string,
  attrs?: Record<string, AttrValue>,
  children?: readonly XmlChild[],
): XmlElement {
  return { name, attrs, children };
}

/**
 * `<name>text</name>`, or `undefined` when there is no text to write.
 *
 * "No text" means `undefined`/`null` only. An empty string and `0` are real
 * values and are emitted -- the same rule `renderDocument` applies to
 * attributes, and the reason the old `if (question.maxCharacters)` style of
 * guard is not used anywhere in this module.
 */
export function textEl(
  name: string,
  text: string | number | undefined | null,
): XmlElement | undefined {
  if (text === undefined || text === null) return undefined;
  return { name, text };
}

/**
 * For the cases where blank genuinely means "omit" -- e.g. an optional
 * attribute a user left empty in the designer. Explicit at the call site, so
 * that dropping a value is always a decision rather than an accident.
 */
export function blankToUndefined(v: string | null | undefined): string | undefined {
  if (v === undefined || v === null) return undefined;
  return v === '' ? undefined : v;
}

/** Escapes all five predefined entities. `'` matters: attributes are single-quoted. */
function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** `>` is escaped too -- not strictly required, but it keeps `]]>` from ever forming. */
function escapeText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderAttrs(attrs: Record<string, AttrValue> | undefined): string {
  if (!attrs) return '';
  let out = '';
  for (const [name, value] of Object.entries(attrs)) {
    // Omit ONLY for undefined/null. `0`, `false` and `''` are values, and
    // dropping them is what made `value='0'` vanish from case results before.
    if (value === undefined || value === null) continue;
    out += ` ${name}='${escapeAttr(String(value))}'`;
  }
  return out;
}

function liveChildren(children: readonly XmlChild[] | undefined): XmlElement[] {
  if (!children) return [];
  return children.filter((c): c is XmlElement => Boolean(c));
}

function renderElement(node: XmlElement, indent: string, depth: number): string[] {
  const pad = indent.repeat(depth);
  const attrs = renderAttrs(node.attrs);
  const kids = liveChildren(node.children);

  if (kids.length > 0) {
    const lines = [`${pad}<${node.name}${attrs}>`];
    for (const kid of kids) lines.push(...renderElement(kid, indent, depth + 1));
    lines.push(`${pad}</${node.name}>`);
    return lines;
  }

  if (node.text !== undefined) {
    // Multi-line text (question text often is) stays on one logical line; the
    // app trims and the parser collapses, so this is purely cosmetic.
    return [`${pad}<${node.name}${attrs}>${escapeText(String(node.text))}</${node.name}>`];
  }

  // No children and no text. Emit an explicit open/close pair rather than a
  // self-closing tag: automatic system questions are written this way by
  // SurveyGen, and matching it keeps a diff between the two generators' output
  // readable during migration.
  return [`${pad}<${node.name}${attrs}></${node.name}>`];
}

export function renderDocument(
  root: XmlElement,
  opts: { indent?: string; declaration?: boolean } = {},
): string {
  const indent = opts.indent ?? '    ';
  const lines: string[] = [];
  if (opts.declaration !== false) {
    lines.push(`<?xml version='1.0' encoding='utf-8'?>`);
  }
  lines.push(...renderElement(root, indent, 0));
  return lines.join('\n');
}

/** Exposed for tests that need to assert escaping directly. */
export const __testing = { escapeAttr, escapeText };
