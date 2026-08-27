# Model assumptions and conventions

Aerociency solver `aerociency-0.2.0` implements a deterministic low-order model for transparent preliminary trade studies. These assumptions are part of every result, not optional fine print.

## Coordinates, signs, and units

- SI units are used internally: metres, kilograms, seconds, newtons, pascals, and radians.
- `+x` points aft along the chord, `+y` points starboard, and `+z` points upward.
- The aircraft centreline is `y = 0`; plots use the right semispan, `0 <= y <= b/2`.
- Span is projected full span. Area, aerodynamic force, and structural mass are full-wing quantities.
- Root shear, bending moment, torque, and station plots are right-semispan quantities.
- Positive twist raises the leading edge relative to the freestream convention used by the lattice normal.
- Geometric and elastic twist are applied once about the quarter-chord aerodynamic reference. Bending displacement is displayed but not fed back into the aerodynamic lattice.

## Planform and airfoil

The challenge model is a symmetric, unswept, zero-dihedral trapezoid. Chord and geometric twist vary linearly with absolute span position:

```text
c(y) = c_root - (c_root - c_tip) * 2|y|/b
theta_g(y) = theta_root + (theta_tip - theta_root) * 2|y|/b
S = b(c_root + c_tip)/2
AR = b^2/S
```

Root twist is fixed at zero. One NACA four-digit definition is used across the span. The standard mean-camber line is combined with the thickness distribution

```text
y_t = 5t(0.2969 sqrt(x) - 0.1260x - 0.3516x^2 + 0.2843x^3 - 0.1036x^4)
```

which uses the closed-trailing-edge coefficient. Thickness is offset normal to the mean-camber line. Symmetric sections explicitly bypass camber-position division. The aerodynamic solver uses camber only through a numerically integrated thin-airfoil zero-lift angle; thickness affects geometry and the wing box, not lattice aerodynamics.

## Aerodynamic model

- Steady, incompressible, inviscid, attached potential flow.
- Full-wing, one chordwise row of cosine-spaced horseshoe vortices.
- Bound vortices lie on the quarter-chord reference; control points are at the three-quarter-chord offset (`0.5c` aft of the bound line in the implementation's local coordinates).
- Semi-infinite wake legs extend in fixed `+x` with a core radius of `1e-6` mean aerodynamic chord.
- The dense influence system uses scaled partial-pivot LU and verifies a relative residual.
- Kutta–Joukowski force is recovered per strip from the solved circulation.
- The section normal incorporates geometric twist, elastic twist, and the NACA thin-airfoil zero-lift correction.
- Angle of attack is bisected within `-8 deg` to `+12 deg` until the current twisted lattice meets the prescribed full-wing target lift.
- Wake-induced drag is calculated from wake-only induced velocity. It is an estimate of induced drag, not total drag.
- `fast` uses 16 full-span panels; `standard` uses 32.

The model excludes profile/skin-friction drag, compressibility, viscosity, Reynolds-number effects, stall, separation, transonic effects, ground effect, pitching moment, fuselage/tail interference, control surfaces, and arbitrary wake roll-up. Altitude and viscosity are recorded with the fixed flight-case definition but only supplied density and velocity enter the current equations.

## Wing box and material

The structural section is a single closed four-wall box. Front and rear webs are fixed at `0.20c` and `0.65c`. Their upper/lower endpoints follow the NACA surface ordinates; the skins connect those points. The user may change skin gauge, front/rear web gauges, and the preliminary elastic-axis fraction.

Thin-wall line properties are used:

```text
A_wall = sum(t_i l_i)
I_x = sum[t_i integral(z^2 ds)] - A_wall z_bar^2
J ~= 4 A_enclosed^2 / sum(l_i/t_i)
EI = E I_x
GJ = G J
```

Mass per span is `rho A_wall`, integrated with three-point Gauss quadrature and doubled from semispan to full wing. Gauge must remain below 10% of every local box dimension.

The only material is Aluminum 2024-T3:

| Property | Value |
|---|---:|
| Density | 2780 kg/m³ |
| Young's modulus | 73.1 GPa |
| Poisson ratio | 0.33 |
| Shear modulus | `E/[2(1+nu)]` |
| Yield strength | 345 MPa |

The elastic-axis input is a reference axis, not a computed shear center.

## Beam and stress model

The right semispan is a root-clamped Euler–Bernoulli bending beam plus a torsion rod. Nodes exactly follow positive-side aerodynamic strip boundaries. Variable `EI` and `GJ` are integrated with three-point Gauss quadrature. Uniform per-element aerodynamic force uses the consistent Hermite load vector; total force, root moment, and torque are preserved by the mapping.

Only the vertical component of aerodynamic force drives bending. Strip torque about the elastic axis is

```text
T_strip = (x_EA/c - 0.25)c F_z
```

At each wall endpoint, bending stress and closed-cell torsional shear are combined at the same physical location:

```text
sigma = -M(z-z_bar)/I
q = T/(2 A_enclosed)
tau_i = q/t_i
sigma_vm = sqrt(sigma^2 + 3 tau_i^2)
yield margin = yield strength / max(sigma_vm)
```

A zero-action station reports a null local yield margin rather than infinity. The summary minimum ignores null stations.

This yield margin omits buckling, crippling, fatigue, damage tolerance, joints, fasteners, ribs, caps, cut-outs, stress concentrations, manufacturing tolerances, load factors, ultimate factors, and certification allowables.

## Static aeroelastic coupling

Aerociency couples torsion in both directions and postprocesses bending:

1. Build the full-wing lattice using the current elastic-twist field.
2. Trim angle of attack to the target lift.
3. Map vertical force and quarter-chord-to-elastic-axis torque to the beam.
4. Solve bending and torsion.
5. Under-relax twist with factor `0.35`.
6. Repeat, then independently verify the candidate converged iterate.

Convergence requires at least two iterations and all of:

| Diagnostic | Tolerance |
|---|---:|
| Unrelaxed equilibrium residual | `2e-5 rad` |
| Relaxed iterate change | `1e-5 rad` |
| Relative load change | `2e-4` |
| Relative target-lift error | `1e-5` |

The iteration limit is 40. Elastic twist above 15 degrees or tip bending above 10% of semispan is outside the supported model. Non-convergence is not labeled divergence and cannot satisfy constraints.

## Constraint semantics

Five checks are stored with each immutable snapshot:

1. Structural mass reduction relative to a current baseline at matching fidelity.
2. Modeled yield margin.
3. Absolute tip deflection.
4. Induced-drag increase relative to the same current baseline and flight case.
5. Aeroelastic convergence.

A missing reference is `unavailable`; a later edit makes the presentation `stale`; a non-converged result cannot pass. Passing these low-order checks does not establish airworthiness.
