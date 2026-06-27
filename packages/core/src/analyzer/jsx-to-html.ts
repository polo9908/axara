/**
 * Best-effort JSX/TSX → HTML serializer, built on the TypeScript AST.
 *
 * Purpose: turn a React component snippet into HTML that axe-core can evaluate
 * for *structural* RGAA checks (alternatives, labels, link/button names, roles).
 * It is deliberately conservative:
 *  - `className`→`class`, `htmlFor`→`for` so label association & CSS hooks survive.
 *  - Event handlers (`onX`) and `style` are dropped (irrelevant to structure).
 *  - Dynamic attribute/children values (`{expr}`) are assumed *present* and
 *    rendered as a placeholder, so a dynamic `alt={x}` or `{label}` is not
 *    mistaken for a missing alternative / empty control (avoids false positives).
 *  - Custom components (`<Button/>`) are opaque: we render their children only.
 *
 * It is not a renderer — it cannot know what a component outputs — but it makes
 * the markup an author actually wrote checkable without a browser.
 */

import ts from 'typescript';

const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const ATTR_RENAME: Readonly<Record<string, string>> = {
  classname: 'class',
  htmlfor: 'for',
};

/** Placeholder used for dynamic (`{expr}`) attribute values and text nodes. */
const DYNAMIC_PLACEHOLDER = 'contenu dynamique';

type JsxRoot = ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;

function isJsxRoot(node: ts.Node): node is JsxRoot {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node);
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function isHtmlTag(tag: string): boolean {
  // Native elements are lowercase; `<Foo>` is a component, `<foo.bar>` a member.
  return /^[a-z][a-z0-9-]*$/.test(tag);
}

function renderAttributes(sf: ts.SourceFile, opening: ts.JsxOpeningElement | ts.JsxSelfClosingElement): string {
  const parts: string[] = [];
  for (const prop of opening.attributes.properties) {
    if (!ts.isJsxAttribute(prop)) continue; // skip {...spread}
    const rawName = prop.name.getText(sf);
    const lower = rawName.toLowerCase();
    if (lower.startsWith('on') || lower === 'style' || lower === 'key' || lower === 'ref') continue;
    const name = ATTR_RENAME[lower] ?? rawName;

    const init = prop.initializer;
    if (init === undefined) {
      parts.push(name); // boolean attribute, e.g. `disabled`
      continue;
    }
    if (ts.isStringLiteral(init)) {
      parts.push(`${name}="${escapeAttr(init.text)}"`);
      continue;
    }
    if (ts.isJsxExpression(init) && init.expression) {
      const expr = init.expression;
      if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
        parts.push(`${name}="${escapeAttr(expr.text)}"`);
      } else {
        parts.push(`${name}="${DYNAMIC_PLACEHOLDER}"`); // dynamic → assume present
      }
    }
  }
  return parts.length > 0 ? ' ' + parts.join(' ') : '';
}

function serializeChildren(sf: ts.SourceFile, children: ts.NodeArray<ts.JsxChild>): string {
  let out = '';
  for (const child of children) {
    if (ts.isJsxText(child)) {
      const text = child.text.replace(/\s+/g, ' ');
      if (text.trim().length > 0) out += escapeText(text);
    } else if (ts.isJsxExpression(child)) {
      if (!child.expression) continue;
      if (ts.isStringLiteral(child.expression) || ts.isNoSubstitutionTemplateLiteral(child.expression)) {
        out += escapeText(child.expression.text);
      } else {
        out += DYNAMIC_PLACEHOLDER; // dynamic child → assume visible content
      }
    } else {
      out += serializeNode(sf, child);
    }
  }
  return out;
}

function serializeNode(sf: ts.SourceFile, node: ts.JsxChild | JsxRoot): string {
  if (ts.isJsxFragment(node)) {
    return serializeChildren(sf, node.children);
  }
  if (ts.isJsxSelfClosingElement(node)) {
    const tag = node.tagName.getText(sf);
    if (!isHtmlTag(tag)) return '';
    const attrs = renderAttributes(sf, node);
    return VOID_ELEMENTS.has(tag) ? `<${tag}${attrs}>` : `<${tag}${attrs}></${tag}>`;
  }
  if (ts.isJsxElement(node)) {
    const tag = node.openingElement.tagName.getText(sf);
    const children = serializeChildren(sf, node.children);
    if (!isHtmlTag(tag)) return children; // opaque component → keep its children
    const attrs = renderAttributes(sf, node.openingElement);
    if (VOID_ELEMENTS.has(tag)) return `<${tag}${attrs}>`;
    return `<${tag}${attrs}>${children}</${tag}>`;
  }
  return '';
}

/** Serialize the JSX found in a React/TSX snippet to HTML. */
export function jsxToHtml(source: string): string {
  const sf = ts.createSourceFile('snippet.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const roots: JsxRoot[] = [];
  const find = (node: ts.Node): void => {
    if (isJsxRoot(node)) {
      roots.push(node);
      return; // children are serialized by serializeNode; don't double-collect
    }
    ts.forEachChild(node, find);
  };
  find(sf);
  return roots.map((root) => serializeNode(sf, root)).join('\n').trim();
}
