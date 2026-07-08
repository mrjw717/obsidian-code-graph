## Code Graph

Visualize how your code files connect — imports, calls, inheritance, implements, comment-links, ADRs, and tests — as an interactive graph alongside your notes.

### What's in this release

- **Tree-sitter AST parsing** for TypeScript, TSX, JavaScript, and Python (structural edges: imports, calls, inherits, implements, uses-type, contains, symbol nodes)
- **Regex-based imports extraction** for CSS, C, C++, Go, Rust, Java, Lua, and PHP
- **Documentation protocol**: `@see`, `@tested-by`, `@adr`, `@depends-on`, `@domain`, `@status`, `@author` tags + note frontmatter (`related-code`, `domain`, `status`, `tags`, `author`)
- **Seed domains command**: auto-discovers domain vocabulary, stamps `@file`/`@domain`/`@status` headers into code files
- **Interactive graph**: force-directed layout with color modes (language, domain, status, community), zone-aura heatmaps, color groups, node sizing, neighborhood filtering, dead-code highlighting, hover-focus spotlight
- **Self-contained install**: tree-sitter WASM grammars embedded as base64 in `main.js` — no external downloads needed
- **27 unit tests**: tagExtractor + seedDomains idempotency

### Requirements

- Obsidian 1.7.2 or later
- Desktop only (uses Node `fs` for tree-sitter WASM loading)