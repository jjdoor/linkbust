'use strict';

/**
 * linkbust core — pure Markdown parsing for local link checking.
 *
 * No fs, no clock, no network: every function transforms text in, so the Node
 * and Python ports behave identically and the parsing is unit-testable. The CLI
 * layer walks files, resolves paths against the filesystem, and reads target
 * files' anchors.
 *
 * Deliberately LOCAL-only: external (http/https/mailto/…) links are classified
 * and skipped, never fetched. That's the whole point — fast, offline, and safe
 * for a pre-commit hook.
 */

const SCHEME_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

function blankLine(s) { return s.replace(/[^\n]/g, ' '); }

/**
 * Replace the *contents* of fenced (``` / ~~~) and inline (`code`) spans with
 * spaces, preserving length and newlines so line numbers and offsets stay
 * valid. Prevents example links inside code from being checked.
 */
function maskCode(text) {
  const lines = String(text).split('\n');
  let inFence = false, fenceChar = '';
  for (let i = 0; i < lines.length; i++) {
    const open = /^(\s*)(```+|~~~+)/.exec(lines[i]);
    if (!inFence && open) { inFence = true; fenceChar = open[2][0]; lines[i] = blankLine(lines[i]); continue; }
    if (inFence) {
      const close = /^(\s*)(```+|~~~+)\s*$/.exec(lines[i]);
      lines[i] = blankLine(lines[i]);
      if (close && close[2][0] === fenceChar) inFence = false;
      continue;
    }
    lines[i] = lines[i].replace(/`[^`\n]*`/g, (m) => blankLine(m));
  }
  return lines.join('\n');
}

/** GitHub-style heading → anchor slug. */
function slugify(text) {
  return String(text).trim().toLowerCase()
    .replace(/[^\w\s-]/g, '')   // drop punctuation, keep letters/digits/_/space/-
    .replace(/\s/g, '-');       // spaces → hyphens
}

/** Strip inline markdown from a heading so its slug matches what GitHub renders. */
function cleanInline(s) {
  return String(s)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) / ![alt](url) → text
    .replace(/[*_`~]/g, '')                     // emphasis / code marks
    .trim();
}

/** ATX headings (`# ...` through `###### ...`). */
function extractHeadings(text) {
  const out = [];
  const lines = String(text).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(lines[i]);
    if (m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  }
  return out;
}

/**
 * All anchor names a `#fragment` could target in this document: GitHub heading
 * slugs (de-duplicated with -1/-2 suffixes) plus explicit HTML id/name values.
 *
 * @param {string} text  (should be code-masked)
 * @returns {Set<string>}
 */
function headingAnchors(text) {
  const set = new Set();
  const counts = new Map();
  for (const h of extractHeadings(text)) {
    const base = slugify(cleanInline(h.text));
    if (!base) continue;
    const c = counts.get(base) || 0;
    counts.set(base, c + 1);
    set.add(c === 0 ? base : `${base}-${c}`);
  }
  const re = /\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  return set;
}

function parseTarget(raw) {
  let t = raw.trim();
  if (t.startsWith('<')) { const e = t.indexOf('>'); return e !== -1 ? t.slice(1, e) : t.slice(1); }
  const sp = t.search(/\s/);            // a title follows the URL after whitespace
  return sp === -1 ? t : t.slice(0, sp);
}

/**
 * Extract checkable links from (code-masked) markdown.
 *
 * @returns {{inline:Array, refDefs:Array, refUses:Array}}
 *   inline:  {target, image, line}
 *   refDefs: {name, target, line}     ([ref]: target)
 *   refUses: {name, line}             ([text][ref] / [ref][])
 */
function extractLinks(text) {
  text = String(text);
  const lineAt = (idx) => text.slice(0, idx).split('\n').length;
  const inline = [], refDefs = [], refUses = [];
  let m;

  const inlineRe = /(!?)\[([^\]]*)\]\(\s*([^)]*?)\s*\)/g;
  while ((m = inlineRe.exec(text))) {
    const target = parseTarget(m[3]);
    if (target) inline.push({ target, image: m[1] === '!', line: lineAt(m.index) });
  }
  const defRe = /^[ ]{0,3}\[([^\]]+)\]:\s*(\S+)/gm;
  while ((m = defRe.exec(text))) {
    refDefs.push({ name: m[1].toLowerCase(), target: parseTarget(m[2]), line: lineAt(m.index) });
  }
  const useRe = /\[([^\]]*)\]\[([^\]]*)\]/g;
  while ((m = useRe.exec(text))) {
    refUses.push({ name: (m[2] || m[1]).toLowerCase(), line: lineAt(m.index) });
  }
  return { inline, refDefs, refUses };
}

function decodeSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

/**
 * Classify a link target.
 * @returns {{kind:'empty'|'external'|'anchor'|'file', ...}}
 */
function classifyTarget(target) {
  const t = String(target).trim();
  if (t === '') return { kind: 'empty' };
  if (t.startsWith('#')) return { kind: 'anchor', fragment: t.slice(1) };
  if (t.startsWith('//') || SCHEME_RE.test(t)) return { kind: 'external' };
  const hash = t.indexOf('#');
  const path = hash === -1 ? t : t.slice(0, hash);
  const fragment = hash === -1 ? null : t.slice(hash + 1);
  return { kind: 'file', path: decodeSafe(path), fragment, absolute: path.startsWith('/') };
}

/** Is `fragment` a valid anchor in `anchors`? Lenient: exact or slugified match. */
function anchorOk(fragment, anchors) {
  return anchors.has(fragment) || anchors.has(slugify(decodeSafe(fragment)));
}

module.exports = {
  maskCode, slugify, cleanInline, extractHeadings, headingAnchors,
  parseTarget, extractLinks, classifyTarget, anchorOk,
};
