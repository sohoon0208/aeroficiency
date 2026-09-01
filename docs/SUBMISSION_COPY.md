# Draft submission copy

This document is prepared for the final Devpost entry but is not submitted. The V5 clean-copy gate, deterministic Site Tool evals, and real local browser workflow pass; hosted CI, final supported-browser/model reliability, the frozen-release demo, public deployment, live-origin headers, and all public links remain pending until separately verified. Replace every `PENDING_*` token only after the corresponding artifact is public and verified while logged out.

## Project details

- **Name:** Aeroficiency
- **Tagline:** A visible, solver-backed wing co-design workspace where humans and agents share one revision-safe engineering model.
- **Live application:** `https://aeroficiency.larerraven.chatgpt.site`
- **Public repository:** `PENDING_PUBLIC_REPOSITORY_URL`
- **Demo video:** `PENDING_PUBLIC_YOUTUBE_URL`
- **License:** MIT

## Short description

Aeroficiency turns preliminary wing trade studies into a shared human–agent workflow. A human can define user-positioned spanwise airfoils, configure an angle-of-attack sweep, inspect committed 3D geometry/load/structure views, open a linked 2D Section Flow Lab, and review Reynolds/polar drag evidence. An agent can use ten WebMCP Site Tools to read exact state, branch candidates, change the Baseline reference, make bounded design changes, configure the same sweep, run the low-order target-lift and fixed-AoA torsion-coupled solver, and focus immutable evidence. Revisions, warnings, configured checks, failures, and activity remain visible to both.

## Why is this a strong WebMCP use case?

Engineering applications encode meaning across numeric fields, revision state, plots, tables, and a 3D model. An agent relying on visual browser automation has to guess which values are current, which controls are safe to change, and whether a result belongs to the design now on screen. A plausible-looking click sequence can silently overwrite human work or compare incompatible analyses.

Aeroficiency exposes the engineering operations themselves. The agent reads stable design and analysis IDs, explicit revisions, SI units, model limits, constraint states, and immutable solver fingerprints. It can perform a multi-step trade study while the human watches the same model change. WebMCP is therefore the collaboration layer, not a chatbot added beside the application.

## How does WebMCP improve the user experience?

The checked-in adapter defines ten narrow Site Tools—two pure reads, two presentation actions, and six engineering writes—rather than requiring an agent to interpret sliders and canvas pixels. Reads expose bounded state and immutable summaries. Presentation actions visibly focus a current station or pin an exact comparison pair without changing engineering revisions, analyses, activity, or keyboard focus. Writes require expected revisions, explicit targets, strict schemas, and UUID idempotency keys; candidate creation, Baseline-role changes, sweep configuration, and analysis also require the relevant shared revision. The analysis tool uses the same worker solver and commit validation as the Run button. Final discovery and reliability in the supported public environment remain release gates.

This makes the interaction inspectable and resilient. A human edit immediately makes older results stale. If an agent then writes against the old revision, Aeroficiency rejects the overwrite and returns the current revision plus a safe recovery action. Bounded idempotency records replay identical writes exactly while retained; after eviction, stale revisions fail closed instead of duplicating old work. Every accepted mutation appears in the controls, 3D model, plots, result cards, and actor-tagged activity history. Tool edits expose their affected editor while preserving persistent focus; if the editor switch replaces a focused input, focus lands on changed evidence instead of disappearing. A background analysis commit identifies its target even when the human is viewing another design.

## What can humans and agents do together now?

The human sets the engineering intent, can edit any design, can choose which candidate becomes the Baseline reference, and retains the final decision. The agent can inspect the current Baseline, create candidates, make the same explicit role change, edit bounded planform values, complete airfoil-station definitions, SectionPolar data, or wing-box gauges, configure the fixed-AoA sweep, run low-order target-lift and fixed-AoA torsion-coupled analysis, focus current span stations, and compare modeled wall mass, induced/profile/combined wing drag, wing L/D, deformation, modeled yield ratio, and convergence. Comparison is deliberately unavailable until at least one candidate exists.

In the planned deterministic demo, the first proposal reduces modeled wall mass by only about 3.15%, so the agent corrects it. The final `aeroficiency-0.6.0` fixture reports about 8.49% lower modeled wing-box wall mass while all five configured checks pass. The truthful trade-off is: “The candidate achieves a meaningful modeled wing-box wall-mass reduction while no meaningful improvement is claimed in the wake-induced-drag estimate.” This is visible, constraint-aware co-design—not autonomous optimization.

## How did you implement WebMCP?

Aeroficiency is a React/TypeScript application built with ChatGPT Sites, Vinext/Vite, Zustand, Three.js, and dedicated Web Workers. It has no application backend, account, database, OpenAI API call, or secret. The V4/V5 solver resolves two–six NACA/imported airfoil stations into local camber and thickness, interpolates generated or user-supplied section polars in alpha/Reynolds/span, closes a nonlinear one-row lifting-line system, trims to target lift, independently reruns every configured fixed-AoA point, integrates profile drag, and couples local lift and quarter-chord moment to an Aluminum 2024-T3 box, Euler–Bernoulli bending, torsion rods, and coincident-wall von Mises recovery.

`document.modelContext.registerTool` is feature-detected in one adapter. Exactly ten tools use strict JSON schemas with `additionalProperties: false`, repeated Zod validation, accurate security annotations, and compact result projections. Both the normal UI and WebMCP writes call the same pure domain commands. The single editable-Baseline invariant, comparison gating, hard bounds, optimistic revisions, SHA-256 fingerprints, immutable trim/sweep snapshots, idempotency, stale-worker rejection, bounded histories, abort handling, and convergence semantics are enforced below the interface. The compact analysis summary stays below a frozen 1,500-byte UTF-8 success ceiling while full supported bounds remain shared through validation, schemas, Model Scope, and documentation.

Only one project analysis can run at a time. A caller or the visible Cancel control can abort it. A validated non-converged snapshot may be retained for diagnostics, but it returns `ANALYSIS_DID_NOT_CONVERGE`, leaves constraints unavailable, and does not replace the last current converged result.

The 3D view and plots are generated from committed state. The linked Hess–Smith lab exposes inviscid `Cp`, streamlines, vectors, force/moment coefficients, and residuals without feeding the wing solver. The Efficiency view distinguishes generated versus imported polar provenance and induced, profile, and combined wing drag. No analysis value is fabricated by a language model. Aeroficiency permanently labels itself preliminary. It omits first-principles boundary layers, transition, separation/stall, turbulence, compressibility/transonic flow, free-wake roll-up, fuselage/interference and whole-aircraft drag, bending feedback, structural weight and inertial loads, dynamic aeroelasticity, buckling/fatigue/local failure, manufacturing detail, high-fidelity correlation, and certification cases.

## Technologies

React, TypeScript, Next.js compatibility via Vinext, Vite, Zustand, Three.js / React Three Fiber, Zod, Vitest, Web Workers, WebMCP Site Tools, ChatGPT Sites, and a Cloudflare Worker runtime.

## Final-entry checks

- Confirm the live URL loads in a fresh logged-out session.
- Confirm exactly ten Site Tools in the supported ChatGPT/Chrome environment.
- Reconfirm the `aeroficiency-0.6.0` fixture on the frozen release.
- Confirm the repository platform recognizes the root MIT license.
- Confirm the video is public, audible, captioned, and strictly under 3:00.
- Remove all `PENDING_*` tokens.
- Do not include private eligibility records.
