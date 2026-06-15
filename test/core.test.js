'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  maskCode, slugify, extractHeadings, headingAnchors,
  extractLinks, classifyTarget, anchorOk,
} = require('../src/core.js');

test('slugify mimics GitHub anchors', () => {
  assert.equal(slugify('Getting Started'), 'getting-started');
  assert.equal(slugify('What is `foo`?'), 'what-is-foo'); // backtick/?, dropped
  assert.equal(slugify('  Trim  Me  '), 'trim--me');       // each space → hyphen
});

test('headingAnchors de-duplicates and includes html ids', () => {
  const md = '# Setup\n## Setup\n## Notes\n<a id="manual"></a>\n<div name="zone-1">';
  const anchors = headingAnchors(md);
  assert.ok(anchors.has('setup'));
  assert.ok(anchors.has('setup-1'));   // second "Setup"
  assert.ok(anchors.has('notes'));
  assert.ok(anchors.has('manual'));    // explicit id
  assert.ok(anchors.has('zone-1'));    // explicit name
});

test('maskCode blanks fenced & inline code (preserving lines)', () => {
  const md = 'text [a](real.md)\n```\n[b](fake.md)\n```\nmore `[c](inline.md)` end';
  const masked = maskCode(md);
  assert.equal(masked.split('\n').length, md.split('\n').length); // line count preserved
  const links = extractLinks(masked).inline.map((l) => l.target);
  assert.deepEqual(links, ['real.md']);  // fenced + inline-code links are gone
});

test('extractLinks finds inline, images, ref defs and ref uses with line numbers', () => {
  const md = [
    '[home](./index.md)',          // 1
    '![logo](img/logo.png)',       // 2
    'see [the guide][g]',          // 3
    '',                            // 4
    '[g]: ./guide.md',             // 5
  ].join('\n');
  const { inline, refDefs, refUses } = extractLinks(md);
  assert.deepEqual(inline.map((l) => [l.target, l.image, l.line]),
    [['./index.md', false, 1], ['img/logo.png', true, 2]]);
  assert.deepEqual(refUses.map((u) => [u.name, u.line]), [['g', 3]]);
  assert.deepEqual(refDefs.map((d) => [d.name, d.target, d.line]), [['g', './guide.md', 5]]);
});

test('classifyTarget separates external / anchor / file', () => {
  assert.equal(classifyTarget('https://x.com').kind, 'external');
  assert.equal(classifyTarget('mailto:a@b.c').kind, 'external');
  assert.equal(classifyTarget('//cdn.x/y').kind, 'external');
  assert.deepEqual(classifyTarget('#install'), { kind: 'anchor', fragment: 'install' });
  const f = classifyTarget('./docs/a%20b.md#sec');
  assert.equal(f.kind, 'file');
  assert.equal(f.path, './docs/a b.md');  // URL-decoded
  assert.equal(f.fragment, 'sec');
  assert.equal(classifyTarget('/abs/path').absolute, true);
});

test('anchorOk is lenient (exact or slugified)', () => {
  const anchors = headingAnchors('# Getting Started');
  assert.ok(anchorOk('getting-started', anchors));
  assert.ok(anchorOk('Getting Started', anchors)); // slugified match
  assert.ok(!anchorOk('missing', anchors));
});
