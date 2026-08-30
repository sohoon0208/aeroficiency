# Demo script — target 2:48

Record from the frozen release in one clean browser session. Use an English voiceover, burned-in or YouTube captions, no music, no notifications, and a cursor size that remains visible after compression. Never show private tabs, account details, file paths, eligibility records, or tool credentials.

## Before recording

1. Reset Aeroficiency and verify `Baseline r1`, no analysis, and the preliminary-model disclaimer.
2. Verify the frozen release reports solver `aeroficiency-0.6.0` and reconfirm the documented baseline/candidate fixture.
3. Open the supported WebMCP agent environment and confirm all ten tool names.
4. Set browser zoom and recording resolution so 11–12 px operational text is readable at normal YouTube playback.
5. Close unrelated applications and disable notifications.
6. Keep the final candidate recipe available only as rehearsal guidance, not pasted into a tool response.

Canonical task shown on screen:

> Inspect the current Baseline. Create a candidate that reduces modeled wing-box wall mass by at least 5% while maintaining all five configured trade-study checks and leaving the wake-induced-drag estimate no worse at the same target lift. Keep the chosen Baseline fixed for this comparison. Analyze each proposal and correct the candidate if the objective is not met. Inspect the final candidate’s root station, then compare the current immutable Baseline and candidate analyses. Treat numerically tiny drag changes as no meaningful improvement.

## Shot and narration plan

### 0:00–0:15 — Problem

**Screen:** Full Aeroficiency workspace, slow sweep across controls, 3D wing, and unavailable results.

**Voice:** “Preliminary wing design spans parameters, a 3D model, loads, structure, revisions, and warnings. A browser agent should not guess engineering state from pixels.”

### 0:15–0:34 — Shared model and WebMCP

**Screen:** Editable Baseline state, candidate-required comparison notice, Site Tools badge, constraints, and normal Run button; briefly reveal the ten registered tools.

**Voice:** “Aeroficiency gives the human a complete manual workspace and exposes ten structured Site Tools over that same live model. Every tool uses explicit revisions, bounded SI inputs, and the same domain commands as the UI.”

### 0:34–0:52 — Baseline

**Screen:** Copy and ask the exact canonical task from the header. Agent calls `get_design_state`, then `run_aeroelastic_analysis` for baseline standard fidelity. Show progress and current result.

**Voice:** “The agent first reads revision one and runs the chosen Baseline. The worker resolves each local airfoil and Reynolds-aware section polar, trims to target lift, and converges torsional feedback.”

### 0:52–1:31 — Candidate creation, first failure, and correction

**Screen:** Agent creates Candidate A, first tries `1.75 / 2.10 / 2.10 mm`, runs it, and sees 4/5 because the wall-mass objective is not met. It corrects to `1.65 / 2.00 / 2.00 mm` and reruns. Keep the fields, activity, run outcome, and retained immutable result state visible.

**Voice:** “It branches a candidate—keeping the chosen Baseline fixed for this comparison—and tests bounded gauges. The first proposal passes the other modeled checks but misses the five-percent wall-mass objective, so the agent corrects it and runs the same solver again.”

### 1:31–1:59 — Inspect and exact comparison

**Screen:** `inspect_span_station` focuses the final candidate root without moving keyboard focus. Then `compare_designs` pins the exact baseline/final-candidate analysis IDs; show five checks and the verdict.

**Voice (use only after the frozen-release fixture is reconfirmed):** “The committed result is immutable and fingerprinted. The candidate achieves a meaningful modeled wing-box wall-mass reduction while no meaningful improvement is claimed in the wake-induced-drag estimate. All five configured checks pass, but this remains a preliminary modeled trade study—not a flight-safety claim.”

### 1:59–2:25 — Human steer and conflict safety

**Screen:** Human changes span from 12.0 to 11.9 m. Show stale state. Invoke an update using the preceding revision; show conflict, then reread state.

**Voice:** “Now the human steers the design. Results immediately become stale. An agent write based on the old revision is rejected instead of overwriting the human. The response supplies the new revision and a safe next step.”

### 2:25–2:40 — Transparent model

**Screen:** Open Airfoils to show root/tip stations, then Model Scope. Briefly drag the precomputed AoA scrubber and cycle Geometry, Aero loads, 2D Section, Efficiency, and Structure; return to warnings and activity.

**Voice:** “User-positioned sections shape the loft, wing box, and local loading. Every sampled angle reruns the coupled model, and one scrubber links the committed 3D, efficiency, and 2D evidence. The 2D lab stays explicitly inviscid. Model Scope keeps every limit visible.”

### 2:40–2:49 — Close

**Screen:** Return to full workspace and Aeroficiency wordmark.

**Voice:** “Aeroficiency turns an agent from a fragile UI operator into a revision-safe engineering collaborator—while the human stays in control.”

## Recording acceptance

- Final duration between 2:35 and 2:50 and strictly below 3:00.
- Public YouTube visibility, working audio, English captions, and 1080p or better.
- Tool calls and resulting page changes are real and visible.
- The recorded solver version is `aeroficiency-0.6.0` and the fixture values were reconfirmed on that frozen release.
- No cut implies a failed or stale result is current.
- Baseline remains unchanged.
- The compared candidate ID is the final corrected analysis, never the first failed proposal.
- Logged-out playback works from the Devpost link.
