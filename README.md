# linkbust

**Find broken *local* links in your Markdown** — relative file paths that don't
exist and `#anchors` that don't resolve to a heading. **No network, zero
dependencies**, fast enough to drop in a pre-commit hook.

```bash
npx linkbust
```

```
docs/setup.md:14   ✗  ./install.md           (file not found)
README.md:8        ✗  #quick-start           (no anchor "#quick-start" in this file)
guide.md:23        ✗  ./api.md#missing       (no anchor "#missing" in ./api.md)

✗ 3 broken · 142 links checked in 26 file(s)  (38 external skipped)
```

## Why

Reorganize your docs, rename a file, tweak a heading — and quietly leave a trail
of dead links behind. The checkers that catch this come with baggage:

- **markdown-link-check** works, but it pulls in **~9 dependencies** and its main
  job is hitting **external URLs over HTTP** — slow, flaky in CI, and rate-limited.
- **lychee** is fast and thorough, but it's a **Rust binary** to install.
- The old Python option (`mlc`) has been **unmaintained since 2021**.

`linkbust` does the part that breaks most often and is fully deterministic:
**local links.** It never makes a network request — so it's instant, works
offline, and won't flake your CI because someone's blog was down. That makes it
ideal for a **pre-commit hook** or a fast docs lint.

## What it checks

- **Relative file links** — `[x](../docs/api.md)`, image sources — resolve on disk.
- **Anchors** — `[x](#section)` and `[x](other.md#section)` match a real heading
  (GitHub-style slug) or an explicit `<a id="...">` / `id="..."`.
- **Reference links** — `[text][ref]` has a matching `[ref]: …` definition.
- Links inside fenced/inline **code are ignored**, so examples don't trip it up.

It **skips** (never fetches) `http(s)`, `mailto:`, protocol-relative `//…`, and
`/absolute` paths — checking those is a different, networked job.

## Usage

```bash
linkbust                  # every .md under the current directory
linkbust README.md        # a single file
linkbust docs/ CHANGELOG.md   # files and/or directories (recursive)
```

| Option | |
|---|---|
| `--json` | machine-readable results |
| `-q, --quiet` | print nothing when everything's fine (great for hooks) |
| `--no-color` | |

```
exit 0   all local links resolve
exit 1   one or more broken links
exit 2   usage / read error
```

### As a pre-commit hook

```yaml
# .pre-commit-config.yaml
- repo: local
  hooks:
    - id: linkbust
      name: linkbust
      entry: npx linkbust
      language: system
      pass_filenames: false
```

## Install

```bash
npx linkbust              # Node >= 18
pip install linkbust      # Python >= 3.8 (byte-for-byte port)
```

- npm: https://www.npmjs.com/package/linkbust
- PyPI: https://pypi.org/project/linkbust/
- GitHub: https://github.com/jjdoor/linkbust · [linkbust-py](https://github.com/jjdoor/linkbust-py)

## License

MIT
