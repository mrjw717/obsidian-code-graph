<div align="center">

# Code Graph

**Visualize how your code files connect — imports, calls, inheritance, implements, comment-links, ADRs, and tests — as an interactive graph alongside your notes.**

[![Release](https://img.shields.io/github/v/release/mrjw717/obsidian-code-graph?style=flat&color=8b5cf6&label=Release)](https://github.com/mrjw717/obsidian-code-graph/releases)
[![License](https://img.shields.io/badge/license-0--BSD-8b5cf6?style=flat)](LICENSE)
[![Tests](https://img.shields.io/github/actions/workflow/status/mrjw717/obsidian-code-graph/lint.yml?style=flat&label=Tests&color=22c55e)](https://github.com/mrjw717/obsidian-code-graph/actions)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.7.2%2B-7c3aed?style=flat&logo=obsidian&logoColor=white)](https://obsidian.md)

</div>

---

<img src="screenshot.png" alt="Code Graph — interactive code dependency graph inside Obsidian" width="100%">

---

<div align="center">

Code Graph turns your vault into a navigable knowledge graph of your codebase.
It parses source files with [tree-sitter](https://tree-sitter.github.io/), extracts
typed relationships, and renders them as a force-directed graph you can explore,
filter, and drill into — right next to your Obsidian notes.

</div>

---

## Features

### Structural analysis

- **AST-parsed edges** — imports, calls, inherits, implements, uses-type, and
  contains relationships, extracted via tree-sitter for TypeScript, TSX,
  JavaScript, and Python.
- **Imports-only support** — regex-based import extraction for CSS, C, C++, Go,
  Rust, Java, Lua, and PHP.
- **Symbol-level nodes** — toggle into functions, classes, methods, interfaces,
  and types as first-class graph nodes inside their containing files.
- **TODO / FIXME visibility** — files with `TODO` comments glow orange; files
  with `FIXME` comments glow red. Technical debt is visible at a glance.

### Documentation protocol

- **`@see`, `@tested-by`, `@adr`, `@depends-on`** tags in code comments become
  typed graph edges connecting code to tests, decisions, and dependencies.
- **`@domain`, `@status`, `@author`** tags become node metadata for coloring,
  filtering, and hover tooltips.
- **Note ↔ code links** — markdown frontmatter `related-code` creates
  `documents` edges from notes to code, closing the loop between documentation
  and implementation.
- **Seed domains command** — one command discovers a domain vocabulary from
  your folder structure and stamps `@file` / `@domain` / `@status` headers
  into code files automatically.

### Interactive graph

- **Color modes** — language, domain, status, or auto-detected community
  (label propagation reveals natural module boundaries).
- **Zone-aura heatmap** — soft colored glows behind nodes, driven by domain,
  community, or user-defined color groups.
- **Color groups** — query-based grouping with `domain:`, `path:`, `ext:`,
  `kind:`, `status:`, `tag:` prefixes or free-text substring.
- **Node sizing** — constant, lines of code, degree, fan-in, or fan-out.
- **Neighborhood filtering** — focus on a file and show only nodes within N
  hops.
- **Dead-code highlighting** — dim nodes with no incoming edges.
- **Hover-focus spotlight** — dim distant nodes/edges on hover to spotlight
  a node's neighborhood.

---

## Edge types

| Edge | Color | Source | Meaning |
|------|-------|--------|---------|
| imports | `#8b5cf6` | AST / regex | File A imports from file B |
| calls | `#3b82f6` | AST | File A calls a symbol in file B |
| contains | `#6b7280` | AST | File A contains symbol B |
| inherits | `#ec4899` | AST | Class A extends class B |
| implements | `#14b8a6` | AST | Class A implements interface B |
| uses-type | `#a855f7` | AST | Symbol A references type B |
| tested-by | `#22c55e` | `@tested-by` | Code A is verified by test B |
| adr-link | `#eab308` | `@adr` | Code A is governed by decision B |
| depends-on | `#f97316` | `@depends-on` | Code A depends on concept B |
| documents | `#6366f1` | frontmatter | Note A documents code B |
| comment-link | `#16a34a` | `@see` / `[[wikilink]]` | Comment references B |
| md-link | `#9ca3af` | Obsidian links | Note A links to note B |

---

## Quick start

1. **Install** — from Obsidian's community plugin browser, or manually copy
   `main.js`, `manifest.json`, and `styles.css` into
   `<vault>/.obsidian/plugins/code-graph/`.
2. **Enable** — in **Settings → Community plugins**.
3. **Open** — click the graph ribbon icon, or run
   **Code Graph: Open graph view** from the command palette.
4. **Tag** (optional) — run **Code Graph: Seed domains from codebase** to
   auto-tag your files with `@domain` / `@status` headers.

---

## The documentation protocol

The plugin ships a [full protocol guide](skills/code-graph-protocol.md) for
writing code comments and markdown frontmatter so the graph extracts maximum
semantic value.

**Code files:**

```typescript
/**
 * @file Calculator engine — math expression evaluation
 * @domain calculator
 * @status stable
 * @author Josh
 *
 * @see [[Shunting Yard Algorithm]]
 * @tested-by [[engine.test.ts]]
 * @adr [[ADR-001-Calculator-Architecture]]
 */
```

**Markdown notes:**

```yaml
---
related-code:
  - "[[engine.ts]]"
domain: calculator
type: adr
status: accepted
tags: [calculator, architecture]
---
```

See the [protocol guide](skills/code-graph-protocol.md) for the complete tag
reference, language support matrix, and the checklist for AI documentation
agents.

---

## Language support

| Tier | Languages | Edges |
|------|-----------|-------|
| **Full structural** (tree-sitter AST) | TypeScript, TSX, JavaScript, Python | imports, calls, inherits, implements, uses-type, contains, symbol nodes |
| **Imports-only** (regex) | CSS, C, C++, Go, Rust, Java, Lua, PHP | imports only |

The `@tag` / `[[wikilink]]` / `TODO` / `FIXME` / frontmatter protocol works in
**any language** — only the structural edges differ. See the
[protocol guide](skills/code-graph-protocol.md#language-support) for details on
adding a language to the full-structural tier.

---

## Requirements

- **Obsidian 1.7.2 or later.**
- **Desktop only.** The plugin uses Node's `fs` module to load tree-sitter
  WASM grammars, which is not available in Obsidian's mobile environment.

---

## Development

```bash
npm install      # install dependencies
npm run dev      # watch mode — rebuild on save
npm run build    # production build (tsc typecheck + esbuild minified)
npm run lint     # ESLint with eslint-plugin-obsidianmd
npm test         # vitest unit tests (27 tests)
```

### Build pipeline

The build embeds the tree-sitter core runtime and 4 grammar WASM files as
base64 directly into `main.js`, making the plugin fully self-contained. Fresh
installs from a GitHub release need only `main.js`, `manifest.json`, and
`styles.css` — no external downloads or manual extraction.

| Script | Purpose |
|--------|---------|
| `scripts/copy-wasm.mjs` | Copies 4 used grammars + core runtime from `node_modules` to `wasm/` |
| `scripts/embed-wasm.mjs` | Generates `src/indexer/wasm-embedded.ts` with base64 constants |
| `esbuild.config.mjs` | Bundles `src/main.ts` → `main.js` (CJS, minified, tree-shaken) |

### Release artifacts

`main.js`, `manifest.json`, and `styles.css` are attached to GitHub releases
tagged with the version number. The release workflow automatically builds,
attests, and publishes.

---

<div align="center">

---

### Support

If Code Graph saves you time, consider supporting development.

[**Buy me a coffee**](https://buymeacoffee.com/JoshuaWilliams)

---

**License:** 0-BSD · **Author:** Joshua Williams · **Repository:** [mrjw717/obsidian-code-graph](https://github.com/mrjw717/obsidian-code-graph)

</div>