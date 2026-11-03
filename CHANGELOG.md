# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
