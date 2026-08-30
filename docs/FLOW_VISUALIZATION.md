# Section and performance visualizations

Aeroficiency keeps its flow-specific evidence in the linked 2D Section Flow Lab. The full-wing viewport is intentionally limited to committed geometry, aerodynamic loads, and structural response; it does not present a speculative 3D flow field or CFD-like result.

## Validated 2D Section Flow Lab

The lab is an independent constant-source/global-vortex Hess–Smith panel diagnostic for the exact V4 local section at the selected right-semispan station. The section may be NACA, imported coordinates, or a camber/thickness blend between stations. It uses 40, 80, 120, or 160 straight panels, enforces no penetration at panel collocation points, and applies a trailing-edge Kutta condition. The displayed pressure coefficient is

```text
Cp = 1 - (V_tangent / V_infinity)^2
```

The lab integrates surface pressure to report section lift coefficient, numerical inviscid drag residual, and conventional nose-up-positive quarter-chord moment coefficient. It also reports the Kutta residual, discrete source-flux residual, stagnation location, velocity vectors, total-velocity streamlines, and an accessible upper/lower surface `Cp` table.

The section condition is derived from committed state rather than a free UI angle:

```text
alpha_local = alpha_trim + theta_geometric + theta_elastic - alpha_induced
```

Here `alpha_induced` is positive for downwash. Local chord and Reynolds number are shown as context. The selected immutable V5 SectionPolar evaluation is shown separately for `Cl`, `Cd`, `Cm`, provenance, and range state. Reynolds number does not modify the inviscid Hess–Smith equations; it only affects the separate SectionPolar evidence. Changing station or panel count changes only this diagnostic and never mutates the wing, reruns the coupled solver, or changes constraints.

## V5 — Efficiency and polar evidence

The Efficiency view is not another solver. It projects values retained in the immutable coupled snapshot: local Reynolds number, sectional `Cl`, profile `Cd`, profile drag per span, polar range state, wake-induced drag, integrated profile drag, combined wing drag, and estimated wing `L/D`. It also evaluates the exact selected local section/polar for the readout. Generated analytic-polars and user-table provenance are always distinguished.

## Deterministic validation

Automated checks cover the panel solver against symmetric NACA 0012 at zero incidence, the thin-airfoil lift slope at positive incidence, grid-refinement stability, input contour reversal, imported/local-section handling, finite collocation values, bounded streamlines, and bounded velocity vectors. The default NACA 2412 section is also exercised in the browser at 160 panels. Those numerical consistency checks are not wind-tunnel agreement.

## Scientific boundary

The 2D diagnostic does not model a viscous boundary layer, transition, separation, stall, turbulence, wake roll-up, compressibility, unsteady flow, propulsive flow, fuselage interference, or ground effect. Its panel forces do not feed the wing solver. V5 profile drag comes from the explicitly labelled SectionPolar model, not from the inviscid panel lab; combined drag remains wing-only rather than total-aircraft drag. The 3D viewport is a geometry/load/structure view, not a CFD result. For the complete design-model contract, see [Model assumptions](MODEL_ASSUMPTIONS.md). For executed checks, see [Validation](VALIDATION.md).
