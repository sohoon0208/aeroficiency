# Draft submission copy

This document is prepared for the final Devpost entry but is not submitted. Runtime tool discovery, the clean-copy/CI gate, the frozen-release demo, public deployment, live headers, and all public links remain pending. Replace every `PENDING_*` token only after the corresponding artifact is public and verified while logged out.

## Project details

- **Name:** Aerociency
- **Tagline:** A visible, solver-backed wing co-design workspace where humans and agents share one revision-safe engineering model.
- **Live application:** `PENDING_LIVE_HTTPS_URL`
- **Public repository:** `PENDING_PUBLIC_REPOSITORY_URL`
- **Demo video:** `PENDING_PUBLIC_YOUTUBE_URL`
- **License:** MIT

## Short description

Aerociency turns preliminary wing trade studies into a shared human–agent workflow. A human can shape and inspect a wing through a professional 3D workspace; an agent can use eight WebMCP Site Tools to read explicit state, branch a protected baseline, make bounded candidate changes, run the same local aero-structural solver, and compare immutable results. Revisions, warnings, constraints, failures, and activity remain visible to both.

## Why is this a strong WebMCP use case?

Engineering applications encode meaning across numeric fields, revision state, plots, tables, and a 3D model. An agent relying on visual browser automation has to guess which values are current, which controls are safe to change, and whether a result belongs to the design now on screen. A plausible-looking click sequence can silently overwrite human work or compare incompatible analyses.

Aerociency exposes the engineering operations themselves. The agent reads stable design and analysis IDs, explicit revisions, SI units, model limits, constraint states, and immutable solver fingerprints. It can perform a multi-step trade study while the human watches the same model change. WebMCP is therefore the collaboration layer, not a chatbot added beside the application.

## How does WebMCP improve the user experience?

The checked-in adapter defines eight narrow Site Tools—four read-only and four write—rather than requiring an agent to interpret sliders and canvas pixels. Read tools expose bounded state and span-station results. Write tools require expected revisions, candidate-only targets, strict schemas, and UUID idempotency keys. The tool that runs analysis uses the same worker solver and commit validation as the Run button; the comparison tool accepts only distinct, current, converged, compatible immutable analyses and never launches hidden work. Final discovery of all eight tools in the supported environment remains a release gate.

This makes the interaction inspectable and resilient. A human edit immediately makes older results stale. If an agent then writes against the old revision, Aerociency rejects the overwrite and returns the current revision plus a safe recovery action. Every accepted mutation appears in the controls, 3D model, plots, result cards, and actor-tagged activity history.

## What can humans and agents do together now?

The human sets the engineering intent and retains the protected baseline and final decision. The agent can inspect that baseline, create a candidate, reduce bounded wing-box gauges, run target-lift static aeroelastic analysis, inspect critical span stations, and compare mass, induced-drag estimate, deflection, elastic twist, modeled yield margin, and convergence.

In the planned deterministic demo, the agent creates a lighter candidate without touching the baseline. A direct check of `aerociency-0.2.0` reports about 8.49% lower modeled structural mass while all five configured checks pass; the fixture must be reconfirmed on the frozen release before this claim is submitted. The human then changes one value manually; the agent encounters a revision conflict, rereads the shared state, preserves the human decision, and continues safely. The value is not autonomous optimization—it is visible, constraint-aware co-design.

## How did you implement WebMCP?

Aerociency is a React/TypeScript application built with ChatGPT Sites, Vinext/Vite, Zustand, Three.js, and a dedicated Web Worker. It has no application backend, account, database, OpenAI API call, or secret. The solver combines a full-wing cosine-spaced one-row horseshoe lattice, target-lift trim, a closed thin-walled Aluminum 2024-T3 box, Euler–Bernoulli bending, torsion-rod elements, same-location von Mises recovery, and under-relaxed two-way torsional coupling.

`document.modelContext.registerTool` is feature-detected in one adapter. Exactly eight tools use strict JSON schemas with `additionalProperties: false`, repeated Zod validation, accurate security annotations, and compact result projections. Both the normal UI and WebMCP writes call the same pure domain commands. Candidate protection, hard bounds, optimistic revisions, SHA-256 fingerprints, immutable snapshots, idempotency, stale-worker rejection, bounded histories, abort handling, and convergence semantics are enforced below the interface.

Only one project analysis can run at a time. A caller or the visible Cancel control can abort it. A validated non-converged snapshot may be retained for diagnostics, but it returns `ANALYSIS_DID_NOT_CONVERGE`, leaves constraints unavailable, and does not replace the last current converged result.

The 3D view and plots are generated from committed state. No analysis value is fabricated or generated by a language model. Aerociency permanently labels itself a preliminary low-order model: profile drag, stall, pitching moment, bending feedback, divergence, flutter, buckling, fatigue, local failure, CFD, FEA, and certification are outside scope.

## Technologies

React, TypeScript, Next.js compatibility via Vinext, Vite, Zustand, Three.js / React Three Fiber, Zod, Vitest, Web Workers, WebMCP Site Tools, ChatGPT Sites, and a Cloudflare Worker runtime.

## Final-entry checks

- Confirm the live URL loads in a fresh logged-out session.
- Confirm exactly eight Site Tools in the supported ChatGPT/Chrome environment.
- Reconfirm the `aerociency-0.2.0` fixture on the frozen release.
- Confirm the repository platform recognizes the root MIT license.
- Confirm the video is public, audible, captioned, and strictly under 3:00.
- Remove all `PENDING_*` tokens.
- Do not include private eligibility or travel records.
