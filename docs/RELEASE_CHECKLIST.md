# Release and submission checklist

This checklist separates local engineering completion from user-authorized publication. Do not deploy, push a public repository, upload a video, or submit to Devpost merely because the local boxes are complete.

## 1. Local release candidate

- [x] Final scope matches `README.md` and no cut feature is implied.
- [x] The UI, snapshots, validation record, eval fixture, and demo all identify solver `aerociency-0.2.0`.
- [x] Fresh reset produces the exact deterministic baseline and no fabricated result.
- [x] Manual baseline → candidate → edit → analyze → compare workflow passes.
- [x] Exactly eight Site Tools register once and remain absent when WebMCP is unavailable.
- [x] Human and agent mutations use the same commands and actor labels are truthful.
- [x] Baseline protection, idempotency, revision conflict, stale result, abort, failure, and non-convergence paths pass.
- [x] Solver snapshots contain only finite JSON values or documented nulls.
- [x] Every visible metric, plot, constraint, warning, and activity value traces to committed state.
- [x] Geometry, Aero loads, and Structure modes are readable and accurate.
- [x] 1440×900, tablet, 390×844, keyboard, focus, reduced motion, and 200% effective-layout checks pass.
- [x] `npm ci` succeeds from a clean local copy.
- [x] `npm run lint` passes.
- [x] `npm run typecheck` passes.
- [x] `npm run test:run` passes.
- [x] `npm run licenses:check` passes.
- [x] `npm run build` passes with its two understood, documented non-failing notices.
- [x] `npm audit --audit-level=high` passes or every exception has a written reachability decision.
- [x] No secret, token, credential, local absolute path, or private attachment is tracked.
- [x] Root MIT license, notices, security policy, provenance, assumptions, validation, tool docs, evals, submission copy, and demo script are present.
- [x] Original favicon and social preview are used; third-party rights are documented.
- [x] Local Git repository is rooted at `aerociency/`, with normal dated history.

## 2. Eligibility and owner attestations

- [ ] Entrant is of legal age of majority in the legal country of residence.
- [ ] Legal residence and OpenAI-supported-country requirements are accurate on the official form.
- [x] Solo-entry status is accurate.
- [ ] No disqualifying sponsor, administrator, judge, employment, household, or immediate-family relationship applies.
- [ ] No prohibited financial or preferential support was received.
- [ ] Entrant owns or is licensed to publish every source file, asset, dependency, and media item.
- [ ] Entrant approves the public attribution name/handle used in the license, repository, app, video, and Devpost profile.
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
- [ ] Supported ChatGPT in-app browser discovers all and only eight tools.
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
- [ ] Freeze the submitted branch/deployment through the required judging period; continue later work separately.

## Stop conditions

Stop and ask the user before any public state change, before choosing an unapproved public identity or account, or if a new eligibility/ownership fact could materially change entry validity. Never work around a failed safety or solver gate with fabricated copy, hidden values, or an unverified URL.
