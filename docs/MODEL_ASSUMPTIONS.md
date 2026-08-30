# Model assumptions and conventions

Aeroficiency solver `aeroficiency-0.5.0` implements a deterministic, low-order, Reynolds/polar-aware, torsion-coupled static wing model for transparent preliminary trade studies. These limits are part of every result.

## Structured validity contract

The authoritative machine-readable contract is `lib/domain/modelValidity.ts`; shared bounds are in `lib/domain/limits.ts` and `lib/domain/validation.ts`.

| Field | Value |
|---|---|
| Status | `PRELIMINARY` |
| Method | `LOW_ORDER_REYNOLDS_POLAR_TORSION_COUPLED_STATIC` |
| Wake model | `FIXED_POSITIVE_X_BODY_AXIS` |
| Target-lift trim bracket | −8° to +12° |
| Aerodynamic fidelity | 16 full-span panels (`fast`) or 32 (`standard`) |

Supported scalar bounds include span 4–16 m, root chord 0.8–4 m, tip chord 0.3–3 m, taper ratio 0.2–1, aspect ratio 4–14, root twist 0°, tip twist −6° to +3°, skin gauge 1.2–6 mm, front/rear web gauges 1.5–8 mm, elastic axis 0.20c–0.55c, target lift 2–120 kN, speed 20–85 m/s, altitude 0–11 km, density 0.25–1.5 kg/m³, and dynamic viscosity 1e−5–2.5e−5 Pa·s. The combined geometry/case must require target CL 0.15–1.00. Elastic twist is limited to 15° and tip deflection to 10% of semispan.

Coupled validation also requires tip chord not to exceed root chord, taper and aspect ratio to remain valid after a patch, the elastic axis to lie inside the spar box, and the largest gauge not to exceed 10% of the smallest local box dimension.

## Coordinates, signs, and totals

- SI units are used internally.
- `+x` points aft, `+y` starboard, and `+z` upward.
- The centreline is `y = 0`; span plots use the right semispan.
- Span and area are full-wing values. Lift, drag, and modeled wall mass are full-wing totals.
- Shear, bending moment, torque, deflection, twist, and station plots are right-semispan values.
- Positive induced angle denotes downwash and is subtracted from local incidence.
- Positive quarter-chord moment is nose-up by the section convention.
- Geometric and elastic twist act about the quarter-chord reference. Displayed bending deformation is not fed back into the aerodynamic lattice.

## Planform

The wing is symmetric, unswept, and zero-dihedral with linear chord and geometric twist:

```text
eta = 2|y|/b
c(eta) = c_root + eta(c_tip - c_root)
theta_g(eta) = theta_root + eta(theta_tip - theta_root)
S = b(c_root + c_tip)/2
AR = b²/S
```

Root twist is fixed at zero.

## V4 spanwise airfoil model

A design contains two to six ordered airfoil stations. Root `eta = 0` and tip `eta = 1` are mandatory; adjacent stations are separated by at least 0.05 normalized semispan. Each interval uses either linear camber/half-thickness blending or a left-section hold.

Each station accepts:

- a supported NACA four-digit definition with 0–6% camber and 6–24% thickness; or
- 24–161 finite contour points with a visible name and optional bounded source string.

Imported contours are deduplicated, translated, rotated to the inferred chord, normalized to unit chord, de-trended between leading and trailing edges, checked for self-intersection and positive interior thickness, split into upper/lower branches, and cosine-resampled. NACA and imported sections then share the same canonical camber and half-thickness representation.

At every requested `eta`, the solver resolves a local section. That exact local section drives:

- the 3D wing surface and selected-section outline;
- front/rear spar surface intersections and the local wing-box height;
- zero-lift angle from the camber-line slope;
- quarter-chord moment coefficient from thin-airfoil camber harmonics; and
- the generated analytic polar shape.

Linear blending is performed on camber and half-thickness, not by naively interpolating unordered contour points. The final surface is reconstructed normal to the blended camber line.

## V5 SectionPolar model

The active polar source is one of two explicit modes.

### Generated attached-flow estimate

The default mode generates a deterministic section polar at the requested local Reynolds number. It uses thin-airfoil zero-lift incidence, a smooth bounded attached-flow lift curve, a turbulent flat-plate/form-factor profile-drag estimate, a lift-dependent drag term, and the local quarter-chord moment. It is labelled `ANALYTIC_ESTIMATE` throughout the UI and snapshot.

This is not XFOIL, a boundary-layer solver, wind-tunnel data, or a first-principles stall model. The smooth lift cap only prevents an unbounded surrogate.

### User station/Reynolds tables

User mode accepts up to 18 tables. Every airfoil station must be covered. Each table contains 7–61 strictly increasing alpha rows with finite `Cl`, positive `Cd`, and finite `Cm`; Reynolds number is 50,000–50,000,000; Mach metadata is 0–0.30 and common across the imported set. Provenance must be `USER_IMPORT`, `XFOIL`, or `EXPERIMENT` with a non-empty label.

The solver interpolates in this order:

1. alpha within each table;
2. Reynolds number between tables for a station; and
3. span between the local bracketing airfoil stations, following the same blend/hold rule.

Alpha up to 2° beyond a table is flagged `extrapolated_alpha`; farther alpha and out-of-range Reynolds values are explicitly flagged. Outside-range evaluation clamps at the nearest bounded table edge rather than silently inventing a remote trend. Range-state counts and provenance are retained in every immutable analysis.

## Nonlinear lifting-line and drag

The aerodynamic lattice uses one full-span cosine-spaced row of horseshoe vortices. Bound vortices are at quarter chord, control points are at three-quarter chord, and fixed semi-infinite wake legs extend in `+x` with a small vortex core.

For each strip, the nonlinear solve couples circulation to the active local polar:

```text
alpha_effective = alpha_trim + theta_geometric + theta_elastic - alpha_induced
Re = rho V_local c / mu
Cl_section = SectionPolar(eta, Re, alpha_effective).Cl
L' = q_local c Cl_section
```

The polar residual is solved with Newton updates, line search, and a deterministic fallback. The outer target-lift trim finds the full-wing angle of attack that matches the prescribed lift. Dense solves use scaled partial-pivot LU and residual checks.

Wake-induced drag comes from the wake-only induced velocity. Profile drag is integrated from local section `Cd`:

```text
D_profile = sum(q_local c Cd_section dy)
D_wing = D_induced + D_profile
estimated wing L/D = L / D_wing
```

`D_wing` is a preliminary wing-only value. It excludes fuselage, tail, nacelle, control-surface, interference, cooling, wave, and other aircraft drag. The configured challenge comparison continues to use the wake-induced-drag estimate at matched target lift; V5 profile/combined drag are additional evidence, not a silently changed objective.

## Structure and aeroelastic coupling

The structure is a closed four-wall Aluminum 2024-T3 box. Front and rear spars are fixed at 0.20c and 0.65c. Their endpoints follow the exact local airfoil surfaces; skins join the endpoints. Five-point Gauss integration over intervals split at every airfoil station makes wall-mass integration independent of the aerodynamic mesh.

The right semispan uses Euler–Bernoulli bending and torsion-rod elements at positive-side aerodynamic strip boundaries. Variable `EI` and `GJ` use Gauss quadrature. Torsional loading includes both lift acting relative to the elastic axis and the SectionPolar quarter-chord moment:

```text
T' = (x_EA/c - 0.25)c L' + q c² Cm,c/4
```

Thin-wall Bredt–Batho torsion, beam bending stress, and coincident-wall von Mises stress are recovered. The modeled yield ratio is `sigma_y / max(sigma_VM)`; it is not a complete safety factor.

Torsional deformation feeds back into the aerodynamic incidence through an under-relaxed fixed-point iteration. Convergence requires the raw-equilibrium residual, relaxed iterate change, load-field change, and target-lift error all to pass, followed by a verification solve. Bending is one-way postprocessing only.

## Analysis-bound diagnostics

The 2D Section Flow Lab solves an independent Hess–Smith source/global-vortex potential-flow problem for the exact selected local section. It reports `Cp`, force/moment coefficients, Kutta/source residuals, streamlines, and vectors. The 3D viewport is a committed geometry/load/structure visualization; it is not a CFD field solver.

The Efficiency mode reads immutable strip/station data and shows local Reynolds number, sectional lift, profile drag, polar range state, induced/profile/combined drag, and estimated wing L/D. Changing a visualization selection does not mutate the design or rerun the coupled solver.

See [flow visualization](FLOW_VISUALIZATION.md) for diagnostic-specific limits.

## Explicit omissions

Aeroficiency does not model or claim:

- first-principles laminar/turbulent boundary layers, transition, roughness, separation, or stall;
- compressibility, transonic/shock effects, wave drag, ground effect, or free-wake roll-up;
- fuselage, tail, nacelle, propulsive, control-surface, interference, or whole-aircraft drag;
- high-fidelity CFD/FEA or experimental correlation of the complete model;
- bending feedback to aerodynamics;
- structural self-weight, gravity, manoeuvre inertia, gust, landing, or certification load cases;
- aeroelastic divergence, flutter, unsteady response, or other dynamics;
- buckling, crippling, fatigue, damage tolerance, local failure, stress concentrations, joints, or fasteners;
- manufacturing, cost, systems, controls, stability, handling qualities, or airworthiness approval.

Input bounds and passed checks are guardrails for this deterministic preliminary model. They do not establish physical validity, manufacturability, safety, or certification for a real aircraft.
