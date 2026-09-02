# Aeroficiency

Aeroficiency is a browser-based preliminary wing design and static aeroelastic exploration workspace for engineers and students, with AI agents operating through WebMCP. It brings editable wing geometry, section and polar inputs, aerodynamic analysis, structural response, angle-of-attack studies, and design comparison into one shared workflow.

Start from generated NACA four-digit sections or import bounded custom coordinate contours across two to six spanwise stations. Configure generated or imported section-polar data, set wing and structure inputs, solve at a target-lift condition, explore a fixed-angle sweep, and compare candidate designs against a baseline reference. Results are linked across 3D geometry, aerodynamic loads, structural response, efficiency, 2D section-flow, and comparison views.

The visual interface and Site Tools operate on the same revision-checked design state. A person can edit and inspect the model directly, while a compatible AI agent can read the current state, make bounded updates, run analyses, focus evidence, and explain design trade-offs through the ten tools below.

[Open the live Aeroficiency Site](https://aeroficiency.larerraven.chatgpt.site/)

![Aeroficiency design and analysis workspace](public/og.png)

## Run Locally

Requires Node.js 22.13 or newer.

```bash
git clone https://github.com/sohoon0208/aeroficiency.git
cd aeroficiency
npm ci
npm run dev
```

Open `http://localhost:3000`.

To run the complete local release check:

```bash
npm run release:check
```

This runs linting, TypeScript checks, license verification, tests, the production build, and the dependency audit.

## Site Tools

| Site Tool | Purpose |
|---|---|
| `get_design_state` | Read the current engineering state |
| `get_analysis_summary` | Read an immutable analysis summary |
| `inspect_span_station` | Focus a span station and linked evidence |
| `compare_designs` | Focus an exact baseline/candidate comparison |
| `create_candidate_variant` | Create a candidate design |
| `set_baseline_design` | Set the comparison baseline |
| `update_wing_geometry` | Update bounded wing geometry |
| `update_wing_structure` | Update bounded structural parameters |
| `configure_angle_sweep` | Configure the angle-of-attack exploration range |
| `run_aeroelastic_analysis` | Run and commit an analysis |

Human controls and Site Tools use the same validation, revision checks, idempotency protection, and immutable analysis results.

## Engineering Scope

Aeroficiency models a symmetric, unswept, zero-dihedral trapezoidal wing in SI units. Users can define two to six spanwise stations with generated NACA four-digit sections or bounded imported coordinate contours, and supply generated analytic or imported section-polar data. The local solver performs Reynolds- and polar-aware low-order full-span aerodynamic analysis with nonlinear section-polar coupling, target-lift trim, independently solved fixed-angle sweeps, separate profile, induced, and combined wing-drag estimates, and wing-only lift-to-drag reporting. A closed thin-wall wing-box model adds torsion-coupled static response and bending postprocessing. The linked Hess–Smith 2D section-flow diagnostic provides local pressure, streamline, and vector evidence for the selected station.

## Limitations

Aeroficiency is intended for preliminary exploration and comparative design work. It is not a replacement for CFD, wind-tunnel testing, detailed finite-element analysis, or certification evidence. The current model does not provide high-fidelity separated-flow or stall prediction, compressible or transient aerodynamics, dynamic aeroelasticity, full bending-aerodynamic coupling, fuselage, tail, or control-surface interference, whole-aircraft drag, manufacturing assessment, or flight-safety approval. Imported coordinates and polar data remain subject to their source quality and applicable operating range.

## License

Aeroficiency is available under the [MIT License](LICENSE). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for third-party software and asset notices.
