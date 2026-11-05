# Test 5 — Edge matrix, dead code, zones

Fixture suite for the Code Graph plugin. Every module/file basename in this
folder is unique vault-wide (the "t5_" prefix plus unique class names), so
fallback name resolution is never ambiguous and no name collides with the
older fixture suites (which use names like "alpha", "beta", "logger", "run",
"spinner", "config", "theme", "boot", "strings", "invoice", "deposit").

All expectations below assume a full reindex. Symbol-level edges (calls,
inherits, implements, uses-type, contains) are only produced for
TypeScript-family, JavaScript-family (incl. tsx/jsx), and Python files; every
other language contributes file-level edges only. Python does not emit
implements or uses-type edges (extractor gap).

## 1. Dead-code expectations

Ring rule (hardened): a node shows the red ring only when its FILE has zero
incoming and zero outgoing edges of any type other than contains. Files that
import (or call) anything are not dead. Symbols inherit their file's state.

| File | Expected edges | Ring | Why |
| --- | --- | --- | --- |
| 01-dead-code/entry/t5_cli_entry.py | imports to t5_hub_helper.py; calls (run) to t5_hub_helper.py | Not dead | Outgoing imports and calls edges exist — an entry point importing something is never dead. |
| 01-dead-code/hub/t5_hub_helper.py | incoming imports from t5_cli_entry.py; incoming bracket-comment link from t5_tagged.go; contains edges to symbols run and unused_private | Not dead | Has incoming non-contains edges. Contains edges to run/unused_private are symbol-level data only. |
| 01-dead-code/orphan/t5_never_referenced.py | none | DEAD | No edges of any kind. Pure "X = 1" content, referenced by nothing. |
| 01-dead-code/orphan/t5_defs_no_links.py | contains edges to t5_defs_open and t5_defs_close; same-file call t5_defs_open to t5_defs_close | DEAD | Same-symbol-file internal calls should not produce file-level call edges (the symbol is defined only in its own file), and nothing external imports or calls it — file lands contains-only. Symbols inherit the dead state. |

## 2. Zone / cluster expectations

Three loosely-coupled clusters under 02-zone-communities. Cross-cluster
imports are zero by construction, so community/zone detection should surface
exactly three auto-detected groups: AZN (zone-alpha, TypeScript),
BZN (zone-beta, Python), GZN (zone-gamma, JavaScript). Every file carries at
least one non-contains edge, so none of the nine files shows a red ring.

| Cluster | Files | Internal wiring |
| --- | --- | --- |
| AZN | t5_azn1.ts, t5_azn2.ts, t5_azn3.ts | azn1 imports and calls t5ZanTwoTick (azn2) and t5ZanThreeTick (azn3) |
| BZN | t5_bzn1.py, t5_bzn2.py, t5_bzn3.py | bzn1 imports t5BetaVal (bzn2) and t5BetaEcho (bzn3); bzn2 imports t5BetaTag (bzn3) |
| GZN | t5_gzn1.js, t5_gzn2.js, t5_gzn3.js | gzn1 requires gzn2 and gzn3 and calls t5GazTwoTick / t5GazThreeTick |

## 3. Edge-type matrix

Legend: — means no edge of that type is expected; "no edge (by design)" marks
stdlib/declaration forms the indexer deliberately ignores. Symbol-level
columns (Calls, Inherits, Implements, Uses-type) apply only to TS/JS/Python
rows.

| File | Imports | Calls | Inherits | Implements | Uses-type | Comment-link | Tagged | Notes-derived | Dead ring? |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 01-dead-code/entry/t5_cli_entry.py | t5_hub_helper.py | run, into t5_hub_helper.py | — | — | — | — | — | — | No |
| 01-dead-code/hub/t5_hub_helper.py | — | — | — | — | — | — | — | — | No |
| 01-dead-code/orphan/t5_never_referenced.py | — | — | — | — | — | — | — | — | YES (dead) |
| 01-dead-code/orphan/t5_defs_no_links.py | — | (same-file only, no file-edge) | — | — | — | — | — | — | YES (dead) |
| 02-zone-communities/zone-alpha/t5_azn1.ts | t5_azn2.ts, t5_azn3.ts | t5ZanTwoTick, t5ZanThreeTick (same two files) | — | — | — | — | — | — | No |
| 02-zone-communities/zone-alpha/t5_azn2.ts | — | — | — | — | — | — | — | — | No |
| 02-zone-communities/zone-alpha/t5_azn3.ts | — | — | — | — | — | — | — | — | No |
| 02-zone-communities/zone-beta/t5_bzn1.py | t5_bzn2.py, t5_bzn3.py | t5BetaEcho into t5_bzn3.py | — | — | (n/a: Python) | — | — | — | No |
| 02-zone-communities/zone-beta/t5_bzn2.py | t5_bzn3.py | t5BetaTag into t5_bzn3.py | — | — | (n/a: Python) | — | — | — | No |
| 02-zone-communities/zone-beta/t5_bzn3.py | — | — | — | — | (n/a: Python) | — | — | — | No |
| 02-zone-communities/zone-gamma/t5_gzn1.js | t5_gzn2.js, t5_gzn3.js | t5GazTwoTick, t5GazThreeTick | — | — | — | — | — | — | No |
| 02-zone-communities/zone-gamma/t5_gzn2.js | — | — | — | — | — | — | — | — | No |
| 02-zone-communities/zone-gamma/t5_gzn3.js | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/ts-family/t5_ts_consumer.ts | t5_ts_camera.ts, t5_ts_actions.ts, t5_ts_kit.ts | new T5Camera into t5_ts_camera.ts; t5TsSnapshot into t5_ts_actions.ts; member call t5Cam.snap() may add a call ref only if the resolver handles member names, otherwise no extra edge | T5Base into t5_ts_kit.ts | T5Mountable into t5_ts_kit.ts | T5RigState into t5_ts_kit.ts | — | — | — | No |
| 03-edge-matrix/ts-family/t5_ts_camera.ts | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/ts-family/t5_ts_actions.ts | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/ts-family/t5_ts_kit.ts | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/tsx/t5_tsx_screen.tsx | t5_tsx_chip.tsx | T5ScreenShell to T5BadgeBox via JSX tag | — | — | — | — | — | — | No |
| 03-edge-matrix/tsx/t5_tsx_chip.tsx | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/javascript/t5_js_boot.js | t5_js_wire.js (require form) | t5JsWire (syms defined in required file resolve; symbol-level t5JsRun-to-t5JsWire is defined in an imported file so it may surface) | — | — | — | — | — | — | No |
| 03-edge-matrix/javascript/t5_js_wire.js | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/python/t5_py_orchestr.py | t5_py_kit.py | t5PyCharge (module scope) and T5Pump (inside t5_py_flow) into t5_py_kit.py | T5Pump into t5_py_kit.py | (no edge: Python gap) | (no edge: Python gap) | t5-notes-hub.md (plain bracket comment) | — | — | No |
| 03-edge-matrix/python/t5_py_kit.py | — | — | — | — | (n/a: Python) | — | — | — | No |
| 03-edge-matrix/c/t5_c_engine.c | t5_c_types.h (quoted, same dir); t5_c_math.h (angle, resolved to c/inc/); t5_c_remote.h (quoted via index fallback to c/remote/) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/c/t5_c_types.h | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/c/inc/t5_c_math.h | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/c/remote/t5_c_remote.h | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/cpp/t5_cpp_scene.cpp | t5_cpp_mesh.hpp (quoted, same dir); t5_cpp_core.hpp (angle, resolved to cpp/core/) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/cpp/t5_cpp_mesh.hpp | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/cpp/core/t5_cpp_core.hpp | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/go/t5_go_app.go | t5_go_store.go via path "pkg/t5_go_store" (single inline and grouped forms); "fmt" → no edge (by design, stdlib) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/go/pkg/t5_go_store/t5_go_store.go | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/rust/t5_rs_main.rs | t5_rs_inventory.rs via use crate form; t5_rs_gpu.rs via use core form (basename fallback); "mod t5_rs_inventory;" → no edge (by design) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/rust/t5_rs_inventory.rs | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/rust/t5_rs_gpu.rs | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/java/t5_java_boot.java | T5Spinner.java and T5Ids.java (class basename fallback); static import also resolves via T5Ids | — | — | — | — | — | — | — | No |
| 03-edge-matrix/java/t5_java_widgets_t5/T5Spinner.java | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/java/t5_java_utilx_t5/T5Ids.java | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/lua/t5_lua_boot.lua | t5_lua_calc.lua (unparenthesized require and parenthesized require both covered via t5_lua_read.lua) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/lua/t5_lua_calc.lua | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/lua/t5_lua_read.lua | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/php/t5_php_front.php | T5Ledger.php via use clause (namespace class fallback); t5_php_config.php via require; t5_php_boot.php via include_once | — | — | — | — | — | — | — | No |
| 03-edge-matrix/php/src-t5/T5Ledger.php | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/php/inc-t5/t5_php_config.php | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/php/inc-t5/t5_php_boot.php | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/css/t5_css_app.css | t5_css_base.css (same-dir form) and t5_css_theme.css (url-quoted form from css/theme-t5/) | — | — | — | — | — | — | — | No |
| 03-edge-matrix/css/t5_css_base.css | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/css/theme-t5/t5_css_theme.css | — | — | — | — | — | — | — | — | No |
| 03-edge-matrix/tags/t5_tagged.go | — | — | — | — | — | t5-notes-hub.md (bracket comment, appears twice), t5-notes-spec.md (see comment), t5_hub_helper.py (link comment) | tested-by to t5-notes-spec.md; adr to t5-notes-adr7.md; depends-on to t5-notes-hub.md | — | No |
| 03-edge-matrix/notes/t5-notes-hub.md | — | — | — | — | — | — | — | documents edges to t5_hub_helper.py and t5_go_app.go (frontmatter related-code list); md-links to t5_ts_consumer.ts (bracket link) and t5_go_app.go (inline markdown link to the code node) | No |
| 03-edge-matrix/notes/t5-notes-spec.md | — | — | — | — | — | — | — | md-link to t5_py_orchestr.py | No |
| 03-edge-matrix/notes/t5-notes-adr7.md | — | — | — | — | — | — | — | (incoming only) | No |

### No-edge cases that are intentional (do not "fix")

- Go: the "fmt" import is standard library; the indexer resolves Go imports by
  basename fallback and must not emit an edge for it. It appears twice (inline
  and grouped) so both syntaxes are exercised.
- Rust: "mod t5_rs_inventory;" contributes no edge; the use statements are the
  productive form.
- The JSX member call and TS member call (t5Cam.snap) are documented as
  best-effort; the file-level edge to t5_ts_camera.ts is already guaranteed by
  the constructed class call.
- Python emits no implements/uses-type edges today; matrix cells are marked
  rather than fixed, so a future extractor change is visible in the diff.

## 4. Deviations from the design brief (deliberate)

- The bracket-comment target "t5_hub_helper" is linked from the tagged Go file
  instead of the orphan Python file. A link-comment edge into
  t5_never_referenced.py would give it an incoming edge and flip it to
  not-dead, corrupting dead-code case 1; t5_hub_helper.py is already alive via
  the imports edge, so testing the same link-comment pattern costs nothing.
- 02-zone comment: none of the zone files carry comment links, keeping the
  three clusters cleanly separable for zone detection.

---

## Verified results (2026-11-03, plugin build 1.0.10-dev)

Live verification via reindex + a data dump from the running graph view
(123 nodes, 142 edges, 101 edges involving Test 5 fixtures).

### Edge matrix — all 12 edge types confirmed live

| Edge type | Observed | Key fixture confirmation |
|---|---|---|
| imports | 45 total | all 10 language folders resolved, incl. angle `#include "t5_c_math.h"`, include-path `#include "t5_c_remote.h"`, Go grouped block, Lua paren form, PHP use/require/include_once |
| calls | 35 (file+symbol) | ts/py/js + JSX `<T5BadgeBox />` (T5ScreenShell -> T5BadgeBox) |
| inherits | 4 | class Extends (ts + symbol) and Python superclasses |
| implements | 1 | ts `implements` only (as designed; python does not emit) |
| uses-type | 3 | ts annotation + file fallback + symbol fallback |
| contains | 46 | file->symbol and class->method for ts/js/py only |
| comment-link | 5 | all four patterns; note the "tagged" duplication: a tag pattern target also fires the generic bracket pattern (expected) |
| tested-by / adr-link / depends-on | 1 each | from t5_tagged.go comment lines |
| documents | 2 | frontmatter `related-code` in t5-notes-hub.md |
| md-link | 3 | after qualifying wikilinks with the file extension (`[[t5_ts_consumer.ts]]`); bare-name wikilinks to code files did NOT register (Obsidian resolvedLinks behavior) |

### Known product gaps found while verifying (fixed or documented)

- Java `import static pkg.Class.member` previously failed to resolve (the
  member segment was tried last and never matched the class file). Fixed:
  the class segment is now tried before the bare member name. Verified:
  T5Ids.java fan-in 1 after fix.
- Zone auras: in the default "Groups" aura source with zero enabled color
  groups the renderer silently drew nothing (the failure reported in
  issue #5). The panel now shows an explanatory hint inside the Display
  section, and switching the aura source to Auto renders community halos.
- md-link for code-file wikilinks needs the extension in the link.

### Dead-code verdict (after hardening)

Only true orphans get the red ring now: `orphan/t5_never_referenced.py`,
`orphan/t5_defs_no_links.py` (+ its two symbols), and the `Ambiguous/`
legacy pair. Every previously false-flagged entry point (main.c/go/rs/ts,
main.css, index.php, boot.lua, launcher.java, alpha/playground.py) is no
longer flagged, and symbols inside referenced files are not flagged either.

### Verification addendum — dead-code visibility (same day)

Final sweep found one more real bug that made dead code effectively invisible:
the isolated-node ring placement ran AFTER the camera fit and used the
average centroid as its circle center, so on an elongated graph the ring
radius inflated and orphans were pinned far off-screen (up to y = -3435 px).
Hardened: the ring center is now the bounding-box center, and the camera
re-fits after placement. Evidence: all five dead fixtures render in-frame
with constant screen-size red halos plus the panel "Dead code (5)" navigator
(click-to-zoom).

### Verification addendum — zone auras + dead-halo review (2026-11-05)

Two reviewer findings from the issue-5 session applied and verified live in
this vault (plugin build 1.0.10-dev, reloaded and re-tested via CDP):

- **Groups aura fallback.** With the default "Groups" aura source and every
  color group query matching zero indexed nodes, the canvas now falls back
  to auto-detected community clusters instead of drawing nothing, and the
  panel hint explains the fallback ("Aura source is Groups, but no enabled
  group matches indexed files — zones use auto-detected community clusters
  right now"). Confirmed: community halos render in Groups mode without any
  group enabled, and the hint text updates.
- **Tuning.** Aura blob alpha 0.06 → 0.10 center (0.06 was invisible over
  additive blending; 0.12 washed out dense regions) and 0.03 → 0.04 for the
  cheap solid-circle LOD. Independent review verdict on the tuned captures:
  PASS with minor recommendations, of which the dead-code halo center alpha
  was raised 0.32 → 0.38 so the red glow stays legible over the aura
  underneath (sanity capture after the bump: halo visible at zoom and at
  fit, graph still readable). Reviewer's remaining nice-to-have (smaller
  singleton auras) was deferred as cosmetic.
- Plugin-UI strings the reviewer touched are now lint-clean: dead-code
  legend rows and the aura hint are styled via `styles.css` classes
  (`code-graph-node-preview.is-dead`, `code-graph-hint.is-inline`) instead
  of inline style writes.

### Verification addendum — heat retune + group→aura color E2E (2026-11-05)

Follow-up polish submitted after the first addendum, verified live in this
vault (build 1.0.10-dev):

- **Deferred singleton polish applied.** Community labels with exactly one
  member (isolated nodes) now draw at 60% radius and half intensity;
  verified in-vault: 54 communities, 19 singleton labels, all of them the
  edge-less nodes — singleton halos no longer dwarf lone dots.
- **Heatmap retune.** User critique of the first tuning: too bloomy and
  spread out at every zoom. The blob was rebuilt as a heatmap profile —
  ~44px screen-stable radius (was ~80px), center alpha 0.15 with a steep
  4-stop falloff (×0.6 / ×0.2 / 0) so cores read dense and the edge is
  clean; overlapping cores stack into heat hotspots. Zoom sweep critiqued
  at fit / 1× / 2.5×: fit shows compact hotspots with clean separation,
  mid-zoom pins a tight glow to matched nodes (merging with the group-tinted
  node fill), close zoom shows no fog with blobs staying screen-stable.
- **Group color → aura linkage E2E-tested, not just eyeballed.** Pixel
  sampled
  from the composited graph canvases at a node matched by a temporary
  `path:php` test group (red `#ff2020`, an exclusive match for that node):
  baseline rgb(255,30,30) — group red; after changing the group color to
  `#2244ff` live: rgb(35,70,255) — group blue (settings are read per frame,
  no stale cache); after disabling the group: rgb(208,47,136) — the
  community-fallback color for that node, proving both the color linkage and
  the disabled-group path. Settings were restored afterwards. Gap analysis
  of the wiring: aura color, legend dot, and node-fill override all read the
  same `ColorGroup.color` field, so a color change applies to all three
  consistently; enabling/disabling a group is evaluated per frame with no
  persistence gap.

### Verification addendum — user critiques round 2 (2026-11-05, later)

Three critiques from live use, each fixed and re-verified in this vault:

- **"Hard to see when zoomed in."** A screen-stable 44px blob shrinks
  relative to the node as you zoom (the node's own radius grows on screen),
  so the glow ended up hidden under the dot. The blob radius is now
  per-node: `max(44px screen-stable base, ~1.8× the node's on-screen
  radius)`, reading as a halo/heat disk at every zoom level.
- **"I don't like the soft feel."** The gradual gradient read as a blur.
  Replaced with a crisp heat-disk: flat core (alpha 0.20) holding ~45% of
  the radius, ×0.85 at mid, ×0.35 at 80%, ×0.08 at the rim — defined disks
  under additive blending instead of fog. Solid-circle LOD alpha 0.05 → 0.07.
- **"When I turn groups off the auras don't disappear."** Root cause: the
  earlier zero-match auto-fallback to community clusters meant groups-mode
  auras were always on, so group toggles appeared broken. Groups mode now
  follows the toggles exactly — no auras on zero match; the panel hint tells
  the user to switch the auras selector to Auto (community) for
  auto-clustering instead. Panel re-renders on toggle so the hint tracks
  enabled groups. E2E pixel sampling on a `path:php` node (build reloaded,
  then settings restored): group on → rgb(255,32,32) group red; group off →
  rgb(0,0,0) nothing; Auto mode → rgb(214,52,142) community color. Also
  removed an earlier e2e test group that had leaked into the vault's saved
  settings (`path:php`).

### Verification addendum — user critique round 3: "no auras even when all are on" (2026-11-05, later)

Root cause found and fixed, verified live in this vault (CDP drive):

- **Gap**: "Auto-seed groups" created the five `domain:*` color groups but
  nothing stamped domains into files, so every seeded group matched zero
  indexed nodes. With the corrected toggle semantics, groups mode with
  zero matches correctly drew no auras — leaving only the dead-code halos
  visible ("i see dead code aura").
- **Fix**: the button now stamps the discovered domains (via the same
  discovery + apply pipeline as the "Seed domains" command, without the
  modal) into files lacking an existing domain, then reindexes. Never
  overwrites an existing domain.
- **Result**: model domain stamping went 0 → 60 files; the five existing
  groups (web/php/c/test-5/ambiguous) match their files and draw auras in
  the user's group colors (screenshot `auras_after_seed.png` in evidence).
  Any vault with auto-seeded groups can get the same result by pressing
  Auto-seed groups once.
- **Round 4 — "not working for ALL groups": the test-5 group still had 0
  matches.** Stamping had written `@domain test 5 - edge matrix + dead code
  + zones` correctly, but the tag extractor's `/@domain\s+(\S+)/` truncated
  the value at the first space ("test"), so 51 files matched nothing.
  Fixed the extractor (and the seedDomains matcher) to take the full
  multi-word tag value, stripping a trailing comment-close delimiter;
  two unit-test cases added. Re-verified after reindex: all five groups
  match (web 4, php 3, c 3, test 5 — 51: was 0, ambiguous 3) and auras
  render for every group (evidence `auras_all_groups.png`, copied to this
  folder).

### Audit: auto-seed groups wiring gap analysis (2026-11-05, later)

End-to-end audit: button → discovery → group creation → stamping →
reindex → view refresh → panel hint → aura render.

**Fixed by the audit (live-verified):**
- *Model-change hash ignored tag metadata.* `computeModelHash` hashed
  node/edge counts + lines/todos/weights only. A reindex whose only
  effect is re-parsing tags (i.e. exactly what stamping produces when
  files already carried correct headers) produced an identical hash, so
  `renderGraph()` skipped the rebuild: aura colors (which read the fresh
  model per frame) recovered only on the next camera/physics redraw, but
  node fill overrides, the dead-code set and community labels stayed at
  pre-reindex values far longer. Empirical proof (pre-fix): mutating
  `node.domain` live and calling `renderGraph()` left
  `lastModelHash` unchanged (`107:122:1024:134`). Post-fix the hash now
  folds `domain`/`status`/`tags` per node (`107:122:1024:134:86025` vs
  `:84881` for a one-node change) and `renderGraph()` rebuilds.
- *Notes were never discovered (gap closed).* `discover()` filtered
  `kind !== 'code'`, so the md frontmatter branch of the stamper was
  unreachable and notes could not join any `domain:` group. Notes are
  now seedable; in this vault all 3 notes gained frontmatter
  `domain: test 5 - edge matrix + dead code + zones` (verified in the
  model and on disk) and the group's live count went 51 → 54.
- *Vault-root files were skipped (gap closed).* Files with no folder
  segment previously left discovery entirely; they now take the same
  community-merge path as trivial folders (nearest candidate by shared
  community label), with alphabetical tie-breaking for stable runs.
- *Palette collisions (gap closed).* Group colors are now chosen via a
  pure `nextGroupColor()` helper that skips colors already taken by
  existing groups AND hues within 24° of them (`hexHue`/`hueDist`
  helpers, unit-tested) — the web/php near-twin oranges can no longer
  come from auto-seed.
- *Group rows now show LIVE match counts.* The row count previously
  displayed the query string; display names freeze seed-time counts
  ("test 5 ... (47)" vs 51 actually matching). Rows show the current
  match count per query (web 4 / php 3 / c 3 / test-5 54 / ambiguous 3
  in the live vault).
- *Single discovery per click (gap closed).* Button now calls one
  exported `autoSeedDomains()` (discover once → create groups from the
  same assignment map → stamp → reindex → notice) instead of
  `discoverDomains()` + `stampDiscoveredDomains()` (two discoveries).

**Documented gaps (accepted, by design or low impact):**
- Pressing the button stamps domains even when all groups already exist
  (by design — it is the fix path for a vault whose groups predate
  correct stamping), and writes remain visible via the Notice.
