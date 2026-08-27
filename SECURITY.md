# Security policy

## Scope

Aerociency is a client-side preliminary-design application. It has no login, database, application API, uploaded files, computational service, or embedded OpenAI API key. Project state and solver work remain in the current browser page.

## Implemented controls

- Strict Zod and domain validation with finite numerical bounds.
- Allowlisted candidate-only writes; the baseline is protected below the UI.
- Explicit optimistic revisions on every Site Tool write.
- UUID idempotency keys and SHA-256 canonical request fingerprints.
- Immutable analysis IDs, physics fingerprints, and commit-time snapshot validation.
- Worker completion checks that reject stale design, flight-case, constraint, or solver state.
- Abort-aware analysis execution and bounded designs, analyses, activity, and idempotency records.
- Strict tool schemas with `additionalProperties: false`, closed-world annotations, and bounded outputs.
- WebMCP feature detection; the normal UI remains available when Site Tools are absent.
- First-party assets and no runtime third-party requests.
- A production-oriented CSP, `Origin-Agent-Cluster: ?1`, `Permissions-Policy`, referrer policy, and `nosniff` configured in both Next and static-host formats.
- CI lint, type, test, build, and production-dependency audit gates.

## Deployment caveat

`public/_headers` is provided for hosts that consume Cloudflare-style static header files, and `next.config.ts` supplies equivalent framework headers. Aerociency's current ChatGPT Sites/Vinext target is worker-rendered, so the actual public response—not these files—is the authority. The release must remain private until the live origin is checked for all intended headers and WebMCP compatibility.

The CSP allows the minimum inline script/style behavior currently required by the Next/Vinext runtime and local component styles. Tightening those directives requires a production nonce/hash strategy and a complete browser regression test.

## Reporting a vulnerability

No public security contact is configured before repository publication. Once the repository is public, enable the hosting platform's private vulnerability-reporting feature and replace this section with the verified reporting URL. Do not disclose a vulnerability publicly before a fix is available.

## Supported release

Only the frozen challenge release identified in the eventual public repository and submission is supported. Aerociency is not safety-critical software and must not be used to make flight-safety or certification decisions.
