# Devpost field guide

This is the owner handoff for the OpenAI WebMCP Challenge entry. Use the prepared long-form answers in `docs/SUBMISSION_COPY.md`; do not improvise technical claims during final form entry.

## Project profile

| Field | Prepared value |
|---|---|
| Project name | Aeroficiency |
| Tagline | Explainable wing trade studies for humans and agents, powered by one revision-safe engineering model. |
| License | MIT |
| Thumbnail | `submission/devpost-thumbnail.png` (3:2, below 5 MB) |
| Live app | `https://aeroficiency.larerraven.chatgpt.site` |
| Source repository | `PENDING_PUBLIC_REPOSITORY_URL` |
| Demo video | `PENDING_PUBLIC_YOUTUBE_URL` |

Recommended “built with” tags: `WebMCP`, `OpenAI`, `TypeScript`, `React`, `Three.js`, `Zustand`, `Zod`, `Vite`, `Vinext`, `Cloudflare Workers`, `Web Workers`, `Vitest`.

## Story

Copy the four prepared sections from `docs/SUBMISSION_COPY.md` in this order:

1. Why is this a strong WebMCP use case?
2. How does WebMCP improve the user experience?
3. What can humans and agents do together now?
4. How did you implement WebMCP?

Keep the short description at the beginning and the model-limit paragraph intact. Do not describe the 2D Section Flow Lab as CFD, the structural model as high-fidelity FEA, or any drag metric as whole-aircraft drag.

## Gallery and video

Use only captures from the exact public release commit:

1. full workspace with Aeroficiency branding and tool-ready state;
2. Airfoils editor showing root and tip sections at user-set span locations;
3. 2D Section Flow Lab with the inviscid limitation visible;
4. exact Baseline/candidate comparison with all five configured checks;
5. activity log showing human and agent actions.

Record the public live origin using `docs/DEMO_SCRIPT.md`. Keep the final YouTube video public, audible, captioned, and strictly below three minutes. Do not show private account details, notifications, local paths, or unrelated applications.

## Final form gate

Before submission:

- replace every `PENDING_*` token with a logged-out verified public URL;
- confirm the repository platform recognizes the root MIT license;
- verify the live site works without an account and exposes exactly ten Site Tools in the supported environment;
- verify the public video plays while logged out;
- complete the entrant and eligibility attestations personally;
- save the submitted URL, confirmation, release commit, deployment ID, and video duration privately.

The final **Submit** action is intentionally owner-controlled.
