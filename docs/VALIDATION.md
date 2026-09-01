# Validation record

This record separates local V5 release-candidate evidence from public challenge evidence. It is not experimental correlation, independent certification, or evidence that the model is suitable for flight-safety decisions.

## Status

- Local implementation: `LOCAL_V5_RC_READY`
- Public/external work: `EXTERNAL_RELEASE_PENDING`
- App / solver / tool schema: `0.6.0` / `aeroficiency-0.6.0` / `aeroficiency-webmcp-1.5`
- Build identity: injected by `NEXT_PUBLIC_AEROFICIENCY_COMMIT`; local fallback `local`

No public repository publication, public hosting, recording, upload, or submission is included in this evidence.

## Local release gate

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run licenses:check
npm run build
npm audit --audit-level=high
```

| Gate | Result |
|---|---|
| Fresh `npm ci` in an isolated `/tmp` copy | Pass; 629 packages installed, 630 audited |
| ESLint | Pass with zero warnings |
| TypeScript | Pass |
| Vitest | 30 files / 190 tests pass |
| Production license inventory | 119 dependency entries / 58 distinct texts verified |
| `npm audit --audit-level=high` | Pass; 0 vulnerabilities |
| Vinext production build | Pass; documented chunk-size and route-classification notices only |
| Real local browser | Multi-section solve, all five modes, responsive layouts, and clean-reload console pass |

The clean install reports the upstream support-window notice for pinned ESLint 9. The current Next/React rule stack is kept at the known-good version; this does not enter the production browser bundle.

## Deterministic and analytic coverage

| Layer | Checks | Acceptance |
|---|---|---|
| Dense algebra | Scaled partial pivoting, residuals, singular rejection | Known solutions and bounded residuals |
| Planform/NACA | Camber, thickness, area, taper, MAC, cosine nodes | Analytic identities and finite output |
| V4 imported sections | Translation/rotation/scale normalization, order reversal, duplicates, branch coverage, self-intersection, thickness | Equivalent inputs canonicalize; invalid contours fail closed |
| V4 span stations | Root/tip coverage, ordering, separation, blend/hold, exact selected location, local zero-lift/Cm | Deterministic local section and bounded model |
| V4 structure coupling | Local spar intersections, thickness-driven box, station-split mass integration | Mesh-independent mass and expected stiffness direction |
| V5 polars | Generated estimate, user provenance, alpha/Re/span interpolation, range states | Deterministic coefficients and explicit outside-range state |
| V5 nonlinear aero | Polar closure, target lift, symmetry, induced/profile/combined identities | Lift/solver tolerances and positive finite drag |
| Fixed-AoA sweep | Exact angle grid, per-point VLM/polar/torsion solve, signed loads, drag identities, trim isolation | Deterministic converged point matrix; no frozen-deformation scaling |
| Cross-airfoil sweep | NACA 0008/0012/0024/2412, Clark Y, S1223, SG6043, NASA SC(2)-0412 | Finite monotonic lift response, positive drag, bounded residuals; representative full coupled sweeps converge |
| User-polar full solve | Four imported root/tip Reynolds tables | Current target-lift solve stays within declared ranges |
| Structure | Beam/torsion fixtures, lift-axis torque, SectionPolar moment, coincident stress | Classical cantilever checks and load preservation |
| Coupling | Torsional fixed point, verification solve, stiffness response | Four convergence criteria and deterministic output |
| 2D section panel | NACA/local/imported contour, Kutta, grid/order, sampled field | Stable `Cp`, forces, residuals, streamlines, vectors |
| Snapshot/trust boundary | Identity, revisions, fingerprints, multi-station reconstruction, finite JSON | Malformed or stale work cannot commit |
| Site Tools | Exact inventory, closed schemas, replay/conflict, editable Baseline, role replacement, sweep configuration, bounded errors/DTOs, focus | Ten names and safe shared-state invariants |
| UI/presentation | State matrix, editor/result tabs, V4/V5 labs, dialogs, keyboard/focus | No false pass, hidden write, overlap, or focus loss |

## Frozen standard-fidelity fixtures

Default reference inputs:

| Input | Value |
|---|---:|
| Span | 12.0 m |
| Root / tip chord | 2.40 / 1.08 m |
| Airfoil stations | NACA 2412 at eta 0 and 1 |
| Polar source | Aeroficiency analytic attached-flow estimate |
| Skin / front web / rear web | 1.80 / 2.20 / 2.20 mm |
| Target lift | 31,600 N |
| Velocity / density | 64 m/s / 1.225 kg/m³ |

The default Baseline reference converges in 10 coupling iterations:

| Baseline output | Value |
|---|---:|
| Modeled wing-box wall mass | 119.263006 kg |
| Wake-induced-drag estimate | 856.894938 N |
| Profile-drag estimate | 550.235864 N |
| Combined wing-drag estimate | 1,407.130802 N |
| Estimated wing L/D | 22.457045 |
| Tip deflection | 0.108961 m |
| Tip elastic twist | 0.049092° |
| Modeled yield ratio | 3.771242 |
| Trim angle | 5.856181° |

The first candidate gauges, `1.75 / 2.10 / 2.10 mm`, reduce modeled wall mass by about 3.15% and fail only the 5% objective.

The corrected `1.65 / 2.00 / 2.00 mm` candidate converges with all five checks passing:

| Candidate output | Value |
|---|---:|
| Modeled wing-box wall mass | 109.133774 kg |
| Wake-induced-drag estimate | 856.866903 N |
| Profile-drag estimate | 550.234506 N |
| Combined wing-drag estimate | 1,407.101409 N |
| Estimated wing L/D | 22.457514 |
| Tip deflection | 0.118968 m |
| Tip elastic twist | 0.053643° |
| Modeled yield ratio | 3.454159 |
| Trim angle | 5.853486° |
| Modeled wall-mass change | −8.493189% |
| Wake-induced-drag change | −0.003272% |

The wake-drag delta lies inside the UI’s ±0.05% neutral reporting band while still satisfying the strict no-worse check. The fixture conclusion remains: “The candidate achieves a meaningful modeled wing-box wall-mass reduction while no meaningful improvement is claimed in the wake-induced-drag estimate.” Profile and combined wing drag are supplemental V5 evidence, not substituted configured checks.

## Browser acceptance

- [x] Fresh reset displays no fabricated result.
- [x] Baseline standard analysis converges and exposes induced/profile/combined drag plus wing L/D.
- [x] A real candidate workflow adds `afs_mid1`, moves it to eta 0.65, changes it to NACA 0015, and successfully commits a three-section revision-4 analysis.
- [x] The analyzed multi-section wing updates the 3D loft, local section label, mass, drag, deformation, and polar-linked evidence.
- [x] Geometry, Aero loads, 2D Section, Efficiency, and Structure modes all render from a current immutable analysis.
- [x] A configured AoA sweep reruns the coupled solver at every point; its 0.01° presentation scrubber interpolates adjacent converged states, updates signed 3D/load/structure evidence and seven Efficiency plots, and recalculates local 2D pressure/streamlines without mutating the official trim result.
- [x] AoA and Linked 3D station drags use a live 40-panel section preview, coalesce expensive station calculations, commit the linked global station once on release, and then restore the selected 40/80/120/160-panel resolution.
- [x] The 2D wind-axis view keeps `U∞` horizontal while the airfoil, streamlines, and `Cp` update with local incidence; the 3D viewport smoothly applies a view-only AoA attitude and keeps its wind indicator and layered selected-station outline aligned without changing solver values.
- [x] Thin, thick, cambered, high-lift, glider, and supercritical section families pass the finite/monotonic/positive-drag and Hess–Smith Kutta/flux residual matrix.
- [x] Efficiency keeps drag summaries and local facts at readable heights and scrolls its plots deliberately.
- [x] Planform/Airfoils/Structure/Case and Overview/Checks/Compare/Log tabs fit their containers.
- [x] At tablet widths, the adjacent Summary toggle smoothly gives the result panel its own column and shrinks the engineering workspace instead of overlaying it; the current-result pill, long analysis ID, and `Close Summary` control remain inside the panel.
- [x] 1440×900, 1280×720, 1024×768, 390×844, and 640×360 layouts have no document-level horizontal overflow.
- [x] At 390 px, all five visualization tabs remain visible; V4/V5 diagnostic panels scroll vertically without horizontal clipping.
- [x] A fresh post-fix reload reports no console errors.

## External evidence still required

- [ ] Hosted CI passes on the frozen public commit.
- [ ] Final supported browser/model preserves every invariant and succeeds on at least 9/10 fresh canonical runs.
- [ ] Entrant authorizes a public repository and deployment.
- [ ] Logged-out public origin discovers exactly ten tools and returns intended security headers without CSP violations.
- [ ] Demo is recorded from the frozen public release and all submitted links work logged out.

## Limits

There is no wind-tunnel, flight-test, high-fidelity CFD, shell-FEA, or certification correlation. The generated polar is an attached-flow estimate; user tables are only as valid as their supplied provenance and coverage. The 2D lab is inviscid and does not model boundary layers, transition, separation, stall, or turbulence. Combined drag is wing-only, not total-aircraft drag. The modeled yield ratio is not a general safety factor. Input bounds and passed checks do not prove that a design is physically valid, buildable, safe, or certifiable.
