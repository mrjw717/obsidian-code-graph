# Contributing to Code Graph

Thanks for your interest in improving Code Graph! This plugin visualizes code
relationships (imports, calls, inheritance, etc.) as an interactive graph
inside Obsidian, powered by [tree-sitter](https://tree-sitter.github.io/).

## Development setup

```bash
npm install      # install dependencies
npm run dev      # watch mode — rebuild on save
npm run build    # production build (tsc typecheck + esbuild minified)
npm run lint     # ESLint with eslint-plugin-obsidianmd
npm test         # vitest unit tests
```

> **Node 18+** is recommended. The package manager is **npm** (scripts and
> lockfile assume it).

## Project layout

```
src/
  main.ts              Plugin lifecycle (onload/onunload, commands, view wiring)
  settings.ts          Settings interface, defaults, settings tab
  types.ts             Shared graph types (GraphNode, GraphEdge, GraphModel)
  indexer/             Source parsing + edge extraction
    CodeIndexer.ts     Walks the vault, parses code, resolves references
    tree-sitter.ts     tree-sitter bootstrap (loads WASM via Obsidian's adapter)
    extractor.ts       Symbol/import extraction contracts
    resolver.ts        Cross-file symbol + import resolution
    profiles/          Per-language profiles (TS, TSX, JS, Python, ...)
    languages/         Language-specific tree-sitter query bindings
  graph/               Graph model construction + markdown-link merger
  ui/                  GraphView (vis-network), panels, menus
  commands/            Command implementations
scripts/               Build + diagnostic tooling
tests/                 vitest unit tests
```

`main.ts` is kept minimal — all feature logic lives in focused modules under
`src/`. See [`AGENTS.md`](./AGENTS.md) for the full coding conventions.

## The WASM embedding step

Code Graph embeds the tree-sitter core runtime + 4 grammar WASM files as base64
directly into `main.js`, so a fresh install from a GitHub release works with
only `main.js` + `manifest.json` + `styles.css` (no separate download).

- `scripts/copy-wasm.mjs` copies the used grammars from `node_modules` to `wasm/`.
- `scripts/embed-wasm.mjs` generates `src/indexer/wasm-embedded.ts` (gitignored).

Both run automatically as `prelint` / `pretest` / before `build`. If you add or
change a tree-sitter grammar, update the `NEEDED` list in `embed-wasm.mjs`.

At runtime, `src/indexer/tree-sitter.ts` reads grammars through Obsidian's
vault `DataAdapter` API (not Node `fs`), and falls back to materializing the
embedded bytes to disk on first use when the `wasm/` folder is absent.

## Testing & linting

- Add or update tests under `tests/` for any logic change. Run `npm test`.
- Every commit is linted by the GitHub Action in `.github/workflows/`.
- Run `npm run lint` locally before pushing — it mirrors the CI gate.

## Pull requests

1. Fork the repo and create a feature branch from `main`.
2. Keep `main.ts` minimal and split logic into focused modules.
3. Don't commit build artifacts (`main.js`, `node_modules/`, or the generated
   `src/indexer/wasm-embedded.ts`). They're gitignored.
4. Ensure `npm run lint`, `npm test`, and `npm run build` all pass.
5. Reference any issue in your PR description.

## Releasing (maintainers)

1. Bump `version` in `manifest.json` (SemVer). `npm version` runs
   `version-bump.mjs` to keep `manifest.json` and `versions.json` in sync.
2. The release workflow builds `main.js` + `manifest.json` + `styles.css`,
   attaches them to a GitHub release tagged with the exact version (no leading
   `v`), and attaches GitHub artifact attestations.

## License

By contributing, you agree your contributions are licensed under the
[0-BSD license](./LICENSE).
