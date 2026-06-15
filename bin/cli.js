#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const core = require('../src/core.js');
const VERSION = require('../package.json').version;

const useColor = process.stdout.isTTY && !process.env.NO_COLOR && !process.argv.includes('--no-color');
const col = (c, s) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s);
const red = (s) => col('31', s), green = (s) => col('32', s), dim = (s) => col('2', s), bold = (s) => col('1', s);

const MD_RE = /\.(md|markdown|mdown|mkd)$/i;
const IGNORE = new Set(['node_modules', '.git', '.venv', 'dist', 'build', '__pycache__', '.next', 'vendor']);

const HELP = `${bold('linkbust')} — find broken LOCAL links in Markdown (relative paths + #anchors). No network.

${bold('Usage')}
  linkbust                 Check every .md under the current directory
  linkbust README.md       Check one file
  linkbust docs/ guide.md  Check files and/or directories (recursive)

${bold('Options')}
  --json        Machine-readable results
  -q, --quiet   Print nothing when everything is fine
  --no-color
  -v, --version
  -h, --help

${bold('Checks')}  relative file links exist · #anchors resolve to a heading/<a id>
${bold('Skips')}   http(s)/mailto/… (never fetched) and /absolute paths
${bold('Exit')}    0 all links ok · 1 broken link(s) found · 2 usage/read error
`;

function fail(msg) { process.stderr.write(red(`linkbust: ${msg}\n`)); process.exit(2); }

function collectFiles(args) {
  const out = [];
  const seen = new Set();
  const add = (f) => { const r = path.resolve(f); if (!seen.has(r)) { seen.add(r); out.push(f); } };
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of entries) {
      if (IGNORE.has(ent.name) || (ent.isDirectory() && ent.name.startsWith('.'))) continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (MD_RE.test(ent.name)) add(full);
    }
  };
  for (const a of args) {
    let st;
    try { st = fs.statSync(a); } catch { fail(`no such file or directory: ${a}`); }
    if (st.isDirectory()) walk(a);
    else add(a);
  }
  return out;
}

const anchorCache = new Map();
function anchorsFor(absPath) {
  if (anchorCache.has(absPath)) return anchorCache.get(absPath);
  let set = null;
  try { set = core.headingAnchors(core.maskCode(fs.readFileSync(absPath, 'utf8'))); } catch { /* unreadable */ }
  anchorCache.set(absPath, set);
  return set;
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('-h') || argv.includes('--help')) { process.stdout.write(HELP); process.exit(0); }
  if (argv.includes('-v') || argv.includes('--version')) { process.stdout.write(VERSION + '\n'); process.exit(0); }

  const json = argv.includes('--json');
  const quiet = argv.includes('-q') || argv.includes('--quiet');
  const targets = argv.filter((a) => !a.startsWith('-'));
  const files = collectFiles(targets.length ? targets : ['.']);
  if (!files.length) fail('no markdown files found');

  const broken = [];
  let checked = 0, skipExternal = 0, skipAbsolute = 0;

  for (const file of files) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { fail(`cannot read ${file}: ${e.message}`); }
    const masked = core.maskCode(text);
    const selfAnchors = core.headingAnchors(masked);
    anchorCache.set(path.resolve(file), selfAnchors);
    const { inline, refDefs, refUses } = core.extractLinks(masked);
    const defined = new Set(refDefs.map((d) => d.name));

    const items = [
      ...inline.map((l) => ({ target: l.target, line: l.line })),
      ...refDefs.map((d) => ({ target: d.target, line: d.line })),
    ];
    for (const { target, line } of items) {
      checked++;
      const c = core.classifyTarget(target);
      if (c.kind === 'external') { skipExternal++; continue; }
      if (c.kind === 'empty') { broken.push({ file, line, target, reason: 'empty link target' }); continue; }
      if (c.kind === 'anchor') {
        if (!core.anchorOk(c.fragment, selfAnchors)) broken.push({ file, line, target, reason: `no anchor "#${c.fragment}" in this file` });
        continue;
      }
      // c.kind === 'file'
      if (c.absolute) { skipAbsolute++; continue; }
      const resolved = path.resolve(path.dirname(file), c.path);
      if (!fs.existsSync(resolved)) { broken.push({ file, line, target, reason: 'file not found' }); continue; }
      if (c.fragment && MD_RE.test(resolved)) {
        const a = anchorsFor(resolved);
        if (a && !core.anchorOk(c.fragment, a)) broken.push({ file, line, target, reason: `no anchor "#${c.fragment}" in ${c.path}` });
      }
    }
    for (const u of refUses) {
      checked++;
      if (!defined.has(u.name)) broken.push({ file, line: u.line, target: `[${u.name}][]`, reason: 'undefined reference' });
    }
  }

  if (json) {
    process.stdout.write(JSON.stringify({
      files: files.length, checked, broken: broken.length,
      skipped: { external: skipExternal, absolute: skipAbsolute },
      issues: broken.map((b) => ({ file: path.relative(process.cwd(), b.file), line: b.line, target: b.target, reason: b.reason })),
    }, null, 2) + '\n');
    process.exit(broken.length ? 1 : 0);
  }

  for (const b of broken) {
    const where = `${path.relative(process.cwd(), b.file)}:${b.line}`;
    process.stdout.write(`${bold(where)}  ${red('✗')}  ${b.target}  ${dim('(' + b.reason + ')')}\n`);
  }
  const skipBits = [];
  if (skipExternal) skipBits.push(`${skipExternal} external`);
  if (skipAbsolute) skipBits.push(`${skipAbsolute} absolute`);
  const skipNote = skipBits.length ? dim(`  (${skipBits.join(', ')} skipped)`) : '';
  if (broken.length) {
    process.stdout.write(`\n${red(`✗ ${broken.length} broken`)} · ${checked} links checked in ${files.length} file(s)${skipNote}\n`);
    process.exit(1);
  }
  if (!quiet) process.stdout.write(`${green('✓ all good')} · ${checked} links checked in ${files.length} file(s)${skipNote}\n`);
  process.exit(0);
}

main();
