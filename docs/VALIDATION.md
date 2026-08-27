# Validation record

This document records the checked-in validation plan and one direct `aerociency-0.2.0` numerical fixture check. It does not assert that the clean-copy gate, browser acceptance, CI, a production deployment, or live response headers have passed, and it is not an independent certification or experimental correlation report.

## Automated gates

Before release, run and record:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run build
npm audit --audit-level=high
```

No clean-copy or CI result is recorded here yet. The checked-in Vitest suite contains tests for numerical foundations, NACA/planform geometry, aerodynamic signs and symmetry, wing-box properties and stress, cantilever bending/torsion, aeroelastic coupling, immutable analysis construction, physics fingerprints, domain transitions, and WebMCP contracts; execution remains a release gate.

## Analytic and deterministic checks

| Layer | Check | Acceptance idea |
|---|---|---|
| Dense algebra | Scaled partial-pivot solve and singular rejection | Known matrix solution and small relative residual |
| NACA | 0012 symmetry/finite coordinates; 2412 camber and zero-lift behavior | Closed trailing edge; expected sign and geometry |
| Planform | Area, taper, MAC, and cosine nodes | Analytic trapezoid identities |
| Vortex | Finite segment sign/reversal and endpoint behavior | Biot–Savart direction and linearity |
| Aerodynamics | Target lift, symmetry, positive induced drag | Tight lift and left/right residuals |
| Wing box | Thin-wall area, centroid, `I`, `J`, mass, coincident stress | Hand-calculated rectangular fixture |
| Beam | Tip load, distributed load, constant torsion | Classical cantilever formulae |
| Load mapping | Root shear, moment, and torque | Strip sums equal recovered actions |
| Coupling | Determinism, target lift, stiffness response | Same input/diagnostics and expected monotonic direction |
| Snapshot | Metadata, finite values, constraints, identity | Malformed or stale result cannot commit |
| State | baseline, revisions, idempotency, caps | Failed requests leave engineering state unchanged |
| WebMCP | schemas, annotations, bounded errors, all eight names | Unexpected input is rejected safely |

## Deterministic default fixture

Default geometry and case:

| Input | Value |
|---|---:|
| Span | 12.0 m |
| Root / tip chord | 2.40 / 1.08 m |
| Root / tip twist | 0 / -2 deg |
| Airfoil | NACA 2412 |
| Skin / front web / rear web | 1.80 / 2.20 / 2.20 mm |
| Elastic-axis fraction | 0.38c |
| Target lift | 31,600 N |
| Velocity / density | 64 m/s / 1.225 kg/m³ |
| Solver | `standard`, `aerociency-0.2.0` |

A direct deterministic check of `aerociency-0.2.0` at `standard` fidelity converged the baseline in 13 coupling iterations and produced approximately:

| Output | Value |
|---|---:|
| Structural mass | 119.2 kg |
| Wake-induced drag estimate | 851.4 N |
| Tip deflection | 0.109 m |
| Tip elastic twist | 0.18 deg |
| Minimum modeled yield margin | 3.76x |
| Trimmed angle of attack | 6.21 deg |

The comparison constraints for baseline-relative mass and drag are unavailable on the baseline by definition.

## Feasible demo fixture

Starting from a current baseline analysis, branch a candidate and set:

```text
skinThicknessMm = 1.65
frontWebThicknessMm = 2.00
rearWebThicknessMm = 2.00
```

The same direct solver check converged the candidate in 13 iterations at standard fidelity and produced approximately 109.10 kg structural mass, 851.23 N wake-induced drag, 0.1188 m tip deflection, 0.1937 deg tip twist, and a 3.44 minimum yield margin. Relative to that baseline it reduces modeled mass by about 8.49%, changes the wake-induced-drag estimate by about -0.014%, and passes all five configured candidate checks.

These numbers are local deterministic regression evidence for this implementation and input fixture. They are not end-to-end browser evidence or validation against flight test, CFD, FEA, or a real wing.

## Browser and release checks pending

- [ ] A clean load presents no analysis instead of fabricated metrics.
- [ ] Standard baseline analysis completes in the dedicated worker.
- [ ] The supported WebMCP environment discovers all and only the eight source-defined tools.
- [ ] An agent-style trace creates, edits, analyzes, and compares a candidate while the visible UI updates.
- [ ] A later human edit makes results stale.
- [ ] A write against the prior revision returns `REVISION_CONFLICT` with current revisions and does not overwrite the human.
- [ ] At 1440 px, the three work areas fit the viewport.
- [ ] At 390 px, metrics become one column and the page has no horizontal overflow.
- [ ] Design, Model, and Results mobile views remain reachable.
- [ ] CI passes on the frozen public commit.
- [ ] The live origin returns the intended security headers without CSP violations.

## Limits of this validation

The project has no wind-tunnel, flight-test, high-fidelity CFD, shell-FEA, or certification correlation. Wake-only drag and one-row lattice convergence are explicitly low-order estimates. Material yield is not a general structural safety factor. The allowed input domain is conservative but not a guarantee that every mathematically accepted design is physically buildable.

Before publication, run the clean-copy gate, repeat the deterministic demo from reset, test the actual supported ChatGPT/Chrome WebMCP environment, and verify the live production headers. Record a release commit and deployment identifier here only after the user authorizes publication and those artifacts exist.
