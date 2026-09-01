# Implementation audit — 2026-08-28

> Historical V1–V3 audit. It records the state verified on 2026-08-28, including the former protected-Baseline/eight-tool contract, and is intentionally not rewritten as if later behavior existed then. The current implementation uses an editable Baseline and ten tools. For current implementation and test evidence, use [Validation](VALIDATION.md), [WebMCP tools](WEBMCP_TOOLS.md), and the project [README](../README.md).

## Decision

Aeroficiency remains strongly aligned with the WebMCP Challenge: a structured browser-tool interface is materially safer and more useful than pixel-driving for a revisioned engineering workspace. This correction keeps the protected-baseline, human-in-control, deterministic-solver concept while making the challenge story, visible tool effects, model limitations, and result semantics explicit.

Current status:

- `LOCAL_RC_READY`
- `EXTERNAL_RELEASE_PENDING`

Nothing was published, deployed, recorded, uploaded, or submitted during this work.

## Corrections implemented

- Replaced ambiguous tool classification with two pure reads, two presentation actions, and four engineering writes using only portable annotation keys.
- Added transient presentation state outside engineering project state.
- Made station inspection current-only and visibly focus the exact resolved station.
- Made comparison pin the exact requested current baseline/candidate pair and reject stale/incompatible evidence.
- Proved presentation actions do not change project revision, designs, analyses, activity, idempotency, or worker launches and do not steal keyboard focus.
- Added a challenge-first 1280×720 header with audience, case, objective, protected-baseline state, tool readiness, exact task copy, Model Scope, reset, and analysis control.
- Separated immutable analysis freshness from latest run outcome.
- Added truthful awaiting/current/stale/not-converged states; baseline three-intrinsic/two-N/A semantics; and a five-check candidate verdict.
- Added the deliberate first-failure/correction flow and exact final-analysis comparison.
- Standardized public language: modeled wing-box wall mass, wake-induced-drag estimate, modeled yield ratio, and low-order target-lift, torsion-coupled static analysis.
- Added structured preliminary validity constants, supported bounds, assumption/omission codes, and tiered tool DTOs.
- Added neutral wake-drag reporting at ±0.05% as display language only; the configured no-worse check remains strict.
- Added app/solver/tool-schema/build-commit release identity.
- Expanded deterministic contract, two-pass, boundary, output-size, conflict-recovery, component, keyboard, and focus tests.
- Hardened the public Site Tool boundary with exact-length IDs, schema/runtime patch parity, fixed non-sensitive error categories, UTF-8 per-tool budgets, and an absolute output guard.
- Made all idempotent write replays visibly causal without duplicate engineering state, including truthful retained/pruned analysis-snapshot recovery.
- Added project-revision preconditions to candidate creation and analysis so evicted old idempotency requests fail closed instead of duplicating work.
- Added explicit create/update replay freshness and retained/inspectable/current/current-replacement analysis replay metadata.
- Made successful background analysis commits identify their target design and analysis without changing the human’s selection.
- Made geometry/structure tool writes expose the affected editor and mobile Design view with changed-field provenance, persistent-focus preservation, and deliberate recovery of replaced editor-input focus.
- Kept full shared model bounds enforced/disclosed while holding the summary freshness matrix to 1,328–1,408 bytes (1,321 bytes for the live canonical current candidate), under its frozen 1,500-byte UTF-8 ceiling.
- Added a rendered nine-state UI matrix that blocks false green verdicts and canonical success copy across stale, non-converged, aborted, failed, and conflicted attempts.
- Corrected responsive layout behavior at desktop, mobile, and short heights.
- Added V3 linked 2D Section Flow Lab using a validated Hess–Smith source/vortex panel method, Kutta condition, `Cp`, section coefficients, residuals, streamlines, vectors, stagnation point, panel refinement, and permanent scientific-limit disclosure.

## Final local evidence

- Fresh isolated-copy `npm ci`: pass (629 packages installed; 630 audited)
- Source-tree and clean-copy lint/type-check: pass
- Source-tree and clean-copy Vitest: 25 files / 135 tests pass
- Production license inventory: 119 entries / 58 distinct texts verified
- Dependency audit: 0 vulnerabilities at `high` threshold
- Production build: pass with the two documented non-failing Vinext/Rolldown notices
- Production runtime: intended headers and generated assets return successfully; exactly eight tools discovered; generated worker baseline converges in 13 iterations; zero console errors
- Privacy/repository-boundary scan: no secret, private attachment, or local absolute path found
- Local in-app browser: exactly eight tools discovered
- Canonical workflow: baseline → first 4/5 proposal → corrected 5/5 proposal → final root focus → exact comparison
- Idempotent final-run replay: visibly causal, no duplicate; freshness/retention metadata correct
- Stale station and comparison requests: rejected without replacing exact final focus
- Tool-write editor/mobile exposure, Model Scope, Escape/focus restore, keyboard tabs, reduced motion, and no-focus-steal checks: pass
- Responsive checks: 1280×720, 1440×900, 390×844, and 1280×600; no document-level horizontal overflow
- Section diagnostics: the linked V3 160-panel case exercised from a current immutable baseline result; the unreliable 3D flow experiment was removed from the release surface.
- Browser console errors: zero

The only additional local tooling notice is the upstream deprecation of pinned ESLint 9. ESLint 10.9.1 was tested and rejected because the current Next.js React lint plugin fails under that engine; the passing known-good lint stack remains pinned. This is a development-tool maintenance item, not a browser-runtime defect.

## Release identity

| Field | Value |
|---|---|
| App | `0.2.0` |
| Solver | `aeroficiency-0.2.0` |
| Tool schema | `aeroficiency-webmcp-1.1` |
| Build commit | `NEXT_PUBLIC_AEROFICIENCY_COMMIT`, fallback `local` |
| Working branch | `release/webmcp-final-polish` |

## External work intentionally pending

Owner eligibility/rights/attribution attestations, public repository, hosted CI, final supported-browser/model 9/10 reliability, public deployment, live-origin WebMCP/security headers, recording, YouTube upload, and Devpost submission require later user authorization or external evidence.
