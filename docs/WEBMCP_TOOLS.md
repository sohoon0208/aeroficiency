# WebMCP Site Tools

For solver version `aerociency-0.2.0`, Aerociency defines exactly eight page-scoped tools—four read-only and four write—in `webmcp/tools.ts`. `webmcp/registerSiteTools.ts` attempts imperative WebMCP registration when the API is available. Final runtime discovery in the supported environment remains pending.

When `document.modelContext.registerTool` is unavailable, registration is skipped and the manual workspace continues to work. Each awaited registration receives one lifecycle `AbortSignal`; React cleanup or partial failure aborts the batch so a remount cannot leave duplicate page tools behind.

## Shared-state contract

Manual controls and Site Tool writes both call the Zustand action layer, which delegates to the same pure domain commands. A successful tool mutation therefore changes the 3D view, fields, revisions, freshness, results, and activity timeline that the human sees.

All tool inputs are treated as untrusted:

- JSON schemas reject additional properties.
- Zod repeats runtime validation.
- The domain layer revalidates complete model invariants.
- Writes name an explicit expected revision.
- Writes use a UUID idempotency key.
- Candidate labels are length-bounded and control characters are rejected.
- Tool outputs are compact projections rather than raw project dumps.

## Tool inventory

### `get_design_state`

Read-only. Returns designs, explicit revisions, source lineage, bounded geometry and structure, analysis freshness, the target-lift case, constraints, solver version, and three recent activity items.

Input: `{}`

### `get_analysis_summary`

Read-only. Returns convergence, core metrics, constraint states, root/minimum-margin/tip critical stations, up to four warnings, revisions, fingerprint, fidelity, and whether one immutable analysis is current.

Input: `{ analysisId }`

### `inspect_span_station`

Read-only. Resolves normalized right-semispan `eta` in `[0,1]` to the nearest solver station and returns its full structural/aerodynamic values plus currentness.

Input: `{ analysisId, eta }`

### `create_candidate_variant`

Write. Branches an editable candidate from one explicit design revision. It never edits the source; the workspace permits at most six total designs.

Input: `{ sourceDesignId, expectedSourceDesignRevision, candidateLabel, idempotencyKey }`

### `update_wing_geometry`

Write. Applies one or more absolute candidate values from the allowlist: `spanM`, `rootChordM`, `tipChordM`, `tipTwistDeg`, or `nacaCode`. Cross-field taper/aspect-ratio rules are checked after the patch.

Input: `{ designId, expectedDesignRevision, idempotencyKey, patch }`

### `update_wing_structure`

Write. Applies absolute `skinThicknessMm`, `frontWebThicknessMm`, `rearWebThicknessMm`, or `elasticAxisXOverC` values. Spar locations and material remain fixed in the challenge model.

Input: `{ designId, expectedDesignRevision, idempotencyKey, patch }`

### `run_aeroelastic_analysis`

Write. Starts a cancellable worker solve against explicit design, flight-case, and constraint revisions. Only one analysis may run for the project at a time. A converged validated snapshot is committed as current. A validated non-converged snapshot may be retained and selected for diagnostics, but the tool returns `ANALYSIS_DID_NOT_CONVERGE`, its constraints remain unavailable, and it does not replace the last current converged result. Aborted, failed, stale-revision, or fingerprint-mismatched work does not commit.

Input: `{ designId, expectedDesignRevision, expectedFlightCaseRevision, expectedConstraintsRevision, idempotencyKey, fidelity }`

Fidelity is `fast` (16 full-span panels) or `standard` (32 full-span panels).

### `compare_designs`

Read-only. Compares two distinct, explicit, current, converged immutable analysis IDs only when their flight-case revision, fidelity, and solver version match. It never launches the solver and rejects stale, identical, missing, or incompatible results.

Input: `{ referenceAnalysisId, candidateAnalysisId }`

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
      "designRevision": 3,
      "flightCaseRevision": 1,
      "constraintsRevision": 1
    }
  }
}
```

The agent should read state again, preserve any human changes, and retry with a new UUID. It must not guess a revision, reuse a UUID for a different payload, mutate the baseline, compare stale results, or describe an unsupported analysis as though a tool existed.

## Security annotations

Every tool declares accurate read-only intent, `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false`, and `untrustedContentHint: true`. The annotations are planning signals; domain authorization and validation remain authoritative.

References: [OpenAI Site Tools documentation](https://learn.chatgpt.com/docs/webmcp), [Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api), and [secure tools guidance](https://developer.chrome.com/docs/ai/webmcp/secure-tools).
