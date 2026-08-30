import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createEntityId, createIdempotencyKey } from '@/lib/domain/ids';
import { MAX_ANALYSES } from '@/lib/domain/limits';
import type { ProjectState, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { registerAeroficiencySiteTools } from '@/webmcp/registerSiteTools';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

describe('bounded Aeroficiency Site Tools surface', () => {
  beforeEach(() => useProjectStore.setState({ project: createDefaultProject(), analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus(), mutationHighlight: null, commandNotice: null }));
  afterEach(() => vi.unstubAllGlobals());

  it('registers exactly the intended nine distinctive tools', () => {
    expect(AEROFICIENCY_TOOLS.map((tool) => tool.name)).toEqual([
      'get_design_state', 'get_analysis_summary', 'inspect_span_station', 'create_candidate_variant',
      'set_baseline_design', 'update_wing_geometry', 'update_wing_structure', 'run_aeroelastic_analysis', 'compare_designs',
    ]);
    expect(AEROFICIENCY_TOOLS.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(new Set(AEROFICIENCY_TOOLS.map((tool) => tool.description)).size).toBe(9);
    expect(AEROFICIENCY_TOOLS.map((tool) => Object.keys(tool.annotations).sort())).toEqual(Array.from({ length: 9 }, () => ['readOnlyHint', 'untrustedContentHint']));
    expect(AEROFICIENCY_TOOLS.filter((tool) => tool.annotations.readOnlyHint).map((tool) => tool.name)).toEqual(['get_design_state', 'get_analysis_summary']);
  });

  it('keeps advertised JSON schemas in parity with runtime label and non-empty-patch validation', async () => {
    const createTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'create_candidate_variant')!;
    const geometryTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'update_wing_geometry')!;
    const structureTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'update_wing_structure')!;
    const createProperties = createTool.inputSchema.properties as Record<string, Record<string, unknown>>;
    const geometryProperties = geometryTool.inputSchema.properties as Record<string, Record<string, unknown>>;
    const structureProperties = structureTool.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(createProperties.candidateLabel.pattern).toBe('^(?=.*\\S)[^\\u0000-\\u001F\\u007F]{1,48}$');
    expect(createTool.inputSchema.required).toContain('expectedProjectRevision');
    expect(AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.inputSchema.required).toContain('expectedProjectRevision');
    const designStateProperties = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.inputSchema.properties as Record<string, Record<string, unknown>>;
    expect(designStateProperties.designId).toMatchObject({ minLength: 30, maxLength: 30 });
    expect(geometryProperties.patch.minProperties).toBe(1);
    expect(structureProperties.patch.minProperties).toBe(1);

    const state = useProjectStore.getState().project;
    const baseline = state.designs[state.activeDesignId];
    for (const candidateLabel of ['   ', `Visible${String.fromCharCode(10)}control`, `${'A'.repeat(48)} `]) {
      const result = await createTool.execute({
        sourceDesignId: baseline.designId,
        expectedProjectRevision: state.projectRevision,
        expectedSourceDesignRevision: baseline.revision,
        candidateLabel,
        idempotencyKey: createIdempotencyKey(),
      }) as DomainFailureResult;
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
    const oversizedId = `des_${'A'.repeat(10_000)}`;
    const oversizedRead = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({ designId: oversizedId }) as DomainFailureResult;
    expect(oversizedRead.ok).toBe(false);
    expect(oversizedRead.error.code).toBe('VALIDATION_ERROR');
    for (const tool of [geometryTool, structureTool]) {
      const result = await tool.execute({
        designId: baseline.designId,
        expectedDesignRevision: baseline.revision,
        idempotencyKey: createIdempotencyKey(),
        patch: {},
      }) as DomainFailureResult;
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('exposes explicit revisions and rejects unknown write fields', async () => {
    const stateTool = AEROFICIENCY_TOOLS[0];
    const stateResult = await stateTool.execute({}) as { ok: true; data: { designs: Array<{ revision: number }>; configuredChecks: Record<string, unknown> } };
    expect(stateResult.ok).toBe(true);
    expect(stateResult.data.designs[0].revision).toBe(1);
    expect(stateResult.data.configuredChecks).toEqual({
      revision: 1,
      minimumModeledWingBoxWallMassReductionPct: 5,
      minimumModeledYieldRatio: 1.5,
      maximumTipDeflectionM: 0.6,
      maximumWakeInducedDragEstimateIncreasePct: 0,
      requiredStaticAnalysisConvergence: true,
    });
    expect(stateResult.data).not.toHaveProperty('constraints');
    const updateTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'update_wing_geometry')!;
    const invalid = await updateTool.execute({ designId: 'des_00000000000000000000000001', expectedDesignRevision: 1, idempotencyKey: crypto.randomUUID(), patch: { evil: 1 } }) as DomainResult;
    expect(invalid.ok).toBe(false);
  });

  it('lets the agent promote a candidate to the editable Baseline without deleting the previous reference', async () => {
    let state = useProjectStore.getState().project;
    const baseline = state.designs[state.activeDesignId];
    const created = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'create_candidate_variant')!.execute({
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'New reference candidate',
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: true; data: { designId: typeof baseline.designId; revision: number } };
    expect(created.ok).toBe(true);
    state = useProjectStore.getState().project;

    const promoted = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'set_baseline_design')!.execute({
      designId: created.data.designId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: state.designs[created.data.designId].revision,
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: true; data: { baselineDesignId: typeof baseline.designId; previousBaselineDesignId: typeof baseline.designId } };
    expect(promoted.ok).toBe(true);
    expect(promoted.data).toMatchObject({ baselineDesignId: created.data.designId, previousBaselineDesignId: baseline.designId });
    state = useProjectStore.getState().project;
    expect(Object.values(state.designs).filter((design) => design.kind === 'baseline')).toHaveLength(1);
    expect(state.designs[created.data.designId].kind).toBe('baseline');
    expect(state.designs[baseline.designId].kind).toBe('candidate');
    expect(state.designs).toHaveProperty(created.data.designId);
    expect(state.designs).toHaveProperty(baseline.designId);
    expect(useProjectStore.getState().commandNotice).toMatchObject({ kind: 'success', code: 'BASELINE_CHANGED' });
  });

  it('rejects invalid enums, nonfinite numbers, and out-of-range values while allowing Baseline writes', async () => {
    const state = useProjectStore.getState().project;
    const baseline = state.designs[state.activeDesignId];
    const runTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!;
    const invalidFidelity = await runTool.execute({
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      expectedProjectRevision: state.projectRevision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'ultra',
    }) as DomainFailureResult;
    expect(invalidFidelity.ok).toBe(false);
    expect(invalidFidelity.error.code).toBe('VALIDATION_ERROR');

    const geometryTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'update_wing_geometry')!;
    for (const patch of [{ spanM: Number.NaN }, { spanM: 100 }, { tipTwistDeg: Number.POSITIVE_INFINITY }]) {
      const invalid = await geometryTool.execute({ designId: baseline.designId, expectedDesignRevision: 1, idempotencyKey: createIdempotencyKey(), patch }) as DomainFailureResult;
      expect(invalid.ok).toBe(false);
      expect(invalid.error.code).toBe('VALIDATION_ERROR');
    }
    const baselineWrite = await geometryTool.execute({
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -1.5 },
    }) as { ok: true; data: { newDesignRevision: number } };
    expect(baselineWrite.ok).toBe(true);
    expect(baselineWrite.data.newDesignRevision).toBe(baseline.revision + 1);
    expect(useProjectStore.getState().project.designs[baseline.designId]).toMatchObject({ kind: 'baseline', revision: baseline.revision + 1, geometry: { tipTwistDeg: -1.5 } });
  });

  it('keeps read results within bounded context budgets', async () => {
    const initial = useProjectStore.getState().project;
    const design = initial.designs[initial.activeDesignId];
    const snapshot = buildAnalysisSnapshot(initial, design, 'standard');
    const transition = commitAnalysisSnapshot(initial, {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedProjectRevision: initial.projectRevision,
      expectedFlightCaseRevision: initial.flightCase.revision,
      expectedConstraintsRevision: initial.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, snapshot, 'solver');
    expect(transition.result.ok).toBe(true);
    useProjectStore.setState({ project: transition.state });

    const stateResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({});
    const summaryResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: snapshot.analysisId });
    const stationResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: snapshot.analysisId, eta: 0.5 });
    expect(JSON.stringify(stateResult).length).toBeLessThan(20_000);
    expect(JSON.stringify(summaryResult).length).toBeLessThan(20_000);
    expect(JSON.stringify(stationResult).length).toBeLessThan(10_000);
  });

  it('isolates every nested read result from live project state', async () => {
    const initial = useProjectStore.getState().project;
    const design = initial.designs[initial.activeDesignId];
    const snapshot = buildAnalysisSnapshot(initial, design, 'standard');
    const transition = commitAnalysisSnapshot(initial, {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedProjectRevision: initial.projectRevision,
      expectedFlightCaseRevision: initial.flightCase.revision,
      expectedConstraintsRevision: initial.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, snapshot, 'solver');
    expect(transition.result.ok).toBe(true);
    useProjectStore.setState({ project: transition.state });
    const authoritative = structuredClone(transition.state);

    const stateResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({}) as {
      data: {
        activeDesign: { geometry: { spanM: number }; structure: { skinThicknessMm: number } };
        flightCase: { velocityMps: number };
        configuredChecks: { minimumModeledYieldRatio: number };
      };
    };
    stateResult.data.activeDesign.geometry.spanM = -123;
    stateResult.data.activeDesign.structure.skinThicknessMm = -1;
    stateResult.data.flightCase.velocityMps = -1;
    stateResult.data.configuredChecks.minimumModeledYieldRatio = -1;

    const summaryResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: snapshot.analysisId }) as {
      data: { convergence: { iterations: number }; criticalStations: Array<Record<string, unknown>> };
    };
    expect(summaryResult.data.criticalStations[0]).toHaveProperty('modeledYieldRatio');
    expect(summaryResult.data.criticalStations[0]).not.toHaveProperty('yieldMargin');
    summaryResult.data.convergence.iterations = -1;

    const stationResult = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: snapshot.analysisId, eta: 0.5 }) as {
      data: { station: { deflectionM: number } };
    };
    stationResult.data.station.deflectionM = 999;

    expect(useProjectStore.getState().project).toEqual(authoritative);
    const reread = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({}) as {
      data: { activeDesign: { geometry: { spanM: number } }; flightCase: { velocityMps: number } };
    };
    expect(reread.data.activeDesign.geometry.spanM).toBe(design.geometry.spanM);
    expect(reread.data.flightCase.velocityMps).toBe(initial.flightCase.velocityMps);
  });

  it('replays a bounded run DTO even after the original immutable snapshot is pruned', async () => {
    let state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const template = buildAnalysisSnapshot(state, design, 'fast');
    let firstRequest: {
      designId: typeof design.designId;
      expectedDesignRevision: number;
      expectedProjectRevision: number;
      expectedFlightCaseRevision: number;
      expectedConstraintsRevision: number;
      idempotencyKey: string;
      fidelity: 'fast';
    } | null = null;
    let firstAnalysisId = template.analysisId;

    for (let index = 0; index <= MAX_ANALYSES; index += 1) {
      const request = {
        designId: design.designId,
        expectedDesignRevision: design.revision,
        expectedProjectRevision: state.projectRevision,
        expectedFlightCaseRevision: state.flightCase.revision,
        expectedConstraintsRevision: state.constraints.revision,
        idempotencyKey: createIdempotencyKey(),
        fidelity: 'fast' as const,
      };
      const snapshot = structuredClone(template);
      snapshot.analysisId = createEntityId('ana');
      const transition = commitAnalysisSnapshot(state, request, snapshot, 'solver');
      expect(transition.result.ok).toBe(true);
      if (index === 0) {
        firstRequest = request;
        firstAnalysisId = snapshot.analysisId;
      }
      state = transition.state;
    }

    expect(Object.keys(state.analyses)).toHaveLength(MAX_ANALYSES);
    expect(state.analyses[firstAnalysisId]).toBeUndefined();
    useProjectStore.setState({ project: state, analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus() });
    const replay = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(firstRequest) as {
      ok: true;
      replayed: boolean;
      data: {
        analysisId: string;
        checkSummary: { applicable: number; passed: number; unavailable: number; allApplicableSatisfied: boolean };
        snapshotRetention: { retained: boolean; inspectable: boolean; current: boolean; currentReplacementAnalysisId: string | null };
      };
    };
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(replay.data.analysisId).toBe(firstAnalysisId);
    expect(replay.data.checkSummary).toMatchObject({ applicable: 3, passed: 3, unavailable: 2, allApplicableSatisfied: true });
    expect(replay.data.snapshotRetention).toEqual({
      retained: false,
      inspectable: false,
      current: false,
      currentReplacementAnalysisId: state.designs[design.designId].latestAnalysisId,
    });
    expect(useProjectStore.getState().commandNotice?.message).toMatch(/snapshot was already pruned/i);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toContain(state.designs[design.designId].latestAnalysisId);
  });

  it('reports whether retained replay revisions and snapshots are still current', async () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const createInput = {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Replay truth candidate',
      idempotencyKey: createIdempotencyKey(),
    };
    const createTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'create_candidate_variant')!;
    const created = await createTool.execute(createInput) as { ok: true; data: { designId: typeof baseline.designId; revision: number } };
    expect(created.ok).toBe(true);
    const candidateId = created.data.designId;
    state = useProjectStore.getState().project;
    const firstUpdateInput = {
      designId: candidateId,
      expectedDesignRevision: state.designs[candidateId].revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7 },
    };
    const updateTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'update_wing_structure')!;
    const firstUpdate = await updateTool.execute(firstUpdateInput) as { ok: true; data: { newDesignRevision: number } };
    expect(firstUpdate.ok).toBe(true);
    const secondUpdate = await updateTool.execute({
      designId: candidateId,
      expectedDesignRevision: firstUpdate.data.newDesignRevision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.71 },
    }) as { ok: true };
    expect(secondUpdate.ok).toBe(true);

    const createReplay = await createTool.execute(createInput) as {
      ok: true;
      replayed: true;
      data: { replayState: { designRetained: boolean; returnedRevision: number; currentDesignRevision: number; returnedRevisionIsCurrent: boolean } };
    };
    expect(createReplay.data.replayState).toEqual({
      designRetained: true,
      returnedRevision: 1,
      currentDesignRevision: 3,
      returnedRevisionIsCurrent: false,
    });
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toMatch(/historical revision 1.*current revision is 3/i);

    const updateReplay = await updateTool.execute(firstUpdateInput) as {
      ok: true;
      replayed: true;
      data: { replayState: { designRetained: boolean; returnedRevision: number; currentDesignRevision: number; returnedRevisionIsCurrent: boolean } };
    };
    expect(updateReplay.data.replayState).toEqual({
      designRetained: true,
      returnedRevision: 2,
      currentDesignRevision: 3,
      returnedRevisionIsCurrent: false,
    });
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toMatch(/historical revision 2.*current revision is 3/i);

    state = useProjectStore.getState().project;
    const originalRequest = {
      designId: candidateId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: state.designs[candidateId].revision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast' as const,
    };
    const originalCommit = commitAnalysisSnapshot(state, originalRequest, buildAnalysisSnapshot(state, state.designs[candidateId], 'fast'), 'solver');
    expect(originalCommit.result.ok).toBe(true);
    if (!originalCommit.result.ok) return;
    state = originalCommit.state;
    const edit = updateWingStructure(state, {
      designId: candidateId,
      expectedDesignRevision: state.designs[candidateId].revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.72 },
    }, 'human');
    expect(edit.result.ok).toBe(true);
    if (!edit.result.ok) return;
    state = edit.state;
    const replacementRequest = {
      designId: candidateId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: state.designs[candidateId].revision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast' as const,
    };
    const replacementCommit = commitAnalysisSnapshot(state, replacementRequest, buildAnalysisSnapshot(state, state.designs[candidateId], 'fast'), 'solver');
    expect(replacementCommit.result.ok).toBe(true);
    if (!replacementCommit.result.ok) return;
    useProjectStore.setState({ project: replacementCommit.state, analysisRun: { status: 'idle' }, commandNotice: null });
    const runReplay = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(originalRequest) as {
      ok: true;
      replayed: true;
      data: { snapshotRetention: { retained: boolean; inspectable: boolean; current: boolean; currentReplacementAnalysisId: string | null } };
    };
    expect(runReplay.data.snapshotRetention).toEqual({
      retained: true,
      inspectable: true,
      current: false,
      currentReplacementAnalysisId: replacementCommit.result.data.analysisId,
    });
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toContain(replacementCommit.result.data.analysisId);
  });

  it('does not advertise a pruned non-converged diagnostic as retained', async () => {
    let state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const template = buildAnalysisSnapshot(state, design, 'fast');
    template.status = 'not_converged';
    template.convergence.iterations = 40;
    template.convergence.equilibriumResidual = 0.01;
    template.convergence.twistChangeDeg = 0.1;
    template.convergence.relativeLoadChange = 0.01;
    template.constraints = evaluateDesignConstraints(
      state,
      design,
      'fast',
      template.status,
      template.metrics.structuralMassKg,
      template.metrics.inducedDragN,
      template.metrics.minYieldMargin,
      template.metrics.tipDeflectionM,
    );
    let firstRequest: Parameters<typeof commitAnalysisSnapshot>[1] | null = null;
    let firstAnalysisId = template.analysisId;
    for (let index = 0; index <= MAX_ANALYSES; index += 1) {
      const request = {
        designId: design.designId,
        expectedDesignRevision: design.revision,
        expectedProjectRevision: state.projectRevision,
        expectedFlightCaseRevision: state.flightCase.revision,
        expectedConstraintsRevision: state.constraints.revision,
        idempotencyKey: createIdempotencyKey(),
        fidelity: 'fast' as const,
      };
      const snapshot = structuredClone(template);
      snapshot.analysisId = createEntityId('ana');
      const transition = commitAnalysisSnapshot(state, request, snapshot, 'solver');
      expect(transition.result.ok).toBe(false);
      if (index === 0) {
        firstRequest = request;
        firstAnalysisId = snapshot.analysisId;
      }
      state = transition.state;
    }
    expect(state.analyses[firstAnalysisId]).toBeUndefined();
    useProjectStore.setState({ project: state, analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus(), commandNotice: null });
    const replay = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(firstRequest) as {
      ok: false;
      error: { code: string; committed?: boolean; analysisId?: string; message: string };
    };
    expect(replay.ok).toBe(false);
    expect(replay.error).toMatchObject({ code: 'ANALYSIS_DID_NOT_CONVERGE', committed: false });
    expect(replay.error.analysisId).toBeUndefined();
    expect(replay.error.message).toMatch(/no longer retained/i);
    expect(useProjectStore.getState().analysisRun.status).toBe('idle');
  });

  it('points stale summaries, station requests, and comparisons to existing current replacements without redundant solves', async () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const oldBaseline = buildAnalysisSnapshot(state, baseline, 'fast');
    let request = {
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      expectedProjectRevision: state.projectRevision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast' as const,
    };
    let transition = commitAnalysisSnapshot(state, request, oldBaseline, 'solver');
    if (!transition.result.ok) throw new Error(transition.result.error.message);
    state = transition.state;
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Replacement candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    state = branch.state;
    const candidate = state.designs[branch.result.data.designId];
    const oldCandidate = buildAnalysisSnapshot(state, candidate, 'fast');
    request = { ...request, designId: candidate.designId, idempotencyKey: createIdempotencyKey() };
    transition = commitAnalysisSnapshot(state, request, oldCandidate, 'solver');
    if (!transition.result.ok) throw new Error(transition.result.error.message);
    state = transition.state;

    const newBaseline = buildAnalysisSnapshot(state, state.designs[baseline.designId], 'fast');
    request = { ...request, designId: baseline.designId, idempotencyKey: createIdempotencyKey() };
    transition = commitAnalysisSnapshot(state, request, newBaseline, 'solver');
    if (!transition.result.ok) throw new Error(transition.result.error.message);
    state = transition.state;
    const newCandidate = buildAnalysisSnapshot(state, state.designs[candidate.designId], 'fast');
    request = { ...request, designId: candidate.designId, idempotencyKey: createIdempotencyKey() };
    transition = commitAnalysisSnapshot(state, request, newCandidate, 'solver');
    if (!transition.result.ok) throw new Error(transition.result.error.message);
    state = transition.state;
    useProjectStore.setState({ project: state, analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus() });

    const summary = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: oldBaseline.analysisId }) as {
      ok: true;
      data: { checkSummary: { designKind: string; applicable: number; unavailable: number }; freshness: { state: string; useAnalysisId?: string; requiredAction?: string } };
    };
    expect(summary.data.checkSummary).toMatchObject({ designKind: 'baseline', applicable: 3, unavailable: 2 });
    expect(summary.data.freshness).toMatchObject({ state: 'stale' });
    expect(summary.data.freshness.useAnalysisId).toBe(newBaseline.analysisId);
    expect(summary.data.freshness.requiredAction).toBeUndefined();

    const station = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: oldCandidate.analysisId, eta: 0 }) as {
      ok: false;
      error: { code: string; safeNextAction: string };
    };
    expect(station.error).toMatchObject({ code: 'STALE_ANALYSIS' });
    expect(station.error.safeNextAction).toContain(newCandidate.analysisId);
    expect(station.error.safeNextAction).toMatch(/no rerun is required/i);

    const comparison = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({
      referenceAnalysisId: oldBaseline.analysisId,
      candidateAnalysisId: oldCandidate.analysisId,
    }) as { ok: false; error: { code: string; safeNextAction: string } };
    expect(comparison.error.code).toBe('STALE_ANALYSIS');
    expect(comparison.error.safeNextAction).toContain(newBaseline.analysisId);
    expect(comparison.error.safeNextAction).toContain(newCandidate.analysisId);
    expect(comparison.error.safeNextAction).toMatch(/no rerun is required/i);
  });

  it('routes a historical non-converged diagnostic to an existing current replacement', async () => {
    let state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const diagnostic = buildAnalysisSnapshot(state, design, 'fast');
    diagnostic.status = 'not_converged';
    diagnostic.convergence.iterations = 40;
    diagnostic.convergence.equilibriumResidual = 0.01;
    diagnostic.convergence.twistChangeDeg = 0.1;
    diagnostic.convergence.relativeLoadChange = 0.01;
    diagnostic.constraints = evaluateDesignConstraints(
      state,
      design,
      diagnostic.fidelity,
      diagnostic.status,
      diagnostic.metrics.structuralMassKg,
      diagnostic.metrics.inducedDragN,
      diagnostic.metrics.minYieldMargin,
      diagnostic.metrics.tipDeflectionM,
    );
    let request = {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedProjectRevision: state.projectRevision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast' as const,
    };
    let transition = commitAnalysisSnapshot(state, request, diagnostic, 'solver');
    expect(transition.result.ok).toBe(false);
    state = transition.state;
    const replacement = buildAnalysisSnapshot(state, state.designs[design.designId], 'fast');
    request = { ...request, idempotencyKey: createIdempotencyKey() };
    transition = commitAnalysisSnapshot(state, request, replacement, 'solver');
    if (!transition.result.ok) throw new Error(transition.result.error.message);
    state = transition.state;
    useProjectStore.setState({ project: state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });

    const summary = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: diagnostic.analysisId }) as {
      ok: true;
      data: { freshness: { state: string; useAnalysisId?: string; requiredAction?: string } };
    };
    expect(summary.ok).toBe(true);
    expect(summary.data.freshness.state).toBe('not_converged');
    expect(summary.data.freshness.useAnalysisId).toBe(replacement.analysisId);
    expect(summary.data.freshness.requiredAction).toBeUndefined();

    const inspect = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: diagnostic.analysisId, eta: 0.5 }) as {
      ok: false;
      error: { code: string; safeNextAction: string };
    };
    expect(inspect.ok).toBe(false);
    expect(inspect.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    expect(inspect.error.safeNextAction).toContain(replacement.analysisId);
    expect(inspect.error.safeNextAction).toMatch(/no rerun is required/i);
  });

  it('does not promise a no-rerun stale comparison when current replacements use mixed fidelity', async () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const commitAt = (inputState: ProjectState, design: WingDesign, fidelity: 'fast' | 'standard') => {
      const snapshot = buildAnalysisSnapshot(inputState, design, fidelity);
      const transition = commitAnalysisSnapshot(inputState, {
        designId: design.designId,
        expectedDesignRevision: design.revision,
        expectedProjectRevision: inputState.projectRevision,
        expectedFlightCaseRevision: inputState.flightCase.revision,
        expectedConstraintsRevision: inputState.constraints.revision,
        idempotencyKey: createIdempotencyKey(),
        fidelity,
      }, snapshot, 'solver');
      if (!transition.result.ok) throw new Error(transition.result.error.message);
      return { state: transition.state, snapshot };
    };
    const oldBaseline = commitAt(state, baseline, 'standard');
    state = oldBaseline.state;
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Mixed fidelity candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    state = branch.state;
    const candidate = state.designs[branch.result.data.designId];
    const oldCandidate = commitAt(state, candidate, 'standard');
    state = oldCandidate.state;
    const newBaseline = commitAt(state, state.designs[baseline.designId], 'fast');
    state = newBaseline.state;
    const newCandidate = commitAt(state, state.designs[candidate.designId], 'standard');
    state = newCandidate.state;
    useProjectStore.setState({ project: state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });

    const comparison = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({
      referenceAnalysisId: oldBaseline.snapshot.analysisId,
      candidateAnalysisId: oldCandidate.snapshot.analysisId,
    }) as { ok: false; error: { code: string; safeNextAction: string } };
    expect(comparison.ok).toBe(false);
    expect(comparison.error.code).toBe('STALE_ANALYSIS');
    expect(comparison.error.safeNextAction).toContain(newBaseline.snapshot.analysisId);
    expect(comparison.error.safeNextAction).toContain(newCandidate.snapshot.analysisId);
    expect(comparison.error.safeNextAction).toContain(candidate.designId);
    expect(comparison.error.safeNextAction).toMatch(/at fast fidelity/i);
    expect(comparison.error.safeNextAction).not.toMatch(/no rerun is required/i);
  });

  it('rejects a stale candidate used as the reference before suggesting replacement analyses', async () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const commitAt = (inputState: ProjectState, design: WingDesign) => {
      const snapshot = buildAnalysisSnapshot(inputState, design, 'fast');
      const transition = commitAnalysisSnapshot(inputState, {
        designId: design.designId,
        expectedProjectRevision: inputState.projectRevision,
        expectedDesignRevision: design.revision,
        expectedFlightCaseRevision: inputState.flightCase.revision,
        expectedConstraintsRevision: inputState.constraints.revision,
        idempotencyKey: createIdempotencyKey(),
        fidelity: 'fast',
      }, snapshot, 'solver');
      if (!transition.result.ok) throw new Error(transition.result.error.message);
      return { state: transition.state, snapshot };
    };
    const branchOne = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Wrong-role reference',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branchOne.result.ok) throw new Error(branchOne.result.error.message);
    state = branchOne.state;
    const firstCandidate = state.designs[branchOne.result.data.designId];
    const oldReference = commitAt(state, firstCandidate);
    state = oldReference.state;
    const branchTwo = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Actual candidate slot',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branchTwo.result.ok) throw new Error(branchTwo.result.error.message);
    state = branchTwo.state;
    const secondCandidate = state.designs[branchTwo.result.data.designId];
    const oldCandidate = commitAt(state, secondCandidate);
    state = oldCandidate.state;
    state = commitAt(state, state.designs[firstCandidate.designId]).state;
    state = commitAt(state, state.designs[secondCandidate.designId]).state;
    useProjectStore.setState({ project: state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });

    const result = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({
      referenceAnalysisId: oldReference.snapshot.analysisId,
      candidateAnalysisId: oldCandidate.snapshot.analysisId,
    }) as { ok: false; error: { code: string; message: string; safeNextAction: string } };
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('VALIDATION_ERROR');
    expect(result.error.message).toMatch(/current Baseline reference/i);
    expect(result.error.safeNextAction).not.toMatch(/no rerun is required/i);
  });

  it('awaits registration, remains unique across remounts, and rolls back async failure', async () => {
    const registered = new Set<string>();
    const registeredCalls: string[] = [];
    const unregisteredCalls: string[] = [];
    const modelContext = {
      registerTool: async (value: unknown, options: { signal: AbortSignal }) => {
        const name = (value as { name: string }).name;
        if (registered.has(name)) throw new Error(`Duplicate ${name}`);
        registered.add(name);
        registeredCalls.push(name);
        options.signal.addEventListener('abort', () => {
          if (registered.delete(name)) unregisteredCalls.push(name);
        }, { once: true });
      },
    };
    vi.stubGlobal('document', { modelContext });
    const firstCleanup = registerAeroficiencySiteTools();
    expect(useProjectStore.getState().siteTools).toBe('checking');
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('ready'));
    expect([...registered]).toEqual(AEROFICIENCY_TOOLS.map((tool) => tool.name));
    firstCleanup();
    await vi.waitFor(() => expect(registered.size).toBe(0));
    const secondCleanup = registerAeroficiencySiteTools();
    await vi.waitFor(() => expect(registered.size).toBe(AEROFICIENCY_TOOLS.length));
    secondCleanup();
    await vi.waitFor(() => expect(registered.size).toBe(0));
    expect(registeredCalls).toHaveLength(AEROFICIENCY_TOOLS.length * 2);
    expect(unregisteredCalls).toHaveLength(AEROFICIENCY_TOOLS.length * 2);

    let attempts = 0;
    const partial = new Set<string>();
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: async (value: unknown, options: { signal: AbortSignal }) => {
          attempts += 1;
          if (attempts === 4) throw new Error('Registration failed');
          const name = (value as { name: string }).name;
          partial.add(name);
          options.signal.addEventListener('abort', () => partial.delete(name), { once: true });
        },
      },
    });
    const failedCleanup = registerAeroficiencySiteTools();
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('error'));
    expect(partial.size).toBe(0);
    failedCleanup();
  });

  it('aborts a pending registration before a clean remount', async () => {
    const registered = new Set<string>();
    let firstSignal: AbortSignal | null = null;
    let pendingAbortObserved = false;
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: (value: unknown, options: { signal: AbortSignal }) => {
          const name = (value as { name: string }).name;
          if (firstSignal === null) {
            firstSignal = options.signal;
            return new Promise<void>((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                pendingAbortObserved = true;
                reject(new Error('Registration aborted.'));
              }, { once: true });
            });
          }
          if (registered.has(name)) throw new Error(`Duplicate ${name}`);
          registered.add(name);
          options.signal.addEventListener('abort', () => registered.delete(name), { once: true });
          return Promise.resolve();
        },
      },
    });

    const pendingCleanup = registerAeroficiencySiteTools();
    expect(useProjectStore.getState().siteTools).toBe('checking');
    pendingCleanup();
    expect(pendingAbortObserved).toBe(true);

    const remountCleanup = registerAeroficiencySiteTools();
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('ready'));
    expect(registered.size).toBe(AEROFICIENCY_TOOLS.length);
    remountCleanup();
    expect(registered.size).toBe(0);
  });
});

type DomainResult = { ok: boolean };
type DomainFailureResult = { ok: false; error: { code: string } };
