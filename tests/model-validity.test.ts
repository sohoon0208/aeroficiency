import { describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot, createCandidateVariant } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { DESIGN_LIMITS, SOLVER_SETTINGS } from '@/lib/domain/limits';
import { compactModelValidity, completeModelValidity, MODEL_METHOD, MODEL_OMISSION_CODES, MODEL_VALIDITY_STATUS, SUMMARY_MODEL_ASSUMPTION_CODES, SUMMARY_MODEL_OMISSION_CODES, WAKE_MODEL } from '@/lib/domain/modelValidity';
import type { ProjectState, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function commit(state: ProjectState, design: WingDesign, idempotencyKey = createIdempotencyKey()) {
  const request = {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedProjectRevision: state.projectRevision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey,
    fidelity: 'standard' as const,
  };
  const snapshot = buildAnalysisSnapshot(state, design, 'standard');
  const transition = commitAnalysisSnapshot(state, request, snapshot, 'solver');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return { state: transition.state, snapshot, request };
}

describe('structured model-validity contract', () => {
  it('derives method, wake, bounds, trim, assumptions, and complete omissions from canonical constants', () => {
    const compact = compactModelValidity();
    const complete = completeModelValidity();
    expect(compact).toEqual({ status: MODEL_VALIDITY_STATUS, method: MODEL_METHOD, wakeModel: WAKE_MODEL, omissions: MODEL_OMISSION_CODES });
    expect(complete.supportedBounds.spanM).toBe(DESIGN_LIMITS.spanM);
    expect(complete.supportedBounds.requiredCl).toBe(SOLVER_SETTINGS.requiredTargetCl);
    expect(complete.supportedBounds.maxAbsTwistDeg).toBe(SOLVER_SETTINGS.maxElasticTwistDeg);
    expect(complete.supportedBounds.maxTipDeflectionToSemispan).toBe(SOLVER_SETTINGS.maxTipDeflectionSemispanFraction);
    expect(complete.trimAlphaBracketDeg).toBe(SOLVER_SETTINGS.alphaBracketDeg);
    expect(complete.assumptions).toEqual(SUMMARY_MODEL_ASSUMPTION_CODES);
    expect(complete.assumptions).toContain('TORSION_COUPLED_BENDING_ONE_WAY');
    expect(complete.omissions).toEqual(SUMMARY_MODEL_OMISSION_CODES);
    expect(complete.assumptions).toContain('REYNOLDS_PROFILE_DRAG_SECTION_MOMENT');
    expect(complete.omissions).toContain('FULL_AIRCRAFT_DRAG_UNMODELED');
    expect(complete.omissions).toContain('COMPRESSIBILITY_TRANSONIC_FREE_WAKE');
    expect(complete.omissions).toContain('BENDING_FEEDBACK_WEIGHT_INERTIA');
    expect(complete.omissions).toContain('DIVERGENCE_FLUTTER_DYNAMICS');
    expect(complete.omissions).toContain('BUCKLING_FATIGUE_LOCAL_FAILURE');
    expect(MODEL_OMISSION_CODES).toContain('JOINTS_FASTENERS_MANUFACTURING_AND_CERTIFICATION_LOAD_CASES');
  });

  it('places validity payloads only where the bounded tool contract requires them', async () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const baselineRun = commit(state, baseline);
    state = baselineRun.state;
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Validity candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    state = branch.state;
    const candidateRun = commit(state, state.designs[branch.result.data.designId]);
    state = candidateRun.state;
    useProjectStore.setState({ project: state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });

    const runResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(baselineRun.request) as { ok: true; data: { modelValidity: unknown } };
    expect(runResult.data.modelValidity).toEqual(compactModelValidity());

    const summary = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: baselineRun.snapshot.analysisId }) as { ok: true; data: { modelValidity: unknown } };
    expect(summary.data.modelValidity).toEqual(completeModelValidity());

    const station = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: candidateRun.snapshot.analysisId, eta: 0 }) as { ok: true; data: { modelValidity: unknown } };
    expect(station.data.modelValidity).toEqual({ status: MODEL_VALIDITY_STATUS });

    const comparison = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({ referenceAnalysisId: baselineRun.snapshot.analysisId, candidateAnalysisId: candidateRun.snapshot.analysisId }) as { ok: true; data: { compatibility: { compatible: boolean }; reference: { analysisId: string }; candidate: { analysisId: string } } };
    expect(comparison.data.compatibility.compatible).toBe(true);
    expect(comparison.data.reference.analysisId).toBe(baselineRun.snapshot.analysisId);
    expect(comparison.data.candidate.analysisId).toBe(candidateRun.snapshot.analysisId);

    const mutation = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'create_candidate_variant')!.execute({
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'No duplicated validity',
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: true; data: Record<string, unknown> };
    expect(mutation.ok).toBe(true);
    expect(mutation.data).not.toHaveProperty('modelValidity');
  });
});
