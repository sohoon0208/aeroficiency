import { beforeEach, describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { ProjectState, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function commit(state: ProjectState, design: WingDesign) {
  const snapshot = buildAnalysisSnapshot(state, design, 'standard');
  const transition = commitAnalysisSnapshot(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedProjectRevision: state.projectRevision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  }, snapshot, 'solver');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return { state: transition.state, snapshot };
}

function twoCurrentAnalyses() {
  let state = createDefaultProject();
  const baseline = state.designs[state.activeDesignId];
  const baselineRun = commit(state, baseline);
  state = baselineRun.state;
  const branch = createCandidateVariant(state, {
    sourceDesignId: baseline.designId,
    expectedProjectRevision: state.projectRevision,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Presentation candidate',
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  state = branch.state;
  const candidate = state.designs[branch.result.data.designId];
  const candidateRun = commit(state, candidate);
  return { state: candidateRun.state, baseline: baselineRun.snapshot, candidate: candidateRun.snapshot };
}

function tool(name: string) {
  const definition = AEROFICIENCY_TOOLS.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing ${name}`);
  return definition;
}

describe('transient Site Tool presentation focus', () => {
  beforeEach(() => {
    useProjectStore.setState({
      project: createDefaultProject(),
      analysisRun: { status: 'idle' },
      presentation: createEmptyPresentationFocus(),
      mutationHighlight: null,
      commandNotice: null,
    });
  });

  it('keeps both pure reads free of engineering and presentation mutations', async () => {
    const baseline = useProjectStore.getState().project.designs[useProjectStore.getState().project.activeDesignId];
    const run = commit(useProjectStore.getState().project, baseline);
    useProjectStore.setState({ project: run.state });
    const beforeProject = structuredClone(useProjectStore.getState().project);
    const beforePresentation = structuredClone(useProjectStore.getState().presentation);
    await tool('get_design_state').execute({});
    await tool('get_analysis_summary').execute({ analysisId: run.snapshot.analysisId });
    expect(useProjectStore.getState().project).toEqual(beforeProject);
    expect(useProjectStore.getState().presentation).toEqual(beforePresentation);
  });

  it('focuses the exact resolved current station without changing engineering state or activity', async () => {
    const baseline = useProjectStore.getState().project.designs[useProjectStore.getState().project.activeDesignId];
    const run = commit(useProjectStore.getState().project, baseline);
    useProjectStore.setState({ project: run.state });
    const beforeProject = structuredClone(useProjectStore.getState().project);
    const result = await tool('inspect_span_station').execute({ analysisId: run.snapshot.analysisId, eta: 0.037 }) as {
      ok: true;
      data: { resolvedEta: number; visualFocusApplied: boolean };
    };
    expect(result.ok).toBe(true);
    expect(result.data.visualFocusApplied).toBe(true);
    expect(useProjectStore.getState().project).toEqual(beforeProject);
    expect(useProjectStore.getState().presentation).toMatchObject({
      focusedPanel: 'station',
      designId: baseline.designId,
      analysisId: run.snapshot.analysisId,
      eta: result.data.resolvedEta,
      actor: 'agent',
    });
  });

  it('pins the exact ordered comparison pair without a solver run or engineering mutation', async () => {
    const fixture = twoCurrentAnalyses();
    useProjectStore.setState({ project: fixture.state, presentation: createEmptyPresentationFocus() });
    const beforeProject = structuredClone(useProjectStore.getState().project);
    const result = await tool('compare_designs').execute({
      referenceAnalysisId: fixture.baseline.analysisId,
      candidateAnalysisId: fixture.candidate.analysisId,
    }) as { ok: true; data: { visualFocusApplied: boolean } };
    expect(result.ok).toBe(true);
    expect(result.data.visualFocusApplied).toBe(true);
    expect(useProjectStore.getState().project).toEqual(beforeProject);
    expect(useProjectStore.getState().presentation).toMatchObject({
      focusedPanel: 'comparison',
      analysisId: fixture.candidate.analysisId,
      comparisonAnalysisIds: {
        referenceAnalysisId: fixture.baseline.analysisId,
        candidateAnalysisId: fixture.candidate.analysisId,
      },
      actor: 'agent',
    });
  });

  it('rejects stale station focus and invalid comparisons without changing prior focus', async () => {
    const fixture = twoCurrentAnalyses();
    useProjectStore.setState({ project: fixture.state, presentation: createEmptyPresentationFocus() });
    await tool('inspect_span_station').execute({ analysisId: fixture.baseline.analysisId, eta: 0 });
    const priorFocus = structuredClone(useProjectStore.getState().presentation);

    const candidateDesign = fixture.state.designs[fixture.candidate.designId];
    const edited = updateWingStructure(fixture.state, {
      designId: candidateDesign.designId,
      expectedDesignRevision: candidateDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7 },
    }, 'human');
    if (!edited.result.ok) throw new Error(edited.result.error.message);
    useProjectStore.setState({ project: edited.state, presentation: priorFocus });

    const stale = await tool('inspect_span_station').execute({ analysisId: fixture.candidate.analysisId, eta: 0.5 }) as { ok: false; error: { code: string } };
    expect(stale.ok).toBe(false);
    expect(stale.error.code).toBe('STALE_ANALYSIS');
    expect(useProjectStore.getState().presentation).toEqual(priorFocus);

    const invalidPair = await tool('compare_designs').execute({
      referenceAnalysisId: fixture.baseline.analysisId,
      candidateAnalysisId: fixture.candidate.analysisId,
    }) as { ok: false; error: { code: string } };
    expect(invalidPair.ok).toBe(false);
    expect(invalidPair.error.code).toBe('STALE_ANALYSIS');
    expect(useProjectStore.getState().presentation).toEqual(priorFocus);
  });

  it('reset clears every transient focus field', () => {
    useProjectStore.getState().focusAnalysisStation('ana_A' as never, 'des_A' as never, 0.25, 'agent');
    useProjectStore.getState().resetDemo();
    expect(useProjectStore.getState().presentation).toMatchObject({
      focusedPanel: 'none',
      designId: null,
      analysisId: null,
      eta: null,
      comparisonAnalysisIds: null,
      actor: null,
      message: null,
    });
  });
});
