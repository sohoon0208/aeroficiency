# Aeroficiency

Aeroficiency is a browser-based preliminary wing co-design workspace for a human and an AI agent. Both work on one visible, revisioned engineering model: edit the current Baseline, branch one or more candidates, choose which design is the Baseline reference, change bounded planform, spanwise airfoils, section polars, and wing-box gauges, run the same local solver, and compare immutable results.

> Aeroficiency is for aerospace education and early concept trade studies. It is not a flight-safety, certification, manufacturing, CFD, high-fidelity FEA, flutter, fatigue, or buckling tool.

![Aeroficiency technical preview](public/og.png)

## Challenge fit

The project is designed around WebMCP rather than merely adding tools to an unrelated site. An agent can read exact engineering state, create a candidate, change the Baseline reference, make bounded changes, run the solver, focus visible evidence, and compare exact immutable analyses. These actions are exposed as nine narrow page-scoped Site Tools through `document.modelContext.registerTool` when WebMCP is available.

The normal UI and Site Tools call the same domain commands. Exactly one design holds the editable Baseline role, comparison remains unavailable until at least one candidate exists, writes require explicit revisions and idempotency keys, stale writes fail closed, and accepted agent actions appear immediately in the controls, plots, results, and activity log. The application remains fully usable by a human when WebMCP is unavailable.

## Release status

Release identity: app `0.5.0`, solver `aeroficiency-0.5.0`, tool schema `aeroficiency-webmcp-1.4`.

The V4/V5 implementation is complete locally:

- V4: two to six user-positioned airfoil stations, supported NACA four-digit or imported coordinate definitions, local camber/thickness interpolation, local zero-lift angle and quarter-chord moment, spanwise 3D loft, and local wing-box geometry.
- V5: generated attached-flow section polars or bounded user-imported station/Reynolds tables, nonlinear section-polar lifting-line closure, local Reynolds number, profile drag, combined wing drag, estimated wing L/D, range diagnostics, and polar-linked torsional loading.
- UI: separate Planform/Airfoils/Structure/Case editors; five linked engineering views; and Overview/Checks/Compare/Log result sections.

The implementation is release-ready locally. Public repository publication, a judge-accessible deployment, recording, and final submission remain explicit owner actions. No URL should be treated as final until its logged-out live-origin checks pass.

| Artifact | Status |
|---|---|
| Local V1–V5 implementation | Complete and under local release verification |
| Nine-tool WebMCP contract | Implemented and locally exercised |
| Public site/repository | Pending explicit publication approval |
| Demo recording | Pending |
| Challenge submission | Pending |

## Run locally

Requirements: Node.js 22.13 or newer and npm 10 or newer.

```bash
npm ci
npm run dev
```

Open `http://localhost:3000`. A browser without WebMCP shows a manual-mode badge; all engineering controls still work.

Local release checks:

```bash
npm run lint
npm run typecheck
npm run test:run
npm run licenses:check
npm run build
npm audit --audit-level=high
```

Or run the complete gate in one command:

```bash
npm run release:check
```

## Deployment

The production build targets a Cloudflare Worker through Vinext/Vite. A free Cloudflare Workers account is sufficient for this client-side challenge application; no database, object storage, paid service, application secret, or OpenAI API key is required.

```bash
# Local production-runtime preview
npm run preview:cloudflare

# Public deployment — run only after choosing the public account and hostname
npm run deploy:cloudflare
```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin before the public release so canonical and social metadata never point to localhost. See [deployment](docs/DEPLOYMENT.md) for the exact release procedure and [Devpost field guide](docs/DEVPOST_FIELD_GUIDE.md) for the application handoff.

## Product workflow

1. Reset to the deterministic reference case.
2. Adjust and run the editable Baseline at standard fidelity.
3. Create at least one candidate to unlock comparison.
4. Edit planform, user-positioned airfoil stations, polar source, or wing-box values.
5. Run a revision-checked coupled analysis.
6. Inspect local section, Reynolds, drag, flow, load, and structural evidence.
7. Compare exact current baseline and candidate analyses.
8. Review all five configured checks, warnings, revisions, and activity before deciding.

The canonical challenge scenario deliberately uses two structural proposals. The first, `1.75 / 2.10 / 2.10 mm`, does not meet the 5% modeled wall-mass objective. The corrected `1.65 / 2.00 / 2.00 mm` candidate gives about 8.49% modeled wall-mass reduction and passes all five checks in the frozen V5 fixture. The wake-induced-drag change is numerically tiny and is described as no meaningful improvement. Profile and combined wing drag are reported as additional V5 evidence, not as whole-aircraft drag or as configured optimization checks.

## The nine Site Tools

| Tool | Mode | Purpose |
|---|---|---|
| `get_design_state` | Read | Read bounded project/design state, revisions, airfoil stations, and polar metadata |
| `get_analysis_summary` | Read | Read a compact immutable V5 analysis summary and model-validity contract |
| `inspect_span_station` | Presentation | Focus one current right-semispan solver station |
| `create_candidate_variant` | Write | Idempotently branch a candidate from an explicit source revision |
| `set_baseline_design` | Write | Select the Baseline reference; re-selecting it is unchanged, while a role change retains the former Baseline as a candidate |
| `update_wing_geometry` | Write | Apply bounded planform, airfoil-station, or polar-model changes |
| `update_wing_structure` | Write | Apply bounded gauges or elastic-axis position |
| `run_aeroelastic_analysis` | Write | Run one revision-checked analysis and commit a validated snapshot |
| `compare_designs` | Presentation | Pin an exact current baseline/candidate analysis pair without rerunning |

The inventory is exactly two reads, two presentation actions, and five engineering writes. Presentation actions never alter engineering revisions or analyses. See [WebMCP tools](docs/WEBMCP_TOOLS.md) and [evals](docs/EVALS.md).

## Architecture

```text
Human controls ─┐
                ├─> shared action layer ─> pure domain commands ─> revisioned state
Site Tools ─────┘                                      │
                                                      v
                                           analysis Web Worker
                                                      │
                 nonlinear section-polar lifting line + target-lift trim
                             ↕ torsional fixed-point coupling
                   local airfoil/wing box + beam/torsion structure
                                                      │
                                                      v
                    validated immutable V5 snapshot and diagnostics
                              │                       │
                              v                       v
                    3D geometry/load/structure   linked 2D panel lab
```

There is no application database, computational backend, account, OpenAI API call, or secret. State is deterministic and in memory for this challenge slice. Reset or refresh starts a clean workspace.

Main boundaries:

- `lib/domain/`: types, limits, validation, fingerprints, and pure commands
- `lib/solver/`: local airfoil resolution, section polars, aerodynamic lattice, wing box, beam/torsion, panel diagnostics, and coupling
- `lib/visualization/`: section-condition projection for the linked 2D lab
- `workers/` and `services/`: cancellable analysis worker and stale-commit protection
- `store/`: shared UI/tool actions and transient presentation state
- `webmcp/`: discovery, strict schemas, bounded outputs, and handlers
- `components/`: responsive design editors, 3D/2D diagnostics, plots, and results
- `tests/`: deterministic solver, domain, UI, and WebMCP regression coverage

The hosting scaffold uses ChatGPT Sites with Vinext/Vite and a Cloudflare Worker runtime. Hosting is not performed until explicitly authorized.

## Engineering model at a glance

- SI units; `+x` aft, `+y` starboard, `+z` up.
- Symmetric, zero-sweep, zero-dihedral trapezoidal planform.
- Two to six ordered airfoil stations at user-set normalized semispan locations.
- NACA four-digit sections or bounded imported contours, normalized and cosine-resampled.
- Local camber/thickness blending drives the wing loft, wing-box walls, zero-lift angle, and quarter-chord moment.
- Full-wing cosine-spaced, one-row horseshoe lattice with nonlinear SectionPolar closure and target-lift trim.
- Local Reynolds interpolation from generated or user-supplied polars; spanwise profile-drag integration.
- Wake-induced drag plus profile drag gives a preliminary combined wing-drag estimate and wing L/D.
- 3D geometry, aero-load, and structure views that read the committed analysis snapshot.
- Independent linked Hess–Smith 2D section diagnostic with `Cp`, force/moment, and residual checks.
- Closed thin-walled Aluminum 2024-T3 wing box; right-semispan bending/torsion and full-wing wall mass.
- Two-way torsional coupling; bending deformation is postprocessed and does not feed back to aerodynamics.
- Modeled yield ratio is `σy / max(σVM)` at coincident wall locations.

The built-in polar is a transparent attached-flow estimate, not XFOIL or experimental correlation. User tables retain provenance and explicit alpha/Reynolds range states. The model still omits first-principles boundary layers, transition, turbulence, separation and stall; compressibility/transonic effects; free-wake roll-up; fuselage/tail/nacelle/interference and other whole-aircraft drag; structural weight and inertial load cases; bending feedback; dynamic aeroelasticity; buckling/fatigue/local failure; manufacturing detail; and certification analysis. See [model assumptions](docs/MODEL_ASSUMPTIONS.md), [section visualization](docs/FLOW_VISUALIZATION.md), and [validation](docs/VALIDATION.md).

## Safety and failure behaviour

- Invalid, non-finite, incomplete, or out-of-order data is rejected before mutation.
- Imported contours are checked for closure/orientation, usable thickness, and self-intersection.
- User polar rows require bounded provenance, strictly increasing alpha, positive drag, station coverage, and consistent Mach metadata.
- Exactly one design is the editable Baseline reference; changing it or changing its role makes dependent comparisons stale.
- Every write uses optimistic revision checks; stale worker results are discarded.
- Idempotent replays cannot duplicate accepted work while retained; evicted old requests fail on stale revisions.
- Failed, aborted, conflicted, or non-converged runs never replace the last current converged result.
- Non-converged constraints are all unavailable and cannot be presented as passes.
- Site Tool payloads use strict closed schemas, reason-specific public errors, bounded histories, and frozen output ceilings. Valid matching writes return `outcome: "unchanged"` without an error or engineering revision.
- Model limitations stay visible in the header scope dialog and result log.

## Challenge provenance and license

Aeroficiency is a clean-start solo project created during the 2026 OpenAI WebMCP Challenge. The sanitized record is in [provenance](docs/PROVENANCE.md). Private eligibility, travel, credentials, correspondence, and planning attachments are outside the repository boundary.

Prepared release materials:

- [submission copy](docs/SUBMISSION_COPY.md)
- [Devpost field guide](docs/DEVPOST_FIELD_GUIDE.md)
- [demo script](docs/DEMO_SCRIPT.md)
- [deployment guide](docs/DEPLOYMENT.md)
- [release checklist](docs/RELEASE_CHECKLIST.md)
- [third-party notices](THIRD_PARTY_NOTICES.md)

Aeroficiency is released under the [MIT License](LICENSE). Third-party packages and their terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
