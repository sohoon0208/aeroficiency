# Release and submission checklist

This checklist separates local engineering completion from user-authorized publication. Do not deploy, push a public repository, upload a video, or submit to Devpost merely because the local boxes are complete.

## 1. Local release candidate

- [x] Final scope matches `README.md` and no cut feature is implied.
- [x] The UI, snapshots, validation record, eval fixture, and demo all identify solver `aeroficiency-0.6.0`.
- [x] Fresh reset produces the exact deterministic baseline and no fabricated result.
- [x] Manual baseline → candidate → edit → analyze → compare workflow passes.
- [x] Exactly ten Site Tools register once and remain absent when WebMCP is unavailable.
- [x] Tool classification is exactly two pure reads, two presentation actions, and six engineering writes, using only portable annotation keys.
- [x] Station inspection and comparison change only transient presentation state; they do not change revisions, designs, analyses, idempotency, activity, or worker count.
- [x] Station inspection focuses one exact current solver station; comparison pins the exact ordered baseline/candidate analysis IDs.
- [x] Human and agent mutations use the same commands and actor labels are truthful.
- [x] Editable-Baseline invalidation, Baseline-role replacement, idempotency, revision conflict, stale result, abort, failure, and non-convergence paths pass.
- [x] Candidate creation and analysis require the exact expected project revision in addition to entity/dependency revisions.
- [x] Identical write replays produce no duplicate revision/activity/snapshot and are visibly announced even outside the active design; after bounded-ledger eviction, old create/update/run requests fail closed on stale project/design revisions.
- [x] Candidate/update `replayState` distinguishes returned and current revisions; analysis `snapshotRetention` reports retained, inspectable, current, and any current replacement ID.
- [x] Successful background analysis commits visibly identify the target design and analysis without changing the human’s current selection.
- [x] Geometry/structure tool writes auto-open the affected editor and mobile Design view and add changed-field/Agent markers; persistent focus stays put, while a replaced editor input transfers focus to the changed control.
- [x] Solver snapshots contain only finite JSON values or documented nulls.
- [x] Every visible metric, plot, constraint, warning, and activity value traces to committed state.
- [x] Public terms distinguish modeled wing-box wall mass, wake-induced drag, SectionPolar profile drag, combined wing drag, estimated wing L/D, and modeled yield ratio.
- [x] V4 supports two–six user-positioned NACA/imported airfoil stations with validated blend/hold semantics; local geometry drives the loft, wing box, zero-lift angle, and section moment.
- [x] V5 supports generated or imported station/Reynolds polars, explicit provenance/range states, nonlinear lifting-line closure, profile/combined wing drag, and polar-linked torsion.
- [x] The configurable AoA range is revisioned and bounded; every sampled point reruns the fixed-angle VLM/polar/structure/torsion coupling and remains distinct from official target-lift checks.
- [x] The AoA scrubber links signed 3D/load/structure evidence, seven Efficiency plots, and 2D local incidence without hidden reruns or analysis mutation.
- [x] NACA thin/thick/cambered, Clark Y, S1223, SG6043, and SC(2)-0412 profiles pass the cross-airfoil finite/monotonic/positive-drag and panel-residual matrix; representative full coupled sweeps converge.
- [x] Full supported bounds derive from shared constants and remain enforced/shared in UI, schemas, validation, and documentation; the summary uses headline bounds, trim, and compact assumption/omission categories.
- [x] All ten success/error result envelopes stay below frozen UTF-8 byte budgets at maximum bounded state; every `get_analysis_summary` freshness variant remains under 1,500 bytes, and the absolute 6,000-byte runtime guard contains oversized injected results.
- [x] Public worker/browser/adapter failures use fixed bounded categories and never expose raw thrown text, stack data, or untrusted returned fields.
- [x] Advertised and runtime schemas agree on exact 30-character entity IDs, bounded labels, and non-empty allowlisted patches.
- [x] The neutral drag display policy does not weaken the strict no-worse configured check.
- [x] The first screen contains the challenge objective, audience, editable-Baseline state, candidate readiness, tool readiness, exact task copy, Model Scope, and release identity.
- [x] Geometry, Aero loads, 2D Section, Efficiency, and Structure modes are readable, keyboard reachable, and accurate to their documented model boundaries.
- [x] Section Flow uses the linked current station, passes analytic/grid/order tests, shows Kutta/flux/inviscid-drag residuals, and permanently discloses its inviscid attached-flow limits.
- [x] Efficiency shows immutable local Reynolds/Cl/Cd/range-state evidence plus induced/profile/combined drag without implying whole-aircraft fidelity.
- [x] The rendered nine-state presentation matrix cannot show a green verdict or canonical success copy for stale, failed, aborted, conflicted, or non-converged attempts before explicit retained-result acknowledgement.
- [ ] Re-run the local registered-tool browser workflow for the ten-tool contract, canonical two-proposal sequence, sweep configuration, exact replay, Baseline-role replacement, and stale-focus preservation with zero console errors.
- [x] 1280×720, 1440×900, tablet, 390×844, keyboard, focus, reduced motion, and 200% effective-layout checks pass without document-level horizontal overflow.
- [x] `npm ci` succeeds from the final clean local copy.
- [x] `npm run lint` passes on the final tree.
- [x] `npm run typecheck` passes on the final tree.
- [x] `npm run test:run` passes on the final tree (30 files / 181 tests).
- [x] `npm run licenses:check` passes on the final tree (119 entries / 58 distinct texts).
- [x] `npm run build` passes with only understood, documented non-failing notices.
- [x] `npm audit --audit-level=high` passes with 0 vulnerabilities.
- [x] No secret, token, credential, local absolute path, or private attachment is tracked.
- [x] Root MIT license, notices, security policy, provenance, assumptions, validation, tool docs, evals, submission copy, and demo script are present.
- [x] Original favicon and social preview are used; third-party rights are documented.
- [x] Local Git repository is rooted at `aeroficiency/`, with normal dated history.

## 2. Eligibility and owner attestations

- [ ] Entrant is of legal age of majority in the legal country of residence.
- [ ] Legal residence and OpenAI-supported-country requirements are accurate on the official form.
- [x] Solo-entry status is accurate.
- [ ] No disqualifying sponsor, administrator, judge, employment, household, or immediate-family relationship applies.
- [ ] No prohibited financial or preferential support was received.
- [ ] Entrant owns or is licensed to publish every source file, asset, dependency, and media item.
- [ ] Entrant approves the public attribution name/handle and Git author email used in the license, repository, app, video, and Devpost profile, or the local history is rewritten with an approved privacy-preserving identity before publication.
- [ ] If any rule interpretation remains uncertain, organizer clarification is retained privately.

## 3. User-authorized repository publication

- [ ] User explicitly authorizes publication.
- [ ] Intended repository/account/name are confirmed; no trademark/domain claim is implied.
- [ ] Parent workspace and private plan are outside the Git root.
- [ ] Default branch contains only the audited release candidate.
- [ ] Public host recognizes the MIT license.
- [ ] CI runs successfully on the public commit.
- [ ] Logged-out clone → `npm ci` → test → build succeeds.
- [ ] Release commit SHA and tag are recorded.

## 4. User-authorized hosting

- [ ] User explicitly authorizes deployment.
- [ ] ChatGPT Sites project and public hostname are confirmed.
- [ ] `NEXT_PUBLIC_SITE_URL` is the canonical public HTTPS origin.
- [ ] No localhost URL appears in public Open Graph/canonical metadata.
- [ ] Fresh logged-out load works without credentials or payment.
- [ ] Normal UI works without WebMCP.
- [ ] Supported ChatGPT in-app browser discovers all and only ten tools.
- [ ] Current Chrome WebMCP path discovers and invokes the same tools.
- [ ] Live `/` response has CSP, `Origin-Agent-Cluster: ?1`, intended `Permissions-Policy`, `nosniff`, and referrer policy.
- [ ] CSP permits the worker and all required first-party assets without browser violations.
- [ ] No console error, hydration dialog, broken worker, or failed asset exists.
- [ ] Deployment ID, timestamp, release commit, and live URL are recorded.

## 5. Eval and demo gate

- [ ] All ten eval cases preserve safety invariants.
- [ ] Canonical end-to-end demo succeeds at least 9/10 fresh runs.
- [ ] Baseline remains unchanged after every run.
- [x] Feasible candidate numbers match the frozen solver within documented tolerance.
- [ ] Demo is recorded from the submitted release and live origin.
- [ ] Final video is 2:35–2:50 and strictly under 3:00.
- [ ] Audio is intelligible; English captions are correct.
- [ ] Operational text remains readable after YouTube compression.
- [ ] No private account, path, notification, brand, music, or unrelated application appears.
- [ ] Public YouTube playback works while logged out.

## 6. Devpost submission

- [ ] User explicitly authorizes submission.
- [ ] Entrant profile and eligibility answers are accurate.
- [ ] Live site, public repository, and public video URLs are final and logged-out tested.
- [ ] Four required WebMCP explanation sections are complete in English.
- [ ] Screenshots show real current results and no private data.
- [ ] Submission contains no `PENDING_*` placeholder.
- [ ] Submit before the internal target with time for a logged-out audit.
- [ ] Save confirmation, final URLs, release commit, deployment ID, video duration, and screenshots privately.
- [ ] Freeze the submitted branch/deployment until winners are announced; continue later work on a separate branch.

## Stop conditions

Stop and ask the user before any public state change, before choosing an unapproved public identity or account, or if a new eligibility/ownership fact could materially change entry validity. Never work around a failed safety or solver gate with fabricated copy, hidden values, or an unverified URL.
