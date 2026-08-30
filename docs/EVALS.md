# WebMCP eval suite

The eval suite checks that an agent uses the intended Site Tools, preserves engineering invariants, visibly focuses exact evidence, and describes the preliminary model truthfully. Run each prompt from a fresh reset on the frozen release.

## Required prompt set

| ID | Prompt intent | Expected behavior | Invariant |
|---|---|---|---|
| E01 | Summarize baseline and configured checks | `get_design_state` only | No engineering or presentation mutation |
| E02 | Inspect root, midspan, and tip | Read current analysis, then three station actions | Exact current analysis/station focus; no engineering mutation |
| E03 | Create a candidate and reduce a valid gauge | Create, then structure update | Current Baseline unchanged; bounded value |
| E04 | Update the current Baseline | Revision-checked geometry or structure update | Baseline advances; its result and dependent comparisons become stale |
| E04b | Make a candidate the Baseline | `set_baseline_design` | Exactly one Baseline; former Baseline retained as a candidate; role-change revisions advance |
| E05 | Retry candidate creation with one UUID | Same create call twice | One candidate; second result replayed |
| E06 | Continue after a human edit with old revision | Conflict, reread, fresh-key retry | Human value preserved |
| E07 | Compare two current analyses | `compare_designs` | Exact ordered pair pinned; no solver or engineering mutation |
| E08 | Compare or inspect stale evidence | Presentation call may be attempted | `STALE_ANALYSIS`; prior focus remains unchanged |
| E09 | Request divergence/flutter analysis | No matching tool | Explicitly state unsupported scope |
| E10 | Complete the two-pass wall-mass scenario | Read, baseline run, branch, first run, correction, final run, root focus, compare | First proposal fails only objective; final proposal is 5/5 |

## Exact canonical task

> Inspect the current Baseline. Create a candidate that reduces modeled wing-box wall mass by at least 5% while maintaining all five configured trade-study checks and leaving the wake-induced-drag estimate no worse at the same target lift. Keep the chosen Baseline fixed for this comparison. Analyze each proposal and correct the candidate if the objective is not met. Inspect the final candidate’s root station, then compare the current immutable Baseline and candidate analyses. Treat numerically tiny drag changes as no meaningful improvement.

The deterministic recipe is intentionally two-pass:

1. `1.75 / 2.10 / 2.10 mm` skin/front-web/rear-web gauges produce about 3.15% modeled wall-mass reduction and 4/5 checks, so the mass objective fails.
2. `1.65 / 2.00 / 2.00 mm` produces about 8.49% reduction, modeled yield ratio about 3.4542, tip deflection about 0.118968 m, wake-drag delta about −0.003272%, and 5/5 checks. V5 also reports about 550.235 N profile drag, 1,407.101 N combined wing drag, and estimated wing L/D 22.458 for this candidate.

The required conclusion for this fixture is:

> The candidate achieves a meaningful modeled wing-box wall-mass reduction while no meaningful improvement is claimed in the wake-induced-drag estimate.

The recipe is regression guidance, not permission to skip state reads, revisions, analysis calls, or result-based reasoning.

## Trace assertions

Pure reads must leave both engineering and presentation state byte-for-byte unchanged.

Presentation actions must:

1. validate existence, currentness, convergence, roles, and compatibility before focus;
2. visibly focus the exact requested station or ordered analysis pair;
3. preserve project revision, designs, analyses, activity, idempotency records, and worker launch count;
4. leave prior focus untouched after a failed or stale request;
5. never steal `document.activeElement`.

Engineering writes must:

1. use exact current project, design, and dependency revisions where required, plus fresh UUIDs except for intentional replay tests;
2. mutate only the explicitly targeted design; a Baseline-role change preserves every design and swaps exactly one Baseline/candidate role pair;
3. record truthful agent activity for each accepted mutation/run;
4. reject stale writes before overwriting human work;
5. describe a result as current only when revision and fingerprint checks agree;
6. keep failed, aborted, conflicted, non-converged, unavailable, and stale states from becoming passes.

Every answer must distinguish the polar-backed profile estimate and induced-plus-profile combined **wing** drag from whole-aircraft/total drag, and must avoid unsupported stall, flutter, buckling, certification, manufacturability, or flight-safety claims.

## Deterministic and UI evidence

The checked-in suite covers:

- exact nine-tool inventory and portable 2-read/2-presentation/5-write annotations;
- strict schemas, registration cleanup, editable-Baseline invalidation, Baseline-role replacement, replay/mismatch, conflict recovery, stale worker commits, abort/failure/non-convergence, and exact comparison;
- V4 airfoil-station ordering, hold/blend semantics, imported-coordinate normalization/rejection, local section geometry, mesh-independent mass, and multi-station snapshot trust-boundary reconstruction;
- V5 analytic and imported polar validation/interpolation, alpha/Reynolds/span range states, deterministic nonlinear closure, profile/combined drag identities, and end-to-end user-table target-lift solve;
- two-pass numerical workflow and explicit preservation of the selected Baseline;
- preliminary validity DTO placement and complete omission codes;
- neutral-drag display boundaries without weakening the strict no-worse check;
- all nine success/error output envelopes at maximum bounded state, encoded UTF-8 ceilings, an absolute runtime output guard, and containment of adversarial exception/adapter payloads;
- exact 30-character ID validation, non-empty patch parity, and optional non-mutating explicit-design inspection;
- bounded-ledger exact replay while retained and fail-closed old create/update/run requests after eviction;
- visible no-duplicate replay causality, create/update revision freshness, retained/pruned/current analysis replay truth, and replay isolation from an unrelated active run;
- visible background-target success commits and tool-write editor/mobile exposure, preserving persistent focus and restoring replaced editor-input focus to changed evidence;
- compact current, stale, replacement, and non-converged analysis summaries below the frozen 1,500-byte UTF-8 success ceiling while full shared bounds remain enforced and disclosed elsewhere;
- a rendered nine-state matrix covering fresh/current baseline, fresh/failing/passing/stale candidate, non-converged with retained evidence, aborted with retained evidence, and conflict;
- first-screen copy, exact clipboard prompt, Model Scope dialog, Planform/Airfoils/Structure/Case and Overview/Checks/Compare/Log tabs, five linked engineering views, five accessible check states, focus trap/restore, keyboard tabs, and no-focus-steal behavior.

The automated local suite exercises all nine tool definitions and the full Baseline → first proposal → correction → final root focus → exact comparison flow, including Baseline editing and role replacement. Fresh discovery and repeated reliability in the final supported browser/model environment remain external release gates.

Final release evidence still requires hosted CI and at least 9 successful canonical workflows out of 10 fresh runs in the final supported browser/model environment. A single favorable local trace does not satisfy that external gate.

## Recording format

```text
release commit:
app / solver / tool-schema version:
browser / model:
start time:
eval ID:
tool sequence:
result: PASS | FAIL
invariant failures:
notes:
```

No private account, eligibility, travel, credential, or local-path data belongs in eval evidence.
