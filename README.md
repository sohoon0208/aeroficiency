# Aeroficiency

Aeroficiency is a browser-based preliminary wing co-design workspace for a human and an AI agent. Both work on one visible, revisioned engineering model: edit the current Baseline, branch one or more candidates, choose which design is the Baseline reference, change bounded planform, spanwise airfoils, section polars, and wing-box gauges, run the same local solver, and compare immutable results.

> Aeroficiency is for aerospace education and early concept trade studies. It is not a flight-safety, certification, manufacturing, CFD, high-fidelity FEA, flutter, fatigue, or buckling tool.

![Aeroficiency technical preview](public/og.png)

## Challenge fit

The project is designed around WebMCP rather than merely adding tools to an unrelated site. An agent can read exact engineering state, create a candidate, change the Baseline reference, make bounded changes, configure the shared angle-of-attack sweep, run the solver, focus visible evidence, and compare exact immutable analyses. These actions are exposed as ten narrow page-scoped Site Tools through `document.modelContext.registerTool` when WebMCP is available.

The normal UI and Site Tools call the same domain commands. Exactly one design holds the editable Baseline role, comparison remains unavailable until at least one candidate exists, writes require explicit revisions and idempotency keys, stale writes fail closed, and accepted agent actions appear immediately in the controls, plots, results, and activity log. The application remains fully usable by a human when WebMCP is unavailable.

## Release status

Release identity: app `0.6.0`, solver `aeroficiency-0.6.0`, tool schema `aeroficiency-webmcp-1.5`.

The V4/V5 implementation is complete locally:

- V4: two to six user-positioned airfoil stations; supported NACA four-digit sections; imported coordinate definitions; local camber/thickness interpolation; local zero-lift angle and quarter-chord moment; spanwise 3D loft; and local wing-box geometry.
- V5: generated attached-flow section polars or bounded user-imported station/Reynolds tables, nonlinear section-polar lifting-line closure, local Reynolds number, profile drag, combined wing drag, estimated wing L/D, range diagnostics, and polar-linked torsional loading.
- AoA exploration: a user-configurable −8° to +12° fixed-angle range in 0.5° or 1° increments; a full VLM/section-polar/torsion solve at every sampled angle; linked 3D, load, structure, efficiency, and 2D Section views; and immutable trim-versus-sweep separation.
- UI: separate Planform/Airfoils/Structure/Case editors; five linked engineering views; a fine AoA presentation scrubber; and a discoverable Summary toggle beside Structure for the Overview/Checks/Compare/Log result sections. On tablet layouts, opening Summary smoothly gives the result panel its own column and shrinks the engineering workspace instead of covering it.

The implementation is release-ready locally. Public repository publication, a judge-accessible deployment, recording, and final submission remain explicit owner actions. No URL should be treated as final until its logged-out live-origin checks pass.

| Artifact | Status |
|---|---|
| Local V1–V5 implementation | Complete and under local release verification |
| Ten-tool WebMCP contract | Implemented and locally exercised |
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

The checked-in ChatGPT Sites configuration and Vinext/Vite build produce the same worker-rendered application used by local production previews. ChatGPT Sites is the intended managed publishing path; direct Cloudflare Workers deployment remains available as an optional alternative. Neither path requires an application database, object storage, application secret, or OpenAI API key.

```bash
# Local production-runtime preview
npm run preview:cloudflare

# Optional direct Cloudflare deployment — run only after choosing the public account and hostname
npm run deploy:cloudflare
```

Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin before the public release so canonical and social metadata never point to localhost. The checked-in hosting configuration and the commands above are the complete deployment path; submission details belong in the challenge form.

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

## The ten Site Tools

| Tool | Mode | Purpose |
|---|---|---|
| `get_design_state` | Read | Read bounded project/design state, revisions, airfoil stations, and polar metadata |
| `get_analysis_summary` | Read | Read a compact immutable V5 analysis summary and model-validity contract |
| `inspect_span_station` | Presentation | Focus one current right-semispan solver station |
| `create_candidate_variant` | Write | Idempotently branch a candidate from an explicit source revision |
| `set_baseline_design` | Write | Select the Baseline reference; re-selecting it is unchanged, while a role change retains the former Baseline as a candidate |
| `update_wing_geometry` | Write | Apply bounded planform, airfoil-station, or polar-model changes |
| `update_wing_structure` | Write | Apply bounded gauges or elastic-axis position |
| `configure_angle_sweep` | Write | Configure the shared fixed-AoA range and resolution with revision and idempotency protection |
| `run_aeroelastic_analysis` | Write | Run one revision-checked analysis and commit a validated snapshot |
| `compare_designs` | Presentation | Pin an exact current baseline/candidate analysis pair without rerunning |

The inventory is exactly two reads, two presentation actions, and six engineering writes. Presentation actions never alter engineering revisions or analyses. The exact schemas and handlers live in `webmcp/tools.ts`, with regression coverage in `tests/`.

## Architecture

```text
Human controls ─┐
                ├─> shared action layer ─> pure domain commands ─> revisioned state
Site Tools ─────┘                                      │
                                                      v
                                           analysis Web Worker
                                                      │
            nonlinear section-polar lifting line + target-lift trim and AoA sweep
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

## Engineering model and assumptions

Aeroficiency is a deterministic, low-order, Reynolds/polar-aware, torsion-coupled static model for preliminary wing trade studies. The machine-readable validity contract is defined in `lib/domain/modelValidity.ts`, with shared supported bounds in `lib/domain/limits.ts` and `lib/domain/validation.ts`.

### Scope and conventions

- The model is preliminary and uses SI units. Its body axes are `+x` aft, `+y` starboard, and `+z` upward; the wake model extends in fixed positive body-axis `x`.
- Geometry is a symmetric, unswept, zero-dihedral trapezoidal planform with linear chord and geometric twist. Root twist is fixed at zero.
- Span, area, lift, drag, and modeled wall mass are full-wing quantities. Shear, bending moment, torque, deflection, twist, and station plots are right-semispan quantities. Positive induced angle denotes downwash and is subtracted from local incidence.
- Aerodynamic fidelity is the bounded `fast` or `standard` configuration exposed by the application; it is not a high-fidelity CFD setting.

### Geometry and spanwise sections

- A design contains two to six ordered stations covering the root and tip. Each station accepts a supported NACA four-digit section or a bounded imported coordinate contour. Imported contours are normalized, checked, and cosine-resampled.
- User contours are represented with the same canonical camber and half-thickness data as generated NACA sections.
- Camber and half-thickness are blended independently between stations. The resolved local section drives the 3D loft, front/rear spar intersections and wing-box height, zero-lift angle, quarter-chord moment, and generated polar shape.

### Section polars and three-dimensional aerodynamics

- The active `SectionPolar` source is either a generated attached-flow analytic estimate or bounded user-supplied station/Reynolds tables. User tables retain provenance, alpha/Reynolds range states, and interpolation behavior in immutable results.
- The full-span cosine-spaced horseshoe-vortex lattice uses nonlinear section-polar closure, local Reynolds number, induced angle, and target-lift trim. Wake-induced drag is reported separately from spanwise SectionPolar profile drag; combined wing drag is their sum and remains a preliminary wing-only estimate, not whole-aircraft drag.
- Every configured fixed-angle sweep point independently solves the aerodynamic, section-polar, structural, and torsional-coupling problem. The fine visual scrubber selects exact solved points or interpolates adjacent converged points for presentation only; it does not create another immutable solve or imply stall prediction.
- The generated polar is an engineering approximation, not XFOIL, wind-tunnel data, experimental correlation, or a first-principles stall model.

### Structure and aeroelastic coupling

- The structure is a closed four-wall Aluminum 2024-T3 wing box with fixed front/rear spar locations. Its wall mass is integrated across station intervals independently of the aerodynamic mesh.
- A right-semispan Euler–Bernoulli bending and torsion model uses local stiffness. Lift relative to the elastic axis and the SectionPolar quarter-chord moment provide torsional loading.
- Torsional deformation feeds back into aerodynamic incidence through a fixed-point iteration. Bending deformation is postprocessed and does not feed back into aerodynamics. The reported modeled yield ratio is `σy / max(σVM)` at coincident wall locations, not a complete safety factor.

### Diagnostics and visualization

- The linked 2D Section Flow Lab is an independent Hess–Smith potential-flow diagnostic for the exact selected local section. It reports `Cp`, force/moment coefficients, residuals, streamlines, and vectors; it does not replace or silently modify the three-dimensional solver.
- The 3D geometry, load, structure, Efficiency, and 2D views derive engineering values from committed analysis snapshots. View-only AoA and station presentation changes may interpolate or recalculate diagnostic displays without mutating the design or official trim result. The 2D diagnostic remains explicitly independent and limited as described above.

### Explicit limitations

Aeroficiency does not model or claim first-principles boundary layers, transition, roughness, separation, stall, or turbulence; compressibility, transonic/shock effects, wave drag, ground effect, or free-wake roll-up; fuselage, tail, nacelle, propulsive, control-surface, interference, or whole-aircraft drag; high-fidelity CFD/FEA or experimental correlation of the complete system; bending feedback to aerodynamics; structural self-weight, gravity, manoeuvre inertia, gust, landing, or certification load cases; aeroelastic divergence, flutter, unsteady response, or other dynamics; buckling, crippling, fatigue, damage tolerance, local failure, stress concentrations, joints, or fasteners; or manufacturing, cost, systems, controls, stability, handling-qualities, and airworthiness approval. Input bounds and passed checks are guardrails for this deterministic preliminary model, not evidence of physical validity, manufacturability, safety, or certification.

## Testing and reproducibility

The repository includes deterministic automated coverage for the current domain model, solver behavior, integration paths, Site Tool contracts, revision and idempotency safeguards, and UI/presentation semantics. To reproduce the local release checks, install the locked dependencies and run:

```bash
npm ci
npm run release:check
```

Treat the command output from the checked-out revision as the source of truth. These checks verify implementation consistency and regression behavior; they are not wind-tunnel, flight-test, certification, or full-system physical validation.

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

Aeroficiency is a clean-start solo project created during the 2026 OpenAI WebMCP Challenge. Private eligibility, credentials, correspondence, and planning attachments are outside the repository boundary.

Aeroficiency is released under the [MIT License](LICENSE). Third-party packages and their terms are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
