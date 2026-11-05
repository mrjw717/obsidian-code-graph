# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Dead-code highlight hardened against false positives (issue #5).** The red
  ring now means "true orphan": a node with zero incoming AND zero outgoing
  edges. Previously zero fan-in alone flagged every entry point (CLI scripts,
  `main.*`, top-level stylesheets — files that run constantly) as dead, and
  symbols flagged while their containing file was plainly reachable. Symbols
  now inherit their file's deadness (extracted into `src/graph/deadCode.ts`
  with unit tests). Entry-point functions (`mount`, `run`) no longer flagged.
- **Dead code is now actually findable (issue #5).** Three changes: (1) a
  zoom-independent red halo is drawn behind orphaned nodes in the
  `beforeDrawing` canvas hook — the node `shadow` was scale-projected by
  vis-network and vanished at fit zoom; (2) a "Dead code (N)" panel section
  lists orphaned files, clicking one zooms the canvas to it; (3) the
  isolated-node ring placement ran after the camera fit and used the average
  centroid as its center, flinging orphans up to thousands of px off-screen —
  the ring is now centered on the graph's bounding box and the camera
  re-fits after placement, so all orphans render in-frame.
- **Zone auras hardened against silent no-op and retuned as a heatmap
  (issue #5).** The default aura source ("Groups") drew nothing when enabled
  color groups matched zero indexed nodes (e.g. auto-seeded domain groups
  whose vocabulary was never stamped) — same symptom as "broken". The canvas
  now falls back to auto-detected community clusters and a panel hint
  explains the fallback in the Display section. After multi-zoom visual
  review (fit / 1× / 2.5×), the blob was rebuilt from a wide linear-fade
  bloom into a tight heatmap profile: ~44px screen-stable radius (was
  80px), center alpha 0.15 with a steep 4-stop falloff (0.6 / 0.2 / 0) so
  cores read dense and edges stay clean; additive blending stacks
  overlapping cores into heat-like hotspots. Singleton communities
  (isolated one-node clusters) draw at ~60% radius and half intensity so
  lone dots don't glow like real clusters.
- **Dead-code halo retuned for legibility (issue #5).** Halo center alpha
  raised 0.32 → 0.38 after an independent visual review, so the red glow
  stays readable over the aura drawn behind it.
- Java static-member imports (`import static pkg.Class.member`) now resolve
  by their class segment (previously the member name was tried and missed).

### Fixed

- Imports from modules living under roots invisible to static analysis now resolve
  through a conservative file-index fallback (unique name match only; ambiguous
  names stay unresolved, per the issue #4 design). Applied across all language
  profiles:
  - Python: sibling-folder modules reachable only via `sys.path` (#4)
  - Python: plain-import aliases (`import numpy as np`) and comma lists
    (`import os, sys`) now parse into one module per edge, so they resolve
    edge-to-edge instead of silently failing
  - Python: the plain `import` regex no longer swallows across newlines,
    which merged the following `from`-import into one garbage specifier
  - C/C++: headers reachable only through other `-I` include dirs
    (e.g. a sibling `include/` directory)
  - JS/TS: bare specifiers not covered by tsconfig paths (bundler/vendor roots)
  - Go: grouped `import ( ... )` blocks were never parsed; now extracted with
    per-entry line numbers. Module-path imports resolve by unique-name fallback
  - Rust: `use crate::...` / `use super::...` paths
  - Java: package imports (`com.example.Widget`) by class-file name
  - PHP: `use` namespaces by class name and non-`./` `require`s
  - Lua: dotted `require` against `package.path` roots
  - CSS: non-`./` `@import` targets
- Test tooling: `tsconfig.json` and ESLint now exclude the fixture-vault
  directory (`tests/Code Graph Issue Test`) whose imports are intentionally
  unresolvable; its `.obsidian` plugins no longer trip the project-service lint

## [1.0.9] - 2026-11-02

### Fixed

- Import resolution for subfolder/vault-root sibling modules (issue #2)
- Commented-out `from ... import` statements no longer leave stale edges (issue #3);
  comment/string masking added to import extraction across all profiles
- View close can no longer resurrect a vis-network instance on a detached canvas
- Metadata remerge no longer cancels a pending full reindex
- `onunload` cleanup for the reindex debounce
- tree-sitter: retryable core init, `Parser`/`Tree` freed on all paths
- Resolution is deterministic for ambiguous `[[link]]` targets

## [1.0.8] - 2026-11-02

### Changed

- 76% smaller bundle by removing `fs` references; declarative settings;
  tree-sitter WASM loaded via the vault adapter

## [1.0.7] - 2026-09-22

### Fixed

- Hovering no longer resurrects filtered-out nodes as unlabeled phantom nodes
  (stale `nodeBaseSize` map) (issue #1)

## [1.0.6] - 2026-09

### Changed

- `SKILL.md` renamed for skills.sh compatibility, install command,
  absolute media URLs

## [1.0.5] - 2026-09

### Changed

- AI skill docs consolidated into `skill.md` with AI operating protocol

## [1.0.4] - 2026-09

### Changed

- Hardcoded defaults removed; scales to 3000+ nodes; edge animations;
  golden-ratio physics

## [1.0.3] - 2026-09

### Fixed

- tree-sitter WASM loads through the vault adapter instead of Node `fs`

## [1.0.2] - 2026-09

### Fixed

- `fundingUrl` in the manifest; type stub for static analysis

## [1.0.1] - 2026-09

### Fixed

- Clean release (1.0.0 pointed at an old upstream tag)

[Unreleased]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.9...HEAD
[1.0.9]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.8...1.0.9
[1.0.8]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.7...1.0.8
[1.0.7]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.6...1.0.7
[1.0.6]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.5...1.0.6
[1.0.5]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.4...1.0.5
[1.0.4]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.3...1.0.4
[1.0.3]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.2...1.0.3
[1.0.2]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.1...1.0.2
[1.0.1]: https://github.com/mrjw717/obsidian-code-graph/compare/1.0.0...1.0.1
