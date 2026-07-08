# Code Graph Documentation Protocol

> **For AI agents and developers:** This protocol defines how to write code
> comments, file headers, and markdown frontmatter so that the Code Graph
> plugin can extract maximum structural, semantic, and knowledge-graph
> relationships from your codebase.

## Why This Exists

The Code Graph plugin converts your codebase into a navigable knowledge graph.
Every `@tag`, every `[[link]]`, and every frontmatter field becomes a **graph
edge** or **node metadata**. Following this protocol means:

- Every file gets a **domain** (for semantic clustering)
- Every symbol gets **typed links** (to tests, ADRs, related code)
- Every note gets **bidirectional links** to code (so docs and code stay connected)
- TODOs and FIXMEs become **visible indicators** on graph nodes

**More documentation = richer graph = better navigation, impact analysis, and
onboarding.**

---

## Quick Start: the "Seed domains" command

Before tagging anything by hand, run the built-in command:

> **Command palette → "Code Graph: Seed domains from codebase"**

It inspects the already-built graph, proposes a domain vocabulary derived from
your folder structure, shows a confirmation modal, and then **automatically
stamps** `@file` / `@domain` / `@status` headers into code files and `domain:`
frontmatter into notes. This is the fastest way to adopt the protocol across a
whole project. You can then refine the result by hand following the tiers
below.

> The command is idempotent: re-running it updates existing `@domain` /
> `@status` lines in place and preserves `@see`, `@tested-by`, `@adr`,
> `@depends-on`, and `[[wikilinks]]` you have added.

---

## Quick Reference: All Tags

### Code Comment Tags (in any language)

| Tag | Syntax | Produces | Example |
|-----|--------|----------|---------|
| `@see` | `@see [[Target]]` | `comment-link` edge | `@see [[Architecture]]` |
| `@tested-by` | `@tested-by [[Target]]` | `tested-by` edge (green) | `@tested-by [[engine.test.ts]]` |
| `@adr` | `@adr [[Target]]` | `adr-link` edge (yellow) | `@adr [[ADR-001-Design]]` |
| `@depends-on` | `@depends-on [[Target]]` | `depends-on` edge (orange) | `@depends-on [[DatabaseSchema]]` |
| `@domain` | `@domain <name>` | Domain metadata (coloring + zone aura) | `@domain calculator` |
| `@status` | `@status <stable\|wip\|deprecated>` | Status metadata (coloring) | `@status stable` |
| `@author` | `@author <name>` | Author metadata (shown in hover tooltip) | `@author josh` |
| `@file` | `@file <description>` | File header (consumed by Seed domains) | `@file Calculator engine` |
| `TODO` | `// TODO: <text>` | Orange glow on node | `// TODO: handle edge case` |
| `FIXME` | `// FIXME: <text>` | Red glow on node | `// FIXME: memory leak` |

> **Not extracted:** `@module`, `@param`, `@returns`, `@throws`, `HACK`,
> `REVIEW`. These are conventional JSDoc tags; the plugin does not parse them.
> Write them for human readers and IDE tooling, but they will not affect the
> graph. (The hover tooltip shows `domain`, `status`, and `author` only.)

### Markdown Frontmatter Fields

```yaml
---
related-code:                          # Creates 'documents' edges
  - "[[Calculator.tsx]]"
  - "[[engine.ts]]"
domain: calculator                     # Domain tag (coloring + zone aura)
status: accepted                       # accepted | draft | stable | wip | deprecated
type: adr                              # adr | spec | guide | readme
author: josh                           # Optional; shown in hover tooltip
tags: [calculator, architecture]       # Enables the `tag:<name>` color-group query
---
```

**Which fields the plugin reads:**

| Field | Read? | Effect |
|-------|-------|--------|
| `related-code` | ✅ | `documents` edges (note → code) |
| `domain` | ✅ | Note participates in Color-by-Domain + `domain:` color groups + domain-driven zone aura |
| `status` | ✅ | Note participates in Color-by-Status + `status:` color groups |
| `tags` | ✅ | Note matches the `tag:<name>` color-group query |
| `author` | ✅ | Shown in the hover tooltip |
| `type` | ⚠️ | Parsed and stored on the node, but **not currently used** by any color mode or query. Document it for future use / your own reference. |

---

## Tier 1: File Headers (REQUIRED for every source file)

Every source file should begin with a documentation header:

```typescript
/**
 * @file Calculator — main calculator UI component
 * @domain calculator
 * @status stable
 * @author Josh
 */
```

```python
# @file Calculator engine — math expression evaluation
# @domain calculator
# @status stable
```

```go
// @file Calculator engine
// @domain calculator
// @status stable
```

**Rules:**
- `@domain` is free-text but should be **consistent** across all files in the
  same feature area
- `@status` must be one of: `stable`, `wip`, `deprecated`
- `@author` is free-text (rest of line after the tag); shown in the hover
  tooltip
- `@file` is the human-readable file description; the Seed-domains command
  reads and rewrites it
- The header can be a block comment (`/** */`), line comments (`//`, `#`), or
  any format

**Graph effect:**
- `@domain` → enables "Color by Domain" mode (each domain gets a distinct
  color) and drives the "domain" zone-aura mode
- `@status` → enables "Color by Status" mode (green=stable, amber=wip,
  red=deprecated)
- `@author` → appears in the node hover tooltip alongside fan-in/fan-out

---

## Tier 2: Symbol Documentation (for exported symbols)

```typescript
/**
 * Tokenizes a mathematical expression string.
 *
 * @param input - The expression to tokenize (e.g., "3 + sin(4)")
 * @returns Array of Token objects
 * @throws {CalculatorError} When encountering invalid characters
 *
 * @see [[TokenType]] — type definitions for tokens
 * @see [[Shunting Yard Algorithm]] — algorithm overview
 * @tested-by [[engine.test.ts]]
 */
export function tokenize(input: string): Token[] {
```

**Rules:**
- `@param`, `@returns`, `@throws` follow standard JSDoc/TSDoc conventions.
  They are **not** parsed by the plugin — write them for IDEs and human
  readers.
- `@see [[X]]` creates a graph edge — `X` can be a code file, symbol, or
  markdown note
- `@tested-by [[X]]` creates a green `tested-by` edge to the test file
- All `[[wikilinks]]` in comments are extracted as edges (not just in `@see`)
- The plugin also recognizes `@link <target>`, `ref: [[x]]`, and
  `see also: [[x]]` (configurable in Settings → Comment link patterns)

**Graph effect:**
- Each `@see`, `@tested-by`, `@adr`, `@depends-on` creates a typed edge
- The hover tooltip shows `domain` / `status` / `author` (when present) plus
  fan-in/fan-out and community
- Test coverage is visible: the `tested-by` edge itself is green — a node
  with no `tested-by` edge is a coverage gap

---

## Tier 3: Architecture Links (for important files)

```typescript
/**
 * @adr [[ADR-001-Calculator-Architecture]]
 * @depends-on [[MathEngine]]
 * @author Josh
 */
```

**Rules:**
- `@adr` links code to the Architecture Decision Record that governs it
- `@depends-on` declares semantic dependencies not captured by imports
  (external services, concepts, APIs)
- These are optional but strongly recommended for core/architectural files

**Graph effect:**
- `@adr` edges (yellow dashed) let you navigate from code to the "why" behind
  decisions
- `@depends-on` edges (orange dashed) reveal system-level dependencies

---

## Tier 4: Markdown Notes (for every .md file in the vault)

### Architecture Decision Records (ADRs)

```markdown
---
related-code:
  - "[[Calculator.tsx]]"
  - "[[engine.ts]]"
domain: calculator
type: adr
status: accepted
tags: [calculator, architecture, core]
---

# ADR-001: Calculator Architecture

## Context
The calculator needs to tokenize, convert to RPN, and evaluate...

## Decision
We chose the Shunting Yard algorithm because...

## Related Code
- [[engine.ts]] — tokenizer and evaluator
- [[types.ts]] — type definitions
```

### Feature Documentation

```markdown
---
related-code:
  - "[[Calculator.tsx]]"
  - "[[useCalculator.ts]]"
domain: calculator
type: guide
status: stable
tags: [calculator, ui, hooks]
---

# Calculator Feature Guide

## Overview
The calculator component provides...

## See Also
- [[Shunting Yard Algorithm]] — how expressions are parsed
- [[engine.ts]] — the calculation engine
```

**Rules:**
- `related-code` creates `documents` edges (indigo) from note → code
- `domain` must match the `@domain` tags in related code files for
  Color-by-Domain to cluster code and docs together
- `status` follows the same vocabulary as code (`stable` / `wip` /
  `deprecated`) plus the documentation conventions (`accepted` / `draft`)
- `tags` enables the `tag:<name>` color-group query
- Standard `[[wikilinks]]` in the note body also create `md-link` edges

**Graph effect:**
- Bidirectional links: code `@see [[Note]]` + note `related-code: [[code.ts]]`
- Domain consistency between code and docs
- Full knowledge graph closure: Code ↔ Docs ↔ Decisions ↔ Tests

---

## Bidirectional Link Discipline

**Every link should be bidirectional.** If code links to a doc, the doc should
link back.

| Direction | Code side | Doc side |
|-----------|-----------|----------|
| Code → Doc | `@see [[Architecture]]` | `related-code: [[engine.ts]]` |
| Code → Test | `@tested-by [[engine.test.ts]]` | (test file documents what it tests) |
| Code → ADR | `@adr [[ADR-001]]` | `related-code: [[Calculator.tsx]]` |

> The plugin does not currently emit a warning for one-directional links, but
> bidirectional links are what make the graph navigable in both directions.
> Treat this as a documentation discipline, not an enforced rule.

---

## TODO/FIXME Convention

```typescript
// TODO: Add support for complex numbers
// FIXME: Division by zero returns Infinity instead of throwing
```

**Graph effect:**
- Files with TODOs get an **orange glow** around the node
- Files with FIXMEs get a **red glow** (takes priority over TODO)
- This makes technical debt visible at a glance in the graph

**Best practice:** Tag TODOs with context:
```typescript
// TODO(@author): description — #priority
// FIXME: description — estimated effort: 2h
```

> `HACK:` and `REVIEW:` comments are **not** currently extracted. Only `TODO`
> and `FIXME` produce glow effects.

---

## Domain Tagging Strategy

Domains are **free-text** — you define what makes sense for your project:

| Domain example | Use case |
|---------------|----------|
| `@domain auth` | Authentication/authorization code |
| `@domain billing` | Payment/subscription code |
| `@domain calculator` | Calculator engine/UI |
| `@domain ui-components` | Shared UI component library |
| `@domain api` | API route handlers |
| `@domain database` | Database models/migrations |
| `@domain testing` | Test utilities and fixtures |

**Rules:**
1. Be consistent — use the exact same string across all files in a domain
2. Keep it short — one word or hyphenated phrase
3. Don't over-granularize — 3-7 domains is ideal for most projects
4. Document your domains — create a `[[Domain Map]]` note listing all domains

> The **Seed domains from codebase** command (see Quick Start) derives an
> initial domain vocabulary from your folder structure automatically — a good
> starting point if you don't know what domains to define.

---

## Checklist for AI Documentation Agents

When an AI agent writes or modifies code, it should verify:

- [ ] Every new file has a `@file`, `@domain`, and `@status` header
- [ ] `@author` is set on files where ownership matters
- [ ] Every exported symbol that has non-obvious behavior has at least one
      `@see [[X]]` link
- [ ] Test files are linked via `@tested-by [[X]]`
- [ ] Important files link to ADRs via `@adr [[X]]`
- [ ] Markdown notes have frontmatter with `related-code`, `domain`, `status`,
      `tags`
- [ ] Links are bidirectional (code → doc AND doc → code)
- [ ] Domain tags are consistent across related files (and match note
      frontmatter `domain`)
- [ ] No FIXMEs are left without context
- [ ] TODOs include priority or assignee where possible

---

## Language Support

The plugin uses **regex extraction for all languages** (so `@tags`,
`[[wikilinks]]`, `TODO`/`FIXME`, and frontmatter work everywhere) and
**tree-sitter AST parsing for structural edges** (`imports`, `calls`,
`inherits`, `implements`, `uses-type`, `contains`) in the languages below that
ship a grammar.

### Tier A — Full structural edges (tree-sitter symbol extraction)

File-level `imports` **plus** symbol-level `calls`, `inherits`, `implements`,
`uses-type`, `contains`, and symbol nodes (functions, classes, methods,
interfaces, …).

| Language | Extensions | Imports | Calls | Inherits | Implements | Uses-type | Contains |
|----------|-----------|:-------:|:-----:|:--------:|:----------:|:---------:|:--------:|
| TypeScript | `ts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TSX | `tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| JavaScript | `js`, `jsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Python | `py` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Tier B — Imports only (regex-based, no AST)

Only file-level `imports` edges are produced. No `calls` / `inherits` /
`implements` / `uses-type` / `contains` edges, and no symbol nodes. The
`@tag` / `[[wikilink]]` / `TODO` / `FIXME` / frontmatter protocol still works
fully — only structural edges are limited.

| Language | Extensions | Imports | Structural edges |
|----------|-----------|:-------:|:----------------:|
| CSS | `css` | ✅ (`@import`) | — |
| C | `c`, `h` | ✅ (`#include`) | — |
| C++ | `cpp`, `cc` | ✅ (`#include`) | — |
| Go | `go` | ✅ (`import`) | — |
| Rust | `rs` | ✅ (`use`, `extern crate`) | — |
| Java | `java` | ✅ (`import`) | — |
| Lua | `lua` | ✅ (`require`) | — |
| PHP | `php` | ✅ (`use`, `require`) | — |

> **Adding a language to Tier A** is a localized change: provide a
> tree-sitter symbol extractor in `src/indexer/languages/<lang>.ts` and set
> `hasSymbolExtraction: true` in its profile. See
> `src/indexer/languages/typescript.ts` for the pattern.

### Comment syntax by language (applies to all @-tags)

| Language | Comment syntax | Example |
|----------|---------------|---------|
| TypeScript/JavaScript | `/** @see [[X]] */` or `// @see [[X]]` | ✅ |
| Python | `# @see [[X]]` or `""" @see [[X]] """` | ✅ |
| Go | `// @see [[X]]` | ✅ |
| Rust | `// @see [[X]]` or `//! @see [[X]]` | ✅ |
| Java | `/** @see [[X]] */` or `// @see [[X]]` | ✅ |
| C/C++ | `// @see [[X]]` or `/* @see [[X]] */` | ✅ |
| CSS | `/* @see [[X]] */` | ✅ |
| Lua | `-- @see [[X]]` | ✅ |
| PHP | `// @see [[X]]` or `# @see [[X]]` | ✅ |

The `[[wikilink]]` syntax works everywhere. The `@tag` syntax works in any
comment style.

---

## Features Beyond the Protocol

These plugin features are not part of the documentation protocol but are
useful for navigating the graph it produces.

### Color modes (node fill)

- **Language** — color by file language (default).
- **Domain** — color by `@domain` tag / note frontmatter `domain`.
- **Status** — color by `@status` tag / note frontmatter `status`
  (green=stable, amber=wip, red=deprecated).
- **Community** — auto-detected communities via label propagation. Groups
  densely interconnected nodes regardless of tags.

### Zone-aura heatmap

A soft colored glow behind each node, independent of the node fill color.
Driven by `zoneColorMode`:

- **groups** — user-defined color groups (see below)
- **community** — auto-detected communities
- **domain** — `@domain` tags

### Color groups (user-defined)

Each color group has a `query` that selects which nodes it colors. Query
prefixes:

| Prefix | Matches | Example |
|--------|---------|---------|
| `domain:<name>` | Nodes whose `@domain` equals `<name>` | `domain:calculator` |
| `path:<substr>` | Nodes whose path contains `<substr>` | `path:components/` |
| `ext:<ext>` | Nodes whose file extension equals `<ext>` | `ext:ts` |
| `kind:<kind>` | Nodes whose kind equals `<kind>` | `kind:function` |
| `status:<s>` | Nodes whose `@status` equals `<s>` | `status:stable` |
| `tag:<name>` | Note nodes whose frontmatter `tags` include `<name>` | `tag:architecture` |
| *(none)* | Substring match on node name or path | `Calculator` |

### Node sizing

- **constant**, **lines** (LOC), **degree** (total connections),
  **fan-in** (incoming edges), **fan-out** (outgoing edges).

### Other toggles

- **Show symbols** — render function/class/method/interface nodes inside files
  (off by default; turn on to see structural containment).
- **Show notes** / **Show code files** — filter node types.
- **Neighborhood hops** — when focused on a file, only show nodes within N
  hops (0 = whole graph).
- **Highlight dead code** — dim nodes with no incoming edges.
- **Physics** — force-directed layout; tunable center/repel/link forces and
  link distance.
- **Hover focus** — dim distant nodes/edges on hover to spotlight a node's
  neighborhood.

---

## Graph Edge Types Produced

| Edge type | Color | Style | Source | Meaning |
|-----------|-------|-------|--------|---------|
| `imports` | Purple | Solid | AST / regex | File A imports from file B |
| `calls` | Blue | Solid | AST | File A calls a symbol in file B |
| `contains` | Grey | Solid | AST | File A contains symbol B |
| `inherits` | Pink | Dashed | AST | Class A extends class B |
| `implements` | Teal | Dashed | AST | Class A implements interface B |
| `uses-type` | Purple | Dashed | AST | Symbol A uses type B |
| `tested-by` | Green | Solid | `@tested-by` tag | Code A is tested by test B |
| `adr-link` | Yellow | Dashed | `@adr` tag | Code A is governed by decision B |
| `depends-on` | Orange | Dashed | `@depends-on` tag | Code A depends on concept B |
| `documents` | Indigo | Solid | Frontmatter `related-code` | Note A documents code B |
| `comment-link` | Green | Dashed | `@see` / `[[wikilink]]` / `@link` | Code comment references B |
| `md-link` | Grey | Dashed | Obsidian metadataCache | Note A links to note B |