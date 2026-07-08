# `src/indexer/profiles/`

The **language profile registry** — the single source of truth for "what
languages does this plugin understand, and how?"

Every other module consults this registry via `getProfile(langId)` or the
derived maps (`EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, `TREE_SITTER_LANGS`).
There are no scattered `if (lang === 'python')` or `switch (lang)` statements in
the indexer — all per-language dispatch flows through here.

## Files

| File | Purpose |
| ---- | ------- |
| `types.ts` | `LanguageProfile` interface + `ResolveContext`. The contract. |
| `_regexRunner.ts` | Shared `runImportRegexes()` helper — the verbatim extraction loop from the retired `importRegex.ts`. Used by every profile whose imports are regex-driven. |
| `javascript.ts` | JS family profiles (typescript, tsx, javascript). Share import syntax, resolution, and the tree-sitter extractor. |
| `python.ts` | Python profile. Distinct import syntax + dotted-module resolution + its own extractor. |
| `imports-only.ts` | Imports-only profiles: css, c, cpp, go, rust, java, lua, php. These extract `imports` edges via regex but do NOT extract `calls`/`inherits`. |
| `registry.ts` | Assembles all profiles into `PROFILES` and **derives** `EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, `TREE_SITTER_LANGS` from it. |
| `index.ts` | Public barrel. Import from here: `import { getProfile } from './profiles'`. |

## The contract

A `LanguageProfile` bundles everything the indexer needs for one language:

```ts
interface LanguageProfile {
  id: string;                            // tree-sitter language id
  extensions: readonly string[];         // file extensions this profile handles
  grammar?: string;                      // grammar wasm filename (if any)
  hasSymbolExtraction: boolean;          // can produce calls/inherits edges?
  usesTsConfig: boolean;                 // consult tsconfig for path aliases?
  extractImports(content): ImportSpec[]; // regex or tree-sitter
  resolveImport(ctx): string | null;     // specifier → vault-absolute path
  extractSymbols?(tree): SymbolExtract;  // optional tree-sitter symbol extractor
}
```

## Adding a new language

1. **Pick the right file.** If the language shares syntax with an existing
   family (e.g., a JS dialect), extend that family file. Otherwise add to
   `imports-only.ts` (for imports-only) or create a new `profiles/<lang>.ts`
   (if you're adding a tree-sitter extractor).

2. **Define the profile object:**
   ```ts
   export const KOTLIN_PROFILE: LanguageProfile = {
     id: 'kotlin',
     extensions: ['kt', 'kts'],
     grammar: 'tree-sitter-kotlin.wasm',
     hasSymbolExtraction: false,        // bump to true once you write extractSymbols
     usesTsConfig: false,
     extractImports: (content) => runImportRegexes(content, KT_REGEXES),
     resolveImport: resolveAsRelative,
   };
   ```

3. **Register it** in `registry.ts`:
   ```ts
   export const PROFILES = {
     ...,
     kotlin: KOTLIN_PROFILE,
   };
   ```

4. **Add the extension** to `DEFAULT_SETTINGS.codeExtensions` in `src/settings.ts`
   if it isn't already covered.

5. **(Optional) Ship the grammar wasm.** Drop `tree-sitter-kotlin.wasm` into
   `node_modules/@repomix/tree-sitter-wasms/out/` so `esbuild.config.mjs`'s
   `copyWasmAssets()` picks it up on the next build. The grammar must also be
   listed in `LANG_TO_GRAMMAR` — but that's **derived** from `profile.grammar`,
   so step 2 already handled it.

That's it. `EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, and `TREE_SITTER_LANGS` all
update automatically because they're derived from the registry.

## Upgrading an imports-only profile to full symbol extraction

1. Write an extractor following the pattern in `languages/typescript.ts` —
   a tree-walk that plucks `defines`, `references` (calls), and `inherits`.
2. In the profile, set `hasSymbolExtraction: true` and add
   `extractSymbols: yourExtractor`.
3. The indexer will now call `parseSource(lang, content)` for that language and
   feed the tree to your extractor. `calls` and `inherits` edges start flowing.

## Why a registry (not switches)

Before this layer, adding a language meant editing **four** places in sync:
`EXTENSION_TO_LANG`, `LANG_TO_GRAMMAR`, `TREE_SITTER_LANGS`, and the
`if/else if/else` chain in `CodeIndexer.extract()`. They drifted easily. The
registry collapses all four into one derived view of one source list, so it's
structurally impossible for them to disagree.
