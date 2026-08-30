import { describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createEntityId, createIdempotencyKey } from '@/lib/domain/ids';
import { MAX_ACTIVITY_EVENTS, MAX_ANALYSES, MAX_DESIGNS, MAX_IDEMPOTENCY_RECORDS } from '@/lib/domain/limits';
import type { AnalysisId, DesignId, ProjectState, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { canonicalAirfoil, sectionContour } from '@/lib/solver/airfoilSections';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function definition(name: string) {
  const result = AEROFICIENCY_TOOLS.find((tool) => tool.name === name);
  if (!result) throw new Error(`Missing ${name}`);
  return result;
}

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

function canonicalState() {
  let state = createDefaultProject();
  const baseline = state.designs[state.activeDesignId];
  const baselineRun = commit(state, baseline);
  state = baselineRun.state;
  const branch = createCandidateVariant(state, {
    sourceDesignId: baseline.designId,
    expectedProjectRevision: state.projectRevision,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Bounded output candidate',
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  state = branch.state;
  const updated = updateWingStructure(state, {
    designId: branch.result.data.designId,
    expectedDesignRevision: 1,
    idempotencyKey: createIdempotencyKey(),
    patch: { skinThicknessMm: 1.65, frontWebThicknessMm: 2, rearWebThicknessMm: 2 },
  }, 'agent');
  if (!updated.result.ok) throw new Error(updated.result.error.message);
  state = updated.state;
  const candidateRun = commit(state, state.designs[branch.result.data.designId]);
  return { state: candidateRun.state, baseline, baselineRun, candidate: candidateRun.snapshot };
}

function maximumBoundedState(seed: ProjectState, seedAnalysisId: AnalysisId) {
  const state = structuredClone(seed);
  const templateDesign = state.designs[state.activeDesignId];
  const templateAnalysis = state.analyses[seedAnalysisId];
  while (Object.keys(state.designs).length < MAX_DESIGNS) {
    const index = Object.keys(state.designs).length;
    const designId = `des_${String(index).padStart(26, 'A')}` as DesignId;
    state.designs[designId] = { ...structuredClone(templateDesign), designId, label: '翼'.repeat(48), latestAnalysisId: null };
  }
  while (Object.keys(state.analyses).length < MAX_ANALYSES) {
    const index = Object.keys(state.analyses).length;
    const analysisId = `ana_${String(index).padStart(26, 'A')}` as AnalysisId;
    state.analyses[analysisId] = { ...structuredClone(templateAnalysis), analysisId };
  }
  const activityTemplate = state.activities[0];
  state.activities = Array.from({ length: MAX_ACTIVITY_EVENTS }, (_, index) => ({
    ...structuredClone(activityTemplate),
    activityId: `act_${String(index).padStart(26, 'A')}` as never,
    summary: `Bounded activity ${index} ${'X'.repeat(80)}`,
  }));
  state.idempotencyLedger = Object.fromEntries(Array.from({ length: MAX_IDEMPOTENCY_RECORDS }, (_, index) => [`tool/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, {
    tool: 'bounded_fixture', requestHash: 'a'.repeat(64), result: { index }, committedAt: '2026-08-28T00:00:00.000Z',
  }]));
  return state;
}

function withMaximumV5Metadata(seed: ProjectState) {
  const state = structuredClone(seed);
  const eta = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const contour = sectionContour(canonicalAirfoil({ kind: 'NACA4', code: '2412' }, 40), 40).points
    .map(({ x, z }) => [x, z] as const);
  for (const design of Object.values(state.designs)) {
    design.geometry.airfoilStations = eta.map((value, index) => ({
      id: `station_${index}`,
      eta: value,
      airfoil: { kind: 'COORDINATES' as const, name: `Section ${index} ${'N'.repeat(28)}`, points: contour, source: 'S'.repeat(120) },
      blendToNext: index === eta.length - 1 ? 'HOLD' as const : 'LINEAR_CAMBER_THICKNESS' as const,
    }));
    design.geometry.polarModel = {
      kind: 'USER_TABLES',
      tables: design.geometry.airfoilStations.flatMap((station, stationIndex) => [1e6, 3e6, 9e6].map((reynolds, reynoldsIndex) => ({
        polarId: `p_${stationIndex}_${reynoldsIndex}`,
        airfoilStationId: station.id,
        reynolds,
        mach: 0.18,
        transitionModel: 'T'.repeat(80),
        rows: [-6, -4, -2, 0, 2, 4, 6].map((alphaDeg) => ({ alphaDeg, cl: 0.1 * alphaDeg, cd: 0.012 + 0.0002 * alphaDeg ** 2, cm: -0.02 })),
        provenance: { source: 'EXPERIMENT' as const, label: `Station ${stationIndex} Reynolds ${reynoldsIndex} ${'L'.repeat(52)}`, licence: 'C'.repeat(80) },
      }))),
    };
  }
  return state;
}

const SUCCESS_BUDGETS: Record<string, number> = {
  get_design_state: 5_000,
  get_analysis_summary: 1_500,
  inspect_span_station: 1_500,
  create_candidate_variant: 1_000,
  set_baseline_design: 1_500,
  update_wing_geometry: 1_500,
  update_wing_structure: 1_500,
  configure_angle_sweep: 1_500,
  run_aeroelastic_analysis: 3_000,
  compare_designs: 2_500,
};

const utf8Bytes = (value: string) => new TextEncoder().encode(value).byteLength;

describe('bounded Site Tool output envelopes', () => {
  it('keeps current, stale, replacement, and diagnostic summary variants below the frozen ceiling', async () => {
    const fixture = canonicalState();
    const currentProject = structuredClone(fixture.state);
    const variants: Record<string, unknown> = {};

    useProjectStore.setState({ project: currentProject, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    variants.current = await definition('get_analysis_summary').execute({ analysisId: fixture.candidate.analysisId });

    const historical = structuredClone(fixture.candidate);
    historical.analysisId = createEntityId('ana');
    historical.designRevision = Math.max(1, historical.designRevision - 1);
    const withReplacement = structuredClone(currentProject);
    withReplacement.analyses[historical.analysisId] = historical;
    useProjectStore.setState({ project: withReplacement, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    variants.staleWithReplacement = await definition('get_analysis_summary').execute({ analysisId: historical.analysisId });

    const withoutReplacement = structuredClone(withReplacement);
    withoutReplacement.designs[historical.designId].latestAnalysisId = null;
    useProjectStore.setState({ project: withoutReplacement, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    variants.staleWithoutReplacement = await definition('get_analysis_summary').execute({ analysisId: historical.analysisId });

    const diagnostic = structuredClone(historical);
    diagnostic.analysisId = createEntityId('ana');
    diagnostic.status = 'not_converged';
    diagnostic.convergence.iterations = 40;
    diagnostic.constraints = diagnostic.constraints.map((constraint) => ({ ...constraint, state: 'unavailable' as const, actual: null }));
    const diagnosticWithReplacement = structuredClone(currentProject);
    diagnosticWithReplacement.analyses[diagnostic.analysisId] = diagnostic;
    useProjectStore.setState({ project: diagnosticWithReplacement, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    variants.diagnosticWithReplacement = await definition('get_analysis_summary').execute({ analysisId: diagnostic.analysisId });

    const diagnosticWithoutReplacement = structuredClone(diagnosticWithReplacement);
    diagnosticWithoutReplacement.designs[diagnostic.designId].latestAnalysisId = null;
    useProjectStore.setState({ project: diagnosticWithoutReplacement, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    variants.diagnosticWithoutReplacement = await definition('get_analysis_summary').execute({ analysisId: diagnostic.analysisId });

    for (const [variant, result] of Object.entries(variants)) {
      expect((result as { ok?: boolean }).ok, variant).toBe(true);
      expect(utf8Bytes(JSON.stringify(result)), variant).toBeLessThan(SUCCESS_BUDGETS.get_analysis_summary);
    }
  });

  it('keeps all ten success and validation-error envelopes JSON-safe under frozen budgets, including maximum project cardinality', async () => {
    const fixture = canonicalState();
    useProjectStore.setState({ project: fixture.state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    const success: Record<string, unknown> = {};
    success.get_analysis_summary = await definition('get_analysis_summary').execute({ analysisId: fixture.candidate.analysisId });
    success.inspect_span_station = await definition('inspect_span_station').execute({ analysisId: fixture.candidate.analysisId, eta: 0.333 });
    success.compare_designs = await definition('compare_designs').execute({ referenceAnalysisId: fixture.baselineRun.snapshot.analysisId, candidateAnalysisId: fixture.candidate.analysisId });
    success.run_aeroelastic_analysis = await definition('run_aeroelastic_analysis').execute(fixture.baselineRun.request);
    const promotionTarget = fixture.state.designs[fixture.candidate.designId];
    success.set_baseline_design = await definition('set_baseline_design').execute({
      designId: promotionTarget.designId,
      expectedProjectRevision: fixture.state.projectRevision,
      expectedDesignRevision: promotionTarget.revision,
      idempotencyKey: createIdempotencyKey(),
    });
    useProjectStore.setState({ project: fixture.state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });

    const createResult = await definition('create_candidate_variant').execute({
      sourceDesignId: fixture.baseline.designId,
      expectedProjectRevision: fixture.state.projectRevision,
      expectedSourceDesignRevision: fixture.baseline.revision,
      candidateLabel: '翼'.repeat(48),
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: true; data: { designId: DesignId; revision: number } };
    expect(createResult.ok).toBe(true);
    success.create_candidate_variant = createResult;
    success.update_wing_geometry = await definition('update_wing_geometry').execute({
      designId: createResult.data.designId,
      expectedDesignRevision: createResult.data.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { spanM: 11.8, rootChordM: 2.5, tipChordM: 1.1, tipTwistDeg: -1.75, nacaCode: '2412' },
    });
    const mutatedRevision = useProjectStore.getState().project.designs[createResult.data.designId].revision;
    success.update_wing_structure = await definition('update_wing_structure').execute({
      designId: createResult.data.designId,
      expectedDesignRevision: mutatedRevision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7, frontWebThicknessMm: 2.1, rearWebThicknessMm: 2.1, elasticAxisXOverC: 0.4 },
    });
    success.configure_angle_sweep = await definition('configure_angle_sweep').execute({
      expectedProjectRevision: useProjectStore.getState().project.projectRevision,
      expectedFlightCaseRevision: useProjectStore.getState().project.flightCase.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { sweepStepAlphaDeg: 0.5 },
    });

    const maximum = maximumBoundedState(useProjectStore.getState().project, fixture.candidate.analysisId);
    useProjectStore.setState({ project: maximum, presentation: createEmptyPresentationFocus() });
    const inspectedId = Object.keys(maximum.designs).find((designId) => designId !== maximum.activeDesignId) as DesignId;
    success.get_design_state = await definition('get_design_state').execute({ designId: inspectedId });
    success.get_analysis_summary = await definition('get_analysis_summary').execute({ analysisId: fixture.candidate.analysisId });
    success.inspect_span_station = await definition('inspect_span_station').execute({ analysisId: fixture.candidate.analysisId, eta: 0.333 });
    success.compare_designs = await definition('compare_designs').execute({ referenceAnalysisId: fixture.baselineRun.snapshot.analysisId, candidateAnalysisId: fixture.candidate.analysisId });

    for (const [name, result] of Object.entries(success)) {
      expect((result as { ok?: boolean }).ok, `${name} success envelope`).toBe(true);
      const json = JSON.stringify(result);
      expect(utf8Bytes(json), `${name} success UTF-8 bytes`).toBeLessThan(SUCCESS_BUDGETS[name]);
      expect(json).not.toContain('NaN');
      expect(json).not.toContain('Infinity');
      expect(JSON.parse(json)).toEqual(result);
    }

    const invalidInputs: Record<string, unknown> = {
      get_design_state: { unexpected: true },
      get_analysis_summary: { analysisId: 'bad' },
      inspect_span_station: { analysisId: 'bad', eta: 2 },
      create_candidate_variant: {},
      set_baseline_design: {},
      update_wing_geometry: {},
      update_wing_structure: {},
      configure_angle_sweep: {},
      run_aeroelastic_analysis: {},
      compare_designs: {},
    };
    for (const name of Object.keys(SUCCESS_BUDGETS)) {
      const result = await definition(name).execute(invalidInputs[name]);
      const json = JSON.stringify(result);
      expect((result as { ok: boolean }).ok, `${name} error envelope`).toBe(false);
      expect(utf8Bytes(json), `${name} error UTF-8 bytes`).toBeLessThan(3_000);
      expect(JSON.parse(json)).toEqual(result);
    }

    const adversarialUnknowns = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [
      `unknown_${index}_${'X'.repeat(90)}`,
      'Y'.repeat(500),
    ]));
    for (const name of Object.keys(SUCCESS_BUDGETS)) {
      const result = await definition(name).execute(adversarialUnknowns);
      const json = JSON.stringify(result);
      expect((result as { ok: boolean }).ok, `${name} adversarial error envelope`).toBe(false);
      expect(utf8Bytes(json), `${name} adversarial error UTF-8 bytes`).toBeLessThan(3_000);
    }

    const liveRevision = maximum.designs[createResult.data.designId].revision;
    for (const name of ['update_wing_geometry', 'update_wing_structure']) {
      const result = await definition(name).execute({
        designId: createResult.data.designId,
        expectedDesignRevision: liveRevision,
        idempotencyKey: createIdempotencyKey(),
        patch: adversarialUnknowns,
      });
      const json = JSON.stringify(result);
      expect((result as { ok: boolean }).ok, `${name} nested adversarial error envelope`).toBe(false);
      expect(utf8Bytes(json), `${name} nested adversarial error UTF-8 bytes`).toBeLessThan(3_000);
    }
  });

  it('keeps two maximum V5 airfoil/polar metadata projections useful and below the design-state ceiling', async () => {
    const fixture = canonicalState();
    const maximumV5 = withMaximumV5Metadata(fixture.state);
    useProjectStore.setState({ project: maximumV5, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    const inspectedDesignId = Object.keys(maximumV5.designs).find((designId) => designId !== maximumV5.activeDesignId) as DesignId;
    const result = await definition('get_design_state').execute({ designId: inspectedDesignId }) as {
      ok: true;
      data: {
        activeDesign: { designId: DesignId; detailLevel: 'identity' };
        inspectedDesign: { designId: DesignId; detailLevel: 'full'; geometry: { polarModel: { tableCount: number; stations: unknown[] } } };
      };
    };
    const json = JSON.stringify(result);

    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(result.data.activeDesign).toMatchObject({ designId: maximumV5.activeDesignId, detailLevel: 'identity' });
    expect(result.data.inspectedDesign).toMatchObject({ designId: inspectedDesignId, detailLevel: 'full' });
    expect(result.data.inspectedDesign.geometry.polarModel.tableCount).toBe(18);
    expect(result.data.inspectedDesign.geometry.polarModel.stations).toHaveLength(6);
    expect(utf8Bytes(json)).toBeLessThan(SUCCESS_BUDGETS.get_design_state);
    expect(json).not.toContain('"rows"');
    expect(json).not.toContain('"points"');
    expect(json).not.toContain('"licence"');
  });

  it('contains adversarial thrown messages and parser traps inside a fixed public failure envelope', async () => {
    const initial = useProjectStore.getState();
    const baseline = initial.project.designs[initial.project.activeDesignId];
    const originalCreateCandidate = initial.createCandidate;
    const secret = `DO_NOT_EXPOSE_${'X'.repeat(100_000)}`;
    useProjectStore.setState({
      createCandidate: (() => { throw new Error(`${String.fromCharCode(0)}${secret}`); }) as typeof originalCreateCandidate,
    });
    try {
      const thrown = await definition('create_candidate_variant').execute({
        sourceDesignId: baseline.designId,
        expectedProjectRevision: initial.project.projectRevision,
        expectedSourceDesignRevision: baseline.revision,
        candidateLabel: 'Bounded exception fixture',
        idempotencyKey: createIdempotencyKey(),
      }) as { ok: false; error: { code: string; category?: string; message: string } };
      const json = JSON.stringify(thrown);
      expect(thrown.ok).toBe(false);
      expect(thrown.error).toMatchObject({ code: 'ANALYSIS_FAILED', category: 'TOOL_EXECUTION_EXCEPTION' });
      expect(utf8Bytes(json)).toBeLessThan(1_000);
      expect(json).not.toContain('DO_NOT_EXPOSE');
      expect(json).not.toContain('X'.repeat(100));
    } finally {
      useProjectStore.setState({ createCandidate: originalCreateCandidate });
    }

    useProjectStore.setState({
      createCandidate: (() => ({
        ok: true,
        replayed: false,
        data: { payload: secret },
      })) as unknown as typeof originalCreateCandidate,
    });
    try {
      const oversizedSuccess = await definition('create_candidate_variant').execute({
        sourceDesignId: baseline.designId,
        expectedProjectRevision: useProjectStore.getState().project.projectRevision,
        expectedSourceDesignRevision: baseline.revision,
        candidateLabel: 'Oversized adapter success',
        idempotencyKey: createIdempotencyKey(),
      }) as { ok: false; error: { category?: string } };
      const json = JSON.stringify(oversizedSuccess);
      expect(oversizedSuccess.ok).toBe(false);
      expect(oversizedSuccess.error.category).toBe('TOOL_OUTPUT_LIMIT');
      expect(utf8Bytes(json)).toBeLessThan(1_000);
      expect(json).not.toContain('DO_NOT_EXPOSE');
    } finally {
      useProjectStore.setState({ createCandidate: originalCreateCandidate });
    }

    useProjectStore.setState({
      createCandidate: (() => ({
        ok: false,
        error: {
          code: secret,
          message: secret,
          retryable: true,
          safeNextAction: secret,
          category: secret,
          issues: Array.from({ length: 100 }, () => ({ path: secret, reason: secret })),
        },
      })) as typeof originalCreateCandidate,
    });
    try {
      const returned = await definition('create_candidate_variant').execute({
        sourceDesignId: baseline.designId,
        expectedProjectRevision: useProjectStore.getState().project.projectRevision,
        expectedSourceDesignRevision: baseline.revision,
        candidateLabel: 'Bounded returned failure',
        idempotencyKey: createIdempotencyKey(),
      }) as { ok: false; error: { code: string; message: string; issues?: unknown[] } };
      const json = JSON.stringify(returned);
      expect(returned.ok).toBe(false);
      expect(returned.error.code).toBe('ANALYSIS_FAILED');
      expect(returned.error.message).toMatch(/untrusted adapter/i);
      expect(returned.error.issues).toBeUndefined();
      expect(utf8Bytes(json)).toBeLessThan(4_000);
      expect(json).not.toContain('DO_NOT_EXPOSE');
      expect(json).not.toContain('X'.repeat(400));
    } finally {
      useProjectStore.setState({ createCandidate: originalCreateCandidate });
    }

    const trappedInput = new Proxy({}, {
      ownKeys() { throw new Error(secret); },
    });
    const trapped = await definition('get_design_state').execute(trappedInput) as { ok: false; error: { category?: string } };
    const trappedJson = JSON.stringify(trapped);
    expect(trapped.ok).toBe(false);
    expect(trapped.error.category).toBe('TOOL_EXECUTION_EXCEPTION');
    expect(utf8Bytes(trappedJson)).toBeLessThan(1_000);
    expect(trappedJson).not.toContain('DO_NOT_EXPOSE');
  });
});
