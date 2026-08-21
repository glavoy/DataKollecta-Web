/**
 * A formatting-insensitive view of an XML document, for comparing output from
 * this generator against SurveyGen's.
 *
 * The two generators differ in every cosmetic respect -- SurveyGen writes CRLF,
 * hard tabs and spaces around `=`; this one writes LF and four spaces. None of
 * that reaches the Flutter app, which parses with `package:xml`. Comparing
 * canonical forms asserts the only thing that actually matters: that both
 * describe the same document.
 */

import { XMLParser } from 'fast-xml-parser';

export interface CanonicalNode {
  name: string;
  attrs: Record<string, string>;
  text: string;
  children: CanonicalNode[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // Keep everything as written: '096' must not become 96, and 'true' must not
  // become a boolean. The app reads these as strings.
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  // Force arrays so a single child and a list of children have the same shape.
  isArray: () => true,
});

/** Collapse runs of whitespace; SurveyGen's multi-line `or` layout is cosmetic. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function build(name: string, raw: Record<string, unknown>): CanonicalNode {
  const attrs: Record<string, string> = {};
  const children: CanonicalNode[] = [];
  let text = '';

  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('@_')) {
      attrs[key.slice(2)] = String(Array.isArray(value) ? value[0] : value);
      continue;
    }
    if (key === '#text') {
      const parts = Array.isArray(value) ? value : [value];
      text = collapse(parts.map(String).join(' '));
      continue;
    }
    const entries = Array.isArray(value) ? value : [value];
    for (const entry of entries) {
      if (entry === null || entry === undefined) {
        children.push({ name: key, attrs: {}, text: '', children: [] });
      } else if (typeof entry === 'object') {
        children.push(build(key, entry as Record<string, unknown>));
      } else {
        children.push({ name: key, attrs: {}, text: collapse(String(entry)), children: [] });
      }
    }
  }

  return { name, attrs, text, children };
}

export function canonical(xml: string): CanonicalNode {
  const parsed = parser.parse(xml) as Record<string, unknown>;
  const rootName = Object.keys(parsed).find((k) => !k.startsWith('?'));
  if (!rootName) throw new Error('canonical(): no root element found');
  const rootRaw = parsed[rootName];
  const first = Array.isArray(rootRaw) ? rootRaw[0] : rootRaw;
  return build(rootName, (first ?? {}) as Record<string, unknown>);
}

/** A stable, diffable string form -- attribute order normalised by sorting. */
export function canonicalToString(node: CanonicalNode, depth = 0): string {
  const pad = '  '.repeat(depth);
  const attrs = Object.keys(node.attrs)
    .sort()
    .map((k) => `${k}=${JSON.stringify(node.attrs[k])}`)
    .join(' ');
  const head = `${pad}${node.name}${attrs ? ' ' + attrs : ''}${node.text ? ` :: ${node.text}` : ''}`;
  const kids = node.children.map((c) => canonicalToString(c, depth + 1));
  return [head, ...kids].join('\n');
}

/** Every `<question>` in document order, keyed by fieldname. */
export function questionsOf(doc: CanonicalNode): CanonicalNode[] {
  return doc.children.filter((c) => c.name === 'question');
}

export function fieldnamesOf(doc: CanonicalNode): string[] {
  return questionsOf(doc).map((q) => q.attrs.fieldname ?? '');
}
