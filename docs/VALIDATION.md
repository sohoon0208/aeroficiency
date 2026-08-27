# Validation record

This document records the checked-in validation plan, deterministic `aerociency-0.2.0` evidence, and the local release checks completed on 2026-08-28. The clean-copy gate, local in-app browser acceptance, and local production-runtime header checks passed. Hosted CI, public deployment, final browser/model reliability, and live-origin evidence remain pending. This is not an independent certification or experimental correlation report.

## Automated gates

Before release, run and record:

```bash
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run licenses:check
npm run build
npm audit --audit-level=high
```

A clean Git archive passed every command above on 2026-08-28: 12 Vitest files / 50 tests, 119 production dependency entries / 58 distinct license documents, and zero audited vulnerabilities. The suite covers numerical foundations, NACA/planform geometry, aerodynamic signs and symmetry, wing-box properties and stress, cantilever bending/torsion, aeroelastic coupling, immutable analysis construction, physics fingerprints, domain transitions, and WebMCP contracts. Hosted CI remains a publication gate.

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

These numbers are deterministic regression evidence for this implementation and input fixture and were also reproduced through the local in-app Site Tool workflow. They are not prompt-driven final-browser/model reliability evidence or validation against flight test, CFD, FEA, or a real wing.

## Browser and release checks

- [x] A clean load presents no analysis instead of fabricated metrics.
- [x] Standard baseline analysis completes in the dedicated worker.
- [x] The local in-app WebMCP environment discovers all and only the eight source-defined tools.
- [x] A direct Site Tool trace creates, edits, analyzes, and compares a candidate while the visible UI updates.
- [x] A later human edit makes results stale in the checked tool/store integration path.
- [x] A write against the prior revision returns `REVISION_CONFLICT` with current revisions and does not overwrite the human.
- [x] At 1440 px, the three work areas fit the viewport.
- [x] At 390 px, metrics remain reachable and the page has no horizontal overflow, including a 568 px-short viewport.
- [x] Design, Model, and Results mobile views remain reachable.
- [x] Local Vinext and generated Cloudflare Worker `/` responses contain the intended security headers.
- [ ] CI passes on the frozen public commit.
- [ ] The live origin returns the intended security headers without CSP violations.
- [ ] The final supported browser/model prompt suite passes every safety invariant and E10 succeeds at least 9/10 fresh runs.

## Limits of this validation

The project has no wind-tunnel, flight-test, high-fidelity CFD, shell-FEA, or certification correlation. Wake-only drag and one-row lattice convergence are explicitly low-order estimates. Material yield is not a general structural safety factor. The allowed input domain is conservative but not a guarantee that every mathematically accepted design is physically buildable.

Before publication, approve or replace the Git attribution metadata, run hosted CI on the frozen public candidate, repeat the prompt-driven suite in the final supported ChatGPT/Chrome WebMCP environment, set the canonical HTTPS origin, and verify the live production headers. Record a deployment identifier here only after the user authorizes publication and those artifacts exist.
