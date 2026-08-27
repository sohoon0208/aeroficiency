# Aerociency

Aerociency is a browser-based preliminary wing co-design workspace for a human and an AI agent. Both operate one visible, revisioned engineering model: inspect a protected baseline, branch a candidate, change bounded geometry or wing-box gauges, run the same local solver, and compare immutable results.

> Aerociency supports preliminary design exploration only. It is not a flight-safety, certification, manufacturing, flutter, fatigue, buckling, CFD, or high-fidelity FEA tool.

![Aerociency technical preview](public/og.png)

## Why WebMCP matters

An agent should not have to infer engineering state from sliders, plots, and a 3D viewport. The checked-in adapter defines eight narrow page-scoped Site Tools and registers them through `document.modelContext.registerTool` when that API is available. Tools read explicit revisions, mutate candidates through the same domain commands as the ordinary UI, run the worker-backed solver, and leave visible activity entries. Local runtime discovery passed; production-origin discovery in the final supported browser/model remains a release gate.

The human keeps control of the baseline, sees every mutation and warning, can edit normally without WebMCP, and makes the final engineering judgment.

## Current release status

The local release candidate completed its 2026-08-28 verification gate: a clean Git archive installs, lints, type-checks, verifies licenses, passes all 50 tests, reports zero audited vulnerabilities, and builds. The local in-app browser discovered exactly eight Site Tools and completed the baseline → candidate → analyze → compare workflow through those registered tools. Both the Vinext production server and generated Cloudflare Worker returned the intended security headers on `/`.

Hosted CI, model-driven 9/10 reliability, public-origin/browser checks, and the frozen-release recording remain release gates. Public hosting, repository publication, the final demo video, and Devpost submission are intentionally pending; no URL in this README should be treated as live until it is replaced and verified.

| Artifact | Status |
|---|---|
| Local source implementation | Verified locally on 2026-08-28 |
| Eight-tool WebMCP contract | Exactly eight discovered and invoked locally; model reliability pending |
| Clean-copy gate and CI | Clean-copy gate passed; hosted CI pending |
| Live site | `PENDING_PUBLICATION` |
| Public source repository | `PENDING_PUBLICATION` |
| Demo video | `PENDING_RECORDING` |

## Run locally

Requirements: Node.js 22.13 or newer and npm 10 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. In a browser without WebMCP, the complete manual workflow remains available and the Site Tools badge reports that agent tools are unavailable.

Release-gate commands to run and record before publication:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run licenses:check
npm run build
npm audit --audit-level=high
```

The production build currently reports two understood, non-failing Vinext/Rolldown notices: the deliberately single-page Three.js visualization chunk exceeds the generic 500 kB suggestion, and Vinext cannot statically classify the root route because runtime headers are configured. The local production and generated-worker paths were exercised after the build; these notices do not replace the required live-origin checks.

Run the production build locally with:

```bash
npm run build
npm run start
```

## Product workflow

1. Reset to the deterministic baseline.
2. Run the baseline at standard fidelity.
3. Create a candidate; the baseline remains immutable.
4. Change allowlisted geometry or structure values through the UI or Site Tools.
5. Run a current-revision aeroelastic analysis.
6. Inspect span stations and compare current immutable analyses.
7. Review constraints, warnings, revisions, and activity before making a decision.

The deterministic demo candidate changes the baseline skin gauge from `1.80 mm` to `1.65 mm` and both web gauges from `2.20 mm` to `2.00 mm`. A direct check of solver version `aerociency-0.2.0` converged in 13 coupling iterations for both designs and produced about 8.49% modeled structural-mass reduction while satisfying all five configured candidate checks. This is a local numerical fixture, not browser/CI release evidence, an optimization claim, or a recommendation for a real aircraft.

## The eight Site Tools

| Tool | Mode | Purpose |
|---|---|---|
| `get_design_state` | Read | Read designs, revisions, constraints, freshness, and recent activity |
| `get_analysis_summary` | Read | Read bounded metrics and warnings for one immutable analysis |
| `inspect_span_station` | Read | Resolve and inspect one right-semispan solver station |
| `create_candidate_variant` | Write | Idempotently branch a candidate from an explicit source revision |
| `update_wing_geometry` | Write | Apply a bounded absolute geometry patch to a candidate |
| `update_wing_structure` | Write | Apply bounded gauges or elastic-axis location to a candidate |
| `run_aeroelastic_analysis` | Write | Run one revision-checked analysis; converged results become current |
| `compare_designs` | Read | Compare two distinct current compatible snapshots without rerunning them |

Every write uses an expected revision and UUID idempotency key. The baseline-protection rule, model bounds, stale-write rejection, snapshot validation, and bounded in-memory ledgers are enforced below the UI. See [WebMCP tools](docs/WEBMCP_TOOLS.md) and [evals](docs/EVALS.md).

## Architecture

```text
Human controls ─┐
                ├─> Zustand action layer ─> pure domain commands ─> shared project state
Site Tools ─────┘                                      │
                                                      v
                                     dedicated analysis Web Worker
                                                      │
                      VLM + wing box + beam FEM + torsional coupling
                                                      │
                                                      v
                     immutable snapshot ─> validated commit ─> 3D, plots, results, activity
```

The browser contains the entire challenge workflow. There is no application database, computational backend, OpenAI API call, account, or secret. State is intentionally deterministic and in-memory for the challenge slice; refresh/reset starts a clean workspace.

Main implementation boundaries:

- `lib/domain/`: state types, validation, fingerprints, and pure commands
- `lib/solver/`: NACA geometry, aerodynamic lattice, wing box, beam FEM, and coupling
- `workers/` and `services/`: cancellable worker execution and stale-commit checks
- `store/`: the shared UI/tool action layer
- `webmcp/`: feature detection, registration lifecycle, schemas, and tool handlers
- `components/`: responsive controls, 3D model, plots, results, and activity UI
- `tests/`: deterministic solver, domain, snapshot, and WebMCP checks

The hosting scaffold uses ChatGPT Sites with Vinext/Vite and a Cloudflare Worker runtime. It should not be described as a plain Cloudflare Pages build.

## Engineering model at a glance

- SI units throughout; `x` aft, `y` starboard, `z` up.
- Symmetric, zero-sweep, zero-dihedral trapezoidal planform.
- One NACA four-digit section across the span; closed trailing edge.
- Full-wing cosine-spaced one-row horseshoe lattice with quarter-chord bound vortices.
- Target-lift trim on every aeroelastic iteration and wake-only induced-drag estimate.
- Closed thin-walled box from `0.20c` to `0.65c`, Aluminum 2024-T3.
- Right-semispan Euler–Bernoulli bending and torsion-rod elements; full-wing mass.
- Two-way torsional coupling with under-relaxation; bending is postprocessed only.
- Yield margin includes modeled bending and torsion at coincident wall locations.

Permanent omissions include profile drag, stall, pitching moment, bending feedback, divergence, flutter, buckling, fatigue, crippling, local stress concentrations, composites, control surfaces, and certification factors. Full conventions and equations are in [model assumptions](docs/MODEL_ASSUMPTIONS.md); supporting checks are in [validation](docs/VALIDATION.md).

## Safety and failure behavior

- Invalid or non-finite inputs are rejected before state mutation.
- The baseline cannot be edited.
- Human and agent writes share validators and revision checks.
- Reused idempotency keys replay only an identical request.
- Results become stale when their design or dependency revisions change.
- A worker result is discarded if any expected revision or fingerprint changed.
- Failed, aborted, conflicted, or non-converged runs do not replace the last current converged result. A validated non-converged snapshot may be retained for diagnostics and is returned as `ANALYSIS_DID_NOT_CONVERGE` with unavailable constraints.
- Non-converged results cannot pass constraints.
- Tool labels and outputs are bounded; no tool is open-world or destructive.

See [security policy](SECURITY.md). Production response headers must still be verified on the eventual live origin; checked-in configuration alone is not deployment evidence.

## Challenge and provenance

Aerociency is a clean-start solo project created during the 2026 OpenAI WebMCP Challenge. The sanitized provenance record is in [PROVENANCE.md](docs/PROVENANCE.md). Private eligibility or travel records are deliberately excluded from this repository.

Prepared but unpublished release materials:

- [submission copy](docs/SUBMISSION_COPY.md)
- [demo script](docs/DEMO_SCRIPT.md)
- [release checklist](docs/RELEASE_CHECKLIST.md)
- [third-party notices](THIRD_PARTY_NOTICES.md)

## License

Aerociency is released under the [MIT License](LICENSE). Third-party packages and their own terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
