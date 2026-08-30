# WebMCP Site Tools

Aeroficiency tool schema `aeroficiency-webmcp-1.3` defines exactly nine page-scoped tools in `webmcp/tools.ts`: two pure reads, two presentation actions, and five engineering writes. `webmcp/registerSiteTools.ts` feature-detects and registers them through `document.modelContext.registerTool`. If the API is unavailable, the complete manual workspace remains usable.

Each registration batch shares one lifecycle abort signal. Cleanup or partial registration failure aborts the batch so a remount cannot leave duplicate tools.

## Shared-state and trust contract

Human controls and engineering tools call the same Zustand action layer and pure domain commands. Successful engineering writes therefore update the fields, revisions, freshness, results, 3D view, plots, and actor-tagged activity visible to the human. Geometry or structure writes automatically open the affected editor and the mobile Design view, mark the changed fields with an Agent chip, and preserve `document.activeElement`. If a successful worker result commits after the human has selected another design, a polite global notice identifies the background target design and committed analysis without changing selection.

Presentation actions are deliberately different: they update only transient visible focus. They never increment `projectRevision`, change a design, create or invalidate an analysis, touch the idempotency ledger, launch the solver, or add engineering activity.

All inputs are untrusted:

- JSON schemas reject additional properties.
- Zod repeats runtime validation.
- Domain commands revalidate complete model invariants.
- Engineering writes name explicit expected revisions.
- Idempotent engineering writes require UUID keys.
- Candidate labels are bounded and reject control characters.
- Design and analysis IDs use an exact 30-character prefixed form in both advertised JSON Schema and runtime validation.
- Geometry and structure patches must contain at least one allowlisted field; advertised and runtime schemas enforce the same rule.
- Results are compact public DTOs rather than raw project dumps.

## Inventory

| Tool | Class | Contract |
|---|---|---|
| `get_design_state` | Pure read | One full compact design: active by default, or an explicitly requested design while retaining the active identity; compact summaries for all designs; revisions, airfoil/polar metadata, freshness, case, checks, model status, and two recent activities |
| `get_analysis_summary` | Pure read | One immutable V5 analysis with mass, induced/profile/combined drag, wing L/D, currentness, convergence, checks, one yield-critical station, and compact model validity |
| `inspect_span_station` | Presentation | Resolve `eta` to a station of one current converged analysis and visibly focus that exact evidence |
| `compare_designs` | Presentation | Validate and visibly pin one exact current baseline/candidate analysis pair without rerunning |
| `create_candidate_variant` | Engineering write | Idempotently branch an editable candidate from an explicit source revision |
| `set_baseline_design` | Engineering write | Make one candidate the editable Baseline reference while retaining the former Baseline as a candidate |
| `update_wing_geometry` | Engineering write | Apply bounded absolute planform, legacy uniform-NACA, full airfoil-station, or SectionPolar values to any design at an explicit revision |
| `update_wing_structure` | Engineering write | Apply bounded absolute wall gauges or elastic-axis location to any design |
| `run_aeroelastic_analysis` | Engineering write | Run and commit one revision-checked low-order target-lift, torsion-coupled static analysis |

### Presentation action rules

`inspect_span_station` accepts `{ analysisId, eta }`, where `eta` is in `[0,1]`. It rejects missing, stale, or non-converged results before changing focus. Success selects the requested immutable analysis and nearest resolved solver station, exposes `visualFocusApplied: true`, scrolls the evidence into view without stealing keyboard focus, and reports only minimal validity status.

`compare_designs` accepts `{ referenceAnalysisId, candidateAnalysisId }`. It requires distinct, current, converged analyses; the current Baseline reference; a candidate; and equal flight-case revision, configured-check revision, fidelity, and solver version. Success pins exactly those ordered IDs, exposes compatibility and `visualFocusApplied: true`, and never substitutes a newer pair silently. A later stale request is rejected without replacing the prior exact pin.

### Engineering write rules

Candidate creation accepts `{ sourceDesignId, expectedProjectRevision, expectedSourceDesignRevision, candidateLabel, idempotencyKey }`. Baseline-role changes accept `{ designId, expectedProjectRevision, expectedDesignRevision, idempotencyKey }`; the target must be a candidate, the former Baseline remains available as a candidate, both role-changing designs advance one revision, and dependent analyses become stale. Geometry and structure updates accept `{ designId, expectedDesignRevision, idempotencyKey, patch }` for either role. The geometry patch may contain scalar planform fields, `nacaCode` for a uniform compatibility update, a complete ordered `airfoilStations` array, or a complete `polarModel`. Partial nested station/polar edits are deliberately not accepted: the trust boundary validates one coherent replacement. Analysis accepts `{ designId, expectedProjectRevision, expectedDesignRevision, expectedFlightCaseRevision, expectedConstraintsRevision, idempotencyKey, fidelity }`, where fidelity is `fast` or `standard`.

Airfoil payloads are bounded to two–six root-to-tip stations and NACA4 or 24–161 coordinate points. User SectionPolar payloads are bounded to 18 tables and 61 rows per table with explicit station IDs, Reynolds/Mach metadata, and provenance. JSON Schema, Zod parsing, domain validation, snapshot reconstruction, and worker commit validation all enforce the same invariants.

Only one project analysis runs at a time. A converged validated snapshot can become current. A validated non-converged snapshot may be retained for diagnostics, but returns `ANALYSIS_DID_NOT_CONVERGE`, keeps checks unavailable, and does not displace a prior current converged result. Failed, aborted, stale, or fingerprint-mismatched work cannot commit.

An identical UUID/request pair replays the original result without adding a design revision, analysis, idempotency record, or engineering activity while the bounded idempotency record is retained. The page announces that replay as a polite, globally visible “no duplicate write” event, including when another design is selected or an unrelated run is active. If an old key has been evicted from the bounded ledger, an update fails its stale expected design revision, while creation and analysis fail their stale expected project/design revisions; none can silently duplicate work.

Candidate and update replays include `replayState: { designRetained, returnedRevision, currentDesignRevision, returnedRevisionIsCurrent }`, so a retained historical result cannot be mistaken for the latest design. Analysis replays include `snapshotRetention: { retained, inspectable, current, currentReplacementAnalysisId }`. The replacement ID is populated whenever the original is no longer current and a current replacement exists, including when the original snapshot is still retained. If no current replacement exists, recovery calls for a current-revision run before station inspection or comparison; it never instructs the agent to inspect missing or stale evidence.

## Public vocabulary and validity placement

Public DTOs use:

- modeled wing-box wall mass
- wake-induced-drag estimate
- profile-drag estimate from the active SectionPolar source
- combined wing-drag estimate and estimated wing lift-to-drag ratio
- modeled yield ratio, `σy / max(σVM)`
- low-order Reynolds/polar-aware target-lift, torsion-coupled static analysis

Validity information is intentionally tiered:

- design state: preliminary status and method
- analysis run: status, method, wake model, and omission codes
- analysis summary: headline supported bounds, trim bracket, and compact assumption/omission categories alongside the decision metrics
- station focus: preliminary status only, tied to an exact analysis ID
- comparison: exact IDs and compatibility metadata
- ordinary mutations: no duplicated validity payload

Analysis-summary freshness is also compact and structured. Current results return `{ state: "current" }`; historical results name `useAnalysisId` when a current replacement exists, otherwise they return a bounded `requiredAction` code. Current, stale, replacement, and non-converged variants are all covered by the same frozen output budget.

Full supported bounds and coupled model rules remain sourced from shared constants and are enforced and disclosed through validation, the UI Model Scope, schemas, and this documentation. The analysis summary intentionally avoids duplicating that entire contract: it carries span, required-CL, maximum-twist, and maximum-tip-deflection headline bounds; the trim bracket; and compact but complete assumption/omission categories for summary decisions.

All nine success and validation-error envelopes have deterministic UTF-8 byte ceilings in `tests/tool-output-bounds.test.ts`; maximum bounded project state cannot leak raw histories, imported coordinate arrays, polar rows, or full station results through summary tools. When a non-active design is explicitly inspected, the payload returns that design's full compact detail and only the active design's identity, avoiding duplicate maximum-size geometry while preserving the current selection. Frozen success ceilings are 5,000 bytes for `get_design_state`, **1,500 bytes for `get_analysis_summary`**, 1,500 for station focus, 1,000 for candidate creation, 1,500 for Baseline-role changes, 1,500 for each update, 3,000 for analysis, and 2,500 for comparison. Every runtime result also passes an absolute 6,000-byte egress guard. Tests include multibyte labels, maximum project cardinality, maximum V5 station/polar metadata, and current/stale/replacement/non-converged summary variants.

## Errors and recovery

Failures use a stable envelope:

```json
{
  "ok": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "…",
    "retryable": true,
    "safeNextAction": "…",
    "current": {
      "projectRevision": 7,
      "designRevision": 3,
      "flightCaseRevision": 1,
      "constraintsRevision": 1
    }
  }
}
```

The agent should reread state, preserve human changes, and retry with a new UUID. It must not guess revisions, reuse a UUID for a different request, silently replace the chosen Baseline, compare stale results, or imply unsupported physics.

Worker, browser, parser, and adapter exception text is treated as untrusted. Public failures use fixed bounded categories such as `MODEL_RANGE_EXCEEDED`, `TARGET_LIFT_UNBRACKETED`, `VLM_SINGULAR`, `NUMERICAL_FAILURE`, `TOOL_EXECUTION_EXCEPTION`, and `TOOL_OUTPUT_LIMIT`; raw stack traces, thrown messages, control characters, and injected adapter fields are discarded. At most six bounded validation issues may be returned.

When stale evidence has an existing current replacement, recovery may name it. Comparison recovery claims that no rerun is needed only when both replacements exist and still match role, flight-case revision, configured-check revision, fidelity, and solver version. Otherwise it identifies the explicit next analysis needed instead of silently substituting evidence.

## Portable annotations

Every definition emits only the portable annotation keys used by this release:

- `readOnlyHint: true` only for `get_design_state` and `get_analysis_summary`
- `readOnlyHint: false` for both presentation actions and all five engineering writes
- `untrustedContentHint: true` for all tools because project-derived labels and strings can enter results

These are planning hints, not authorization. Domain validation remains authoritative.

References: [OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), and [secure tools guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools).
