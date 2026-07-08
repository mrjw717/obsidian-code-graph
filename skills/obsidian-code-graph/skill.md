---
name: obsidian-code-graph
description: >
  Documentation protocol + AI operating instructions for the Obsidian Code Graph
  plugin. Activate when writing, modifying, or auditing code comments, JSDoc,
  file headers, markdown frontmatter, ADRs, or test files in a vault that has
  the Code Graph plugin installed — so that every artifact becomes a typed graph
  edge or node metadata. Triggers on: code graph, @domain, @status, @author,
  @file, @see, @tested-by, @adr, @depends-on, [[wikilink]] in code, TODO FIXME
  glow, related-code frontmatter, seed domains, document a codebase, graph-aware
  documentation, maximize graph edges, optimize the code graph, what domain is
  this file, AI documentation agent instructions.
version: 2.0.0
plugin: code-graph
audience: ai-agent
scope: plugin-bundled
---

# Code Graph — AI Documentation Protocol & Operating Skill

> **Read this entire file before writing or editing any code, comment, note, or
> frontmatter in a vault running the Code Graph plugin.** Everything you write
> becomes part of a knowledge graph. This skill tells you exactly how to write
> it so the graph is maximally rich, accurate, and navigable — in **any**
> codebase, **any** language, **any** stack.

---

## 0. Your role as an AI documentation agent

You are not just writing code — you are **authoring a graph**. Every file header,
every `@tag`, every `[[wikilink]]`, and every frontmatter field is parsed by the
plugin and turned into a **node** or a **typed edge**. A well-documented
codebase becomes a navigable map of imports, calls, tests, decisions, and docs.
A poorly-documented one becomes an opaque blob of file-extension-colored dots.

**Your objective:** when a user asks you to "document this file," "add JSDoc,"
"write an ADR," "refactor this module," "seed the graph," or anything touching
code/notes in this vault, produce output that **maximizes meaningful graph edges
and accurate node metadata** while staying honest and uncluttered.

You do this by following the **operating procedure** in §2, the **edge-maximization
guide** in §5, and the **node-maximization guide** in §6.

---

## 1. The core mental model

```
YOU WRITE                 THE PLUGIN EXTRACTS              THE GRAPH SHOWS
──────────                ──────────────────               ───────────────
/** @domain auth */   →   node.domain = "auth"         →   colored domain cluster
@see [[X]]            →   comment-link edge  A → B      →   green dashed line
@tested-by [[t]]      →   tested-by edge     A → B      →   green solid line
related-code: [[x]]   →   documents edge     Note → X   →   indigo solid line
// TODO: ...          →   todoCount++                 →   orange glow on node
```

**More structured documentation = richer graph = better navigation, impact
analysis, test-coverage visibility, and onboarding.** But: noise (5+ `@see`
links, over-granular domains) degrades the graph. Be generous on **typed
links**, disciplined on **domain vocabulary**.

### What the plugin actually parses (verified)

| Artifact | Parsed? | Effect |
|----------|:-------:|--------|
| `@domain <name>` | ✅ | Node metadata → coloring + zone aura + clustering |
| `@status <stable\|wip\|deprecated>` | ✅ | Node metadata → status coloring |
| `@author <name>` | ✅ | Node metadata → hover tooltip |
| `@file <desc>` | ✅ | Consumed/rewritten by the Seed-domains command |
| `@tested-by [[X]]` | ✅ | `tested-by` edge |
| `@adr [[X]]` | ✅ | `adr-link` edge |
| `@depends-on [[X]]` | ✅ | `depends-on` edge |
| `@see [[X]]` / `[[wikilink]]` / `@link x` / `ref: [[x]]` | ✅ | `comment-link` edge |
| `// TODO:` | ✅ | `todoCount` → orange node glow |
| `// FIXME:` | ✅ | `fixmeCount` → red node glow (overrides TODO) |
| Frontmatter `related-code` | ✅ | `documents` edge (note → code) |
| Frontmatter `domain` / `status` / `author` / `tags` | ✅ | Note node metadata |
| `@param` / `@returns` / `@throws` / `@module` | ❌ | Not parsed — write for IDEs/humans only |
| `HACK:` / `REVIEW:` / `NOTE:` | ❌ | Not parsed — no graph effect |

All `@tags` are **case-insensitive** (`@DOMAIN`, `@Domain`, `@domain` all work).
All tags work in **any comment style** (`//`, `#`, `"""`, `--`, `/* */`).
All tags work in **every language** — only the *structural* edges differ by
language (see §7).

---

## 2. Operating procedure (run this every time)

When the user asks you to document, annotate, refactor, or "graph-ify" anything,
follow these six steps in order. Do not skip ahead.

### Step 1 — Detect the domains in THIS codebase (then confirm with the user)

**This is the single most important step.** Domains are the primary clustering
signal in the graph. Get them wrong (or skip them) and the graph cannot cluster.
Get them right and every other feature (coloring, auras, community detection,
dead-code highlighting) snaps into focus.

**1a. Auto-detect candidates first.** Do not ask the user a blank "what are your
domains?" — infer candidates from the codebase, THEN present them as suggestions.
Use these heuristics, strongest signal first:

| Signal | How to read it | Example |
|--------|----------------|---------|
| **Folder structure** (strongest) | First non-trivial path segment under `src/`/`lib/`/`app/`. Ignore `src`, `lib`, `app`, `internal`, `common`. | `src/auth/login.ts` → `auth` |
| **Import-graph communities** | Groups of files that densely import each other. (The plugin's **Seed domains** command does this for you.) | `billing/` + `invoice/` + `pricing/` → one cluster |
| **Conventional framework folders** | `routes`/`api` → `api`; `components`/`ui` → `ui-components`; `models`/`db`/`prisma` → `database`; `services` → `services`; `utils`/`helpers` → `utils`; `tests`/`__tests__` → `testing` |
| **Existing `@domain` / frontmatter `domain:`** | If some files are already tagged, reuse the exact same strings. Consistency > novelty. | existing `@domain auth` → keep `auth` |
| **Package/dependency hints** | `package.json` deps (express → `api`, prisma/drizzle → `database`, react → `ui-components`); `go.mod`/`Cargo.toml`/`requirements.txt` similarly. | `stripe` dep → likely a `billing` domain |

**1b. Collapse to 3–7 domains.** The plugin's community detection works best
with a small vocabulary. Merge tiny clusters (<3 files) into their nearest
neighbor by shared imports. Split nothing — folder granularity is usually right.
If the codebase genuinely has fewer than 3 domains, **do not fabricate** — small
projects legitimately have 1–2.

**1c. If the user already ran "Seed domains from codebase,"** honor that
vocabulary exactly. Read existing `@domain` tags before inventing new ones. The
command is idempotent; your job is to *maintain* its vocabulary, not replace it.

**1d. Present the detected vocabulary to the user as a numbered suggestion list,
and ask for confirmation or edits.** Example phrasing:

> I scanned the codebase and detected these domains:
> 1. `auth` (8 files — login, session, tokens)
> 2. `billing` (5 files — invoices, pricing, stripe)
> 3. `ui-components` (12 files — shared components)
> 4. `api` (9 files — route handlers)
> 5. `database` (6 files — models, migrations)
>
> Are these right, or should I rename/merge any? (e.g. `ui-components` → `ui`?)

Offer the suggestions as the default; let the user rename or merge. **Default to
proceeding with your detected vocabulary if the user says "you decide" or gives
no edits.** Record the agreed vocabulary and reuse the EXACT strings everywhere.

**1e. Recommend the Seed-domains command.** If the codebase is large or
un-tagged, suggest the user run **Code Graph: Seed domains from codebase** from
the command palette — it stamps headers across the whole project at once and is
idempotent. You then refine per-file.

### Step 2 — Classify each file you're touching

| File type | What it needs |
|-----------|---------------|
| **Source file** (`.ts`, `.js`, `.py`, `.go`, …) | Tier 1 header + Tier 2 symbol docs (§3, §4) |
| **Test file** (`*.test.ts`, `*_test.go`, …) | Header + ensure the code it tests has `@tested-by [[this-test]]` |
| **Markdown note** / **ADR** / **README** | Tier 4 frontmatter (§4) |
| **Config / generated** (`*.d.ts`, `*.min.js`, `package-lock.json`) | Usually excluded — don't tag unless asked |

### Step 3 — Apply the tiers (§3 + §4)

Work top-down: Tier 1 (every file) → Tier 2 (exports) → Tier 3 (core files) →
Tier 4 (notes). Never write Tier 3+ without Tier 1.

### Step 4 — Make every link bidirectional

For every edge you create in one direction, create the reverse (§8). A
unidirectional link is a dead-end in the graph.

### Step 5 — Leave TODO/FIXME honest and contextual

If you write a `TODO`/`FIXME`, include context (why, priority, owner). The node
will glow — make the glow meaningful, not noise (§9).

### Step 6 — Self-verify against the checklist (§10)

Before declaring done, run through the AI agent checklist. If any box is
unchecked for the files you touched, fix it.

---

## 3. Code files — the tiers

### Tier 1 — File header (MANDATORY on every source file)

Every source file begins with a header carrying `@file`, `@domain`, `@status`
(and `@author` where ownership matters). This is what makes domain coloring,
status coloring, and the Seed-domains command work.

```typescript
/**
 * @file Calculator engine — math expression evaluation
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
- `@domain` — free-text but MUST be **consistent** across the feature area and
  match the agreed vocabulary (Step 1). The plugin lowercases it internally.
- `@status` — exactly one of `stable`, `wip`, `deprecated`. (Notes may also use
  `accepted`, `draft` — those are recognized but won't drive code-status coloring.)
- `@author` — free-text (rest of line); shown in the hover tooltip.
- `@file` — human-readable description; the Seed-domains command reads/rewrites it.
- Header may be a block comment (`/** */`), line comments (`//`, `#`), or any
  style — the extractor is style-agnostic.

**Graph effect:** `@domain` enables Color-by-Domain + domain-driven zone auras
+ community detection cross-referencing. `@status` enables Color-by-Status
(green=stable, amber=wip, red=deprecated). `@author` appears in the hover tooltip.

### Tier 2 — Symbol documentation (every exported symbol)

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
- `@param` / `@returns` / `@throws` are NOT parsed by the plugin — write them
  for IDEs and humans.
- `@see [[X]]`, `@tested-by [[X]]`, any `[[wikilink]]`, `@link x`, `ref: [[x]]`,
  `see also: [[x]]` ARE parsed → typed `comment-link` / `tested-by` edges.
- `X` may be a code file, a symbol, or a markdown note.
- Keep `@see` to the **3 most relevant** targets. More than 5 = noise; move the
  rest into a doc note.

### Tier 3 — Architecture links (important/core files only)

```typescript
/**
 * @adr [[ADR-001-Calculator-Architecture]]
 * @depends-on [[MathEngine]]
 */
```

- `@adr` → yellow dashed edge from code to the governing decision record.
- `@depends-on` → orange dashed edge declaring a semantic dependency not
  captured by imports (external service, concept, shared schema).
- Use these on **core/architectural files**, not on every utility.

---

## 4. Markdown notes — Tier 4 frontmatter

Every `.md` note in the vault should declare its relationship to code via
frontmatter. This closes the loop between documentation and implementation.

### Architecture Decision Record (ADR)

```markdown
---
related-code:
  - "[[Calculator.tsx]]"
  - "[[engine.ts]]"
domain: calculator
type: adr
status: accepted
author: josh
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

### Feature guide / spec / readme

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
```

**Frontmatter field reference (verified):**

| Field | Read? | Effect |
|-------|:-----:|--------|
| `related-code` | ✅ | `documents` edges (indigo, note → code) |
| `domain` | ✅ | Color-by-Domain + `domain:` groups + domain auras |
| `status` | ✅ | Color-by-Status + `status:` groups |
| `tags` | ✅ | `tag:<name>` color-group query |
| `author` | ✅ | Hover tooltip |
| `type` | ⚠️ | Parsed & stored, but not yet used by any color mode/query. Document for future use. |

> `related-code` entries must be Obsidian `[[wikilinks]]`. Body `[[wikilinks]]`
> also produce `md-link` edges (note → note) via Obsidian's link graph.

---

## 5. Edge-maximization guide — how to write code that produces each edge

**This is the optimization angle.** When code adheres to these patterns, the
graph populates automatically with the richest possible edge set. For each of
the 12 edge types, here is what triggers it and how to write code that maximizes
it honestly.

### 5.1 `imports` — Purple `#7c3aed`, solid, arrow `to`

- **Source:** AST (Tier A languages) or regex (Tier B languages).
- **Means:** File A statically imports/requires/includes from file B.
- **How to maximize:**
  - Use real, static `import`/`require`/`#include`/`use`/`import` statements —
    the plugin extracts the resolved target path. Avoid fully-dynamic imports
    (`import(variable)`) for anything you want graphed.
  - In Tier B languages, use the canonical import keyword for that language
    (`@import` CSS, `#include` C/C++, `use` Rust, `import` Go/Java, `require`
    Lua, `use`/`require` PHP) — see §7.
  - One import per source file is enough to create the edge; the weight
    reflects how many symbols flow across it.
- **Don't:** create fake imports just to draw lines.

### 5.2 `calls` — Blue `#2563eb`, solid, arrow `to`

- **Source:** AST only (Tier A: TS/TSX/JS/JSX/Py).
- **Means:** File A calls a function/method defined in file B.
- **How to maximize:**
  - Reference symbols that are **exported** from another file — the extractor
    resolves the call to the defining file.
  - Keep call sites explicit (`engine.evaluate(x)`, not `obj['eval'+'uate'](x)`).
    Dynamic dispatch isn't statically resolvable.
  - Files with many outgoing `calls` edges are hubs of runtime flow — these make
    great fan-out-sized nodes.

### 5.3 `contains` — Grey `#94a3b8`, solid, arrow `none`

- **Source:** AST only (Tier A). Aggregates to file-level (file → symbol) and
  class-level (class → method).
- **Means:** File A structurally contains symbol B (or class A contains method B).
- **How to maximize:**
  - Define top-level functions/classes/interfaces/types in their own files
    rather than one giant file — each definition becomes a containable symbol.
  - Turn on **Show symbols** in the graph to see these as nested nodes.
  - This edge type is **excluded from community detection** (it's structural,
    not a dependency) — so it won't skew clustering.

### 5.4 `inherits` — Pink `#db2777`, dashed, arrow `to`

- **Source:** AST only (Tier A).
- **Means:** Class/interface A extends a type from B.
- **How to maximize:**
  - Use explicit `extends` (TS/JS/Py class inheritance) — the parent's defining
    file becomes the edge target.
  - Changes to B propagate to all subclasses — the `inherits` web makes this
    blast-radius obvious in the graph.

### 5.5 `implements` — Teal `#0d9488`, dashed, arrow `to`

- **Source:** AST only (Tier A).
- **Means:** Class A implements interface B.
- **How to maximize:**
  - Declare `implements InterfaceName` explicitly. The interface's defining file
    becomes the target.
  - Lets you find all concrete implementations of an interface in one click.

### 5.6 `uses-type` — Purple `#a855f7`, dashed, arrow `to`

- **Source:** AST only (Tier A).
- **Means:** Symbol A references a type annotation defined in file B.
- **How to maximize:**
  - Annotate parameters, returns, and variables with types defined in other
    files (`function f(x: TokenType)`). Type-only dependencies show up here,
    separate from runtime `calls`.
  - Especially valuable for shared type/model files that would otherwise look
    "dead" — their type consumers create `uses-type` edges.

### 5.7 `tested-by` — Green `#22c55e`, solid, arrow `to`

- **Source:** `@tested-by [[test-file]]` tag in code comments.
- **Means:** Code A is verified by test file B.
- **How to maximize:**
  - In every module with a test, add `@tested-by [[engine.test.ts]]` to the
    symbol or file header.
  - A node with no `tested-by` edge is a **visible coverage gap** (green edge =
    tested, nothing = untested). This is the cheapest test-coverage signal you
    can get — use it.
  - Keep the target an existing test file; a dangling `@tested-by` is noise.

### 5.8 `adr-link` — Yellow `#eab308`, dashed, arrow `to`

- **Source:** `@adr [[ADR-note]]` tag in code comments.
- **Means:** Code A is governed by architecture decision B.
- **How to maximize:**
  - On core/architectural files, link the governing ADR: `@adr [[ADR-001-Auth]]`.
  - Create the ADR note with matching frontmatter (`related-code` pointing back,
    `type: adr`). Bidirectional = navigable both ways.

### 5.9 `depends-on` — Orange `#f97316`, dashed, arrow `to`

- **Source:** `@depends-on [[target]]` tag in code comments.
- **Means:** Code A depends on an external service/concept/API B.
- **How to maximize:**
  - Use for dependencies NOT captured by imports: a Stripe integration
    `@depends-on [[Stripe API]]`, a worker `@depends-on [[Redis]]`, a module
    `@depends-on [[Config Schema]]`.
  - Target can be a concept note or another code file. This reveals
    system-level coupling the import graph hides.

### 5.10 `documents` — Indigo `#6366f1`, solid, arrow `to`

- **Source:** Note frontmatter `related-code: [[code-file]]`.
- **Means:** Note A documents code file B.
- **How to maximize:**
  - Every doc note, ADR, spec, and README that touches code should list those
    files in `related-code`.
  - This is the **only** edge that connects the documentation world to the code
    world. Without it, notes and code exist on separate graph islands.

### 5.11 `comment-link` — Green `#16a34a`, dashed, arrow `to`

- **Source:** `[[wikilink]]`, `@see [[X]]`, `@link x`, `ref: [[x]]`,
  `see also: [[x]]` in code comments. Patterns are configurable in
  **Settings → Comment link patterns**.
- **Means:** A code comment references B (code, symbol, or note).
- **How to maximize:**
  - Use `@see [[RelatedModule]]` liberally — it's the cheapest way to connect
    code to docs and to other code that isn't an import.
  - Plain `[[wikilinks]]` anywhere in a comment also create this edge.

### 5.12 `md-link` — Grey `#9ca3af`, dashed, arrow `to`

- **Source:** Obsidian's `metadataCache.resolvedLinks` (note → note links).
- **Means:** Note A links to note B via a standard `[[wikilink]]` in its body.
- **How to maximize:**
  - Write notes that cross-reference each other with `[[wikilinks]]` — this is
    Obsidian's native graph, surfaced alongside the code graph.
  - Disabled if the user turns off `includeMdLinks` in settings.

### Edge-style cheat sheet (all 12)

| Edge | Hex | Style | Arrow | Trigger |
|------|-----|:-----:|:-----:|---------|
| imports | `#7c3aed` | solid | to | import/require/include statement |
| calls | `#2563eb` | solid | to | call to an exported symbol |
| contains | `#94a3b8` | solid | none | file/symbol containment |
| inherits | `#db2777` | dashed | to | `extends` |
| implements | `#0d9488` | dashed | to | `implements` |
| uses-type | `#a855f7` | dashed | to | type annotation reference |
| tested-by | `#22c55e` | solid | to | `@tested-by [[X]]` |
| adr-link | `#eab308` | dashed | to | `@adr [[X]]` |
| depends-on | `#f97316` | dashed | to | `@depends-on [[X]]` |
| documents | `#6366f1` | solid | to | frontmatter `related-code` |
| comment-link | `#16a34a` | dashed | to | `@see`/`[[wikilink]]`/`@link`/`ref:` |
| md-link | `#9ca3af` | dashed | to | note → note `[[wikilink]]` |

---

## 6. Node-maximization guide — how to produce each node kind

The graph has two node layers: **file-level containers** and **symbol-level
nodes** (shown when **Show symbols** is on). Each symbol kind gets a distinct
color, deliberately avoiding blue (reserved for file nodes).

### 6.1 File-level nodes (always rendered)

| Kind | When produced | Color |
|------|---------------|-------|
| `code` | Any file matching a configured code extension | by language (see below) |
| `note` | Any `.md` file (when **Show notes** is on) | note color |
| `other` | Any other recognized file | neutral |

**Language colors (Color-by-Language, the default):** TypeScript `#3178c6`,
TSX `#0ea5e9`, JavaScript `#f7df1e`, Python `#3776ab`, CSS `#cc6699`, C `#555555`,
C++ `#00599c`, Go `#00add8`, Rust `#dea584`, Java `#e76f00`, Lua `#5cc6c1`,
PHP `#777bb4`.

### 6.2 Symbol-level nodes (rendered with **Show symbols** on)

| Kind | Color | How to produce it |
|------|-------|-------------------|
| `function` | amber `#f59e0b` | Declare a top-level/exported `function` (TS/JS/Py) |
| `class` | red `#ef4444` | Declare a `class` |
| `method` | emerald `#10b981` | Declare a method inside a class |
| `interface` | purple `#a855f7` | Declare an `interface` (TS/JS) |
| `variable` | lime `#84cc16` | Declare a top-level `const`/`let`/`var` |
| `type` | pink `#ec4899` | Declare a `type` alias (TS) |
| `enum` | yellow `#eab308` | Declare an `enum` |
| `constant` | teal `#14b8a6` | Declare a named constant |

**How to maximize symbol nodes:**
- Tier A languages only (TS/TSX/JS/JSX/Py). In Tier B languages you get
  file-level nodes + `imports` edges, but no symbol nodes.
- Give each significant symbol a clear, unique name — it becomes the node label.
- Symbols aggregate into their containing file via `contains` edges; methods
  aggregate into their class.
- Symbol nodes participate in `calls` / `uses-type` / `contains` edges, making
  the fine structure of a file visible when you drill in.

### Node metadata the plugin surfaces

| Metadata | Source | Shown in |
|----------|--------|----------|
| `domain` | `@domain` / frontmatter `domain:` | coloring, auras, clustering |
| `status` | `@status` / frontmatter `status:` | coloring |
| `author` | `@author` / frontmatter `author:` | hover tooltip |
| `tags` | frontmatter `tags:` | `tag:` color-group query |
| `todoCount` | `// TODO:` lines | orange glow |
| `fixmeCount` | `// FIXME:` lines | red glow (overrides TODO) |
| `lines` | file LOC / symbol span | node sizing (`lines` mode) |
| fan-in / fan-out | incoming/outgoing edges | node sizing + tooltip |

---

## 7. Language support matrix

The plugin extracts `@tags`, `[[wikilinks]]`, `TODO`/`FIXME`, and frontmatter in
**every** language via regex. Structural edges (`imports`, `calls`, `inherits`,
`implements`, `uses-type`, `contains`) + symbol nodes require a tree-sitter
grammar (Tier A).

### Tier A — Full structural edges (tree-sitter AST)

| Language | Extensions | imports | calls | inherits | implements | uses-type | contains | symbols |
|----------|-----------|:-------:|:-----:|:--------:|:----------:|:---------:|:--------:|:-------:|
| TypeScript | `ts` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| TSX | `tsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| JavaScript | `js`, `jsx` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Python | `py` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

### Tier B — Imports only (regex, no AST)

| Language | Extensions | imports keyword | Structural edges / symbols |
|----------|-----------|-----------------|:--------------------------:|
| CSS | `css` | `@import` | — |
| C | `c`, `h` | `#include` | — |
| C++ | `cpp`, `cc` | `#include` | — |
| Go | `go` | `import` | — |
| Rust | `rs` | `use`, `extern crate` | — |
| Java | `java` | `import` | — |
| Lua | `lua` | `require` | — |
| PHP | `php` | `use`, `require` | — |

> **In Tier B languages, you still get the FULL `@tag` / `[[wikilink]]` /
> `TODO` / `FIXME` / frontmatter protocol.** Only structural edges are limited.
> So always apply Tier 1–4 regardless of language.

### Comment syntax per language (for all `@tags`)

| Language | Syntax | Example |
|----------|--------|---------|
| TS/JS | `/** @see [[X]] */` or `// @see [[X]]` | ✅ |
| Python | `# @see [[X]]` or `""" @see [[X]] """` | ✅ |
| Go | `// @see [[X]]` | ✅ |
| Rust | `// @see [[X]]` or `//! @see [[X]]` | ✅ |
| Java | `/** @see [[X]] */` or `// @see [[X]]` | ✅ |
| C/C++ | `// @see [[X]]` or `/* @see [[X]] */` | ✅ |
| CSS | `/* @see [[X]] */` | ✅ |
| Lua | `-- @see [[X]]` | ✅ |
| PHP | `// @see [[X]]` or `# @see [[X]]` | ✅ |

`[[wikilink]]` works everywhere. `@tag` works in any comment style.

---

## 8. Bidirectional link discipline (most important rule)

**Every link should be bidirectional.** Unidirectional links create dead-ends —
you can navigate one way but not back. The plugin does not warn about this; it's
your discipline.

| Direction | Code side | Note side |
|-----------|-----------|-----------|
| Code → Doc | `@see [[Architecture]]` | `related-code: [[engine.ts]]` |
| Code → Test | `@tested-by [[engine.test.ts]]` | (test file documents what it tests) |
| Code → ADR | `@adr [[ADR-001]]` | `related-code: [[Calculator.tsx]]` |

When you add a link in one direction, **always add the reverse**. When you
rename a target, update **all** `[[OldName]]` references in both directions.

---

## 9. TODO / FIXME convention

```typescript
// TODO(@author): Add support for complex numbers — #high
// FIXME: Division by zero returns Infinity — est. 2h
```

**Graph effect:** files with TODOs get an **orange glow**; files with FIXMEs get
a **red glow** (FIXME takes priority over TODO). This makes technical debt
visible at a glance.

**Rules:**
- A line is counted as TODO/FIXME only if it starts with a comment marker
  (`/`, `#`, `*`). So `// TODO:`, `# FIXME:`, `* TODO:` count; bare `TODO` in
  prose does not.
- Always include context: why, priority (#high/#low), or owner.
- `HACK:` and `REVIEW:` are **not** extracted — no glow. Don't rely on them for
  visibility.

---

## 10. AI agent checklist (run before declaring done)

For every file you created or modified:

- [ ] **Tier 1 header** present: `@file`, `@domain`, `@status` (and `@author`
      where ownership matters).
- [ ] **Domain** matches the agreed vocabulary exactly (Step 1) — same string,
      same casing convention.
- [ ] Every **exported symbol** with non-obvious behavior has ≥1 `@see [[X]]`
      link (≤3 relevant; never >5).
- [ ] Every module with a test has `@tested-by [[test-file]]`.
- [ ] Core/architectural files link their governing ADR via `@adr [[X]]`.
- [ ] External/conceptual dependencies declared via `@depends-on [[X]]`.
- [ ] Every **markdown note** has frontmatter: `related-code`, `domain`,
      `status`, `tags` (+ `type`, `author` as appropriate).
- [ ] **All links are bidirectional** (code → note AND note → code).
- [ ] Domain strings are **consistent** across related code AND note frontmatter.
- [ ] No `FIXME` left without context; `TODO`s carry priority or owner.
- [ ] No dangling `[[wikilinks]]` pointing at non-existent targets.

---

## 11. Interaction protocol — when to ask the user

**Ask (offering concrete suggestions) when:**
- **Domains are undecided** (Step 1) — always present your detected vocabulary
  as a numbered list and ask for confirmation/renames. Default to proceeding if
  no answer.
- **A target is ambiguous** — e.g., two notes named `[[Auth]]`. Ask which.
- **Overwriting existing tags** — if a file already has `@domain foo` and you
  propose `@domain auth`, confirm before overwriting (mirror the Seed-domains
  overwrite-guard behavior).
- **Bulk operations** — tagging >20 files at once: summarize the plan and confirm.

**Decide yourself (don't ask) when:**
- The domain vocabulary is already established — reuse it.
- Adding Tier 2 symbol docs or `@see` links to your own new code.
- Fixing obviously-dangling links during a rename.
- The user said "you decide" / "do it" / "graph-ify everything."

**Always explain what you did** in a short summary: which domains you applied,
which edges you created, and any links you made bidirectional.

---

## 12. Common mistakes (avoid these)

1. **Forgetting `@domain` on new files** → invisible in domain views. Always
   check for an existing header before writing code.
2. **Inconsistent domain names** (`auth` vs `authentication`) → two separate
   clusters. Agree on naming in Step 1 and enforce it.
3. **`@see` without a reverse `related-code`** → dead-end. Always add the
   back-link in the target note.
4. **Over-documenting internal helpers** → Tier 2 is for exported symbols. Save
   effort for the public API.
5. **Leaving `@status wip` forever** → false impression of instability. Update
   to `stable` when code settles.
6. **Too many `@see` links (5+)** → visual noise. Keep the 3 most relevant.
7. **Mixing case in `@status`** → the plugin lowercases it, but stay consistent
   (`stable`/`wip`/`deprecated` only).
8. **Dangling `@tested-by`** pointing at a non-existent test → remove it or
   create the test.
9. **Fabricating domains** for a tiny codebase → small projects legitimately
   have 1–2 domains; don't pad to 3.

---

## 13. Plugin features that consume the protocol

These settings/features read the metadata you produce — write documentation
knowing they exist:

### Color modes (node fill)
- **Language** (default) · **Domain** (`@domain`/frontmatter) · **Status**
  (`@status`) · **Community** (auto-detected via label propagation).

### Zone-aura heatmap (independent of node fill)
- `groups` (user color groups) · `community` · `domain`.

### Color-group query prefixes
`domain:<name>` · `path:<substr>` · `ext:<ext>` · `kind:<kind>` ·
`status:<s>` · `tag:<name>` · *(none = substring on name/path)*.

### Node sizing
`constant` · `lines` (LOC) · `degree` · `fan-in` · `fan-out`.

### Other toggles
Show symbols · Show notes · Show code files · Neighborhood hops · Highlight dead
code · Hover-focus spotlight · Edge animation · Physics (center/repel/link force,
link distance, stretchiness).

### Seed domains command
**Command palette → "Code Graph: Seed domains from codebase."** Discovers a
vocabulary from folder structure + community detection, shows a confirmation
modal, stamps `@file`/`@domain`/`@status` into code and `domain:` into notes.
**Idempotent** — re-running updates `@domain`/`@status` in place and preserves
all your `@see`/`@tested-by`/`@adr`/`@depends-on`/`[[wikilinks]]`. Recommend this
to the user for whole-project adoption; refine per-file afterward.

---

## 14. Quick tag reference

### Code comment tags (any language, case-insensitive)

| Tag | Syntax | Produces |
|-----|--------|----------|
| `@file` | `@file <desc>` | Header (consumed by Seed domains) |
| `@domain` | `@domain <name>` | Node metadata (coloring + aura + clustering) |
| `@status` | `@status <stable\|wip\|deprecated>` | Node metadata (coloring) |
| `@author` | `@author <name>` | Hover tooltip |
| `@see` | `@see [[Target]]` | `comment-link` edge |
| `@tested-by` | `@tested-by [[Target]]` | `tested-by` edge (green) |
| `@adr` | `@adr [[Target]]` | `adr-link` edge (yellow) |
| `@depends-on` | `@depends-on [[Target]]` | `depends-on` edge (orange) |
| `[[wikilink]]` | anywhere in comment | `comment-link` edge |
| `TODO` | `// TODO: <text>` | Orange glow |
| `FIXME` | `// FIXME: <text>` | Red glow |

**Not parsed:** `@module`, `@param`, `@returns`, `@throws`, `HACK`, `REVIEW`.
Write them for humans/IDEs only.

### Note frontmatter fields

```yaml
---
related-code: ["[[file.ts]]"]   # documents edges
domain: <name>                   # coloring + aura
status: stable|wip|deprecated|accepted|draft
type: adr|spec|guide|readme      # stored, not yet used by color modes
author: <name>                   # hover tooltip
tags: [<name>, ...]              # tag:<name> color-group query
---
```

---

*End of skill. When in doubt: detect domains first, apply Tier 1 to every file,
make every link bidirectional, and run the checklist. The graph will optimize
itself.*
