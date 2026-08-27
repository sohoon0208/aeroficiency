import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/services/analysisController', () => ({ executeAnalysisWorker: workerMock.execute }));

import { commitAnalysisSnapshot } from '@/lib/domain/commands';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { AnalysisSnapshot, ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { useProjectStore } from '@/store/projectStore';

function requestFor(state: ProjectState, design: WingDesign, fidelity: SolverFidelity = 'fast') {
  return {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity,
  };
}

function controllerError(code: string, message: string) {
  return Object.assign(new Error(message), { code });
}

function currentBaselineProject() {
  const state = createDefaultProject();
  const design = state.designs[state.activeDesignId];
  const request = requestFor(state, design);
  const snapshot = buildAnalysisSnapshot(state, design, 'fast');
  const committed = commitAnalysisSnapshot(state, request, snapshot, 'solver');
  if (!committed.result.ok) throw new Error(committed.result.error.message);
  return committed.state;
}

describe('project-store analysis ownership', () => {
  beforeEach(() => {
    useProjectStore.getState().resetDemo();
    workerMock.execute.mockReset();
  });

  it('permits only one project analysis and aborts without corrupting a current result', async () => {
    const project = currentBaselineProject();
    useProjectStore.setState({ project, analysisRun: { status: 'idle' }, commandNotice: null });
    const original = structuredClone(project);
    workerMock.execute.mockImplementation((_state, _design, _fidelity, signal: AbortSignal) => new Promise<AnalysisSnapshot>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(controllerError('ABORTED', 'Analysis was aborted before commit.')), { once: true });
    }));

    const design = project.designs[project.activeDesignId];
    const first = useProjectStore.getState().runAnalysis(requestFor(project, design), 'human');
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    const second = await useProjectStore.getState().runAnalysis(requestFor(project, design), 'agent');
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.message).toMatch(/already running/i);
    expect(workerMock.execute).toHaveBeenCalledTimes(1);

    useProjectStore.getState().cancelAnalysis();
    const aborted = await first;
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('ABORTED');
    expect(useProjectStore.getState().analysisRun.status).toBe('aborted');
    expect(useProjectStore.getState().project).toEqual(original);
  });

  it('reset cancels a late worker and restores the exact deterministic fixture', async () => {
    workerMock.execute.mockImplementation((_state, _design, _fidelity, signal: AbortSignal) => new Promise<AnalysisSnapshot>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(controllerError('ABORTED', 'Analysis was aborted before commit.')), { once: true });
    }));
    const starting = useProjectStore.getState().project;
    const design = starting.designs[starting.activeDesignId];
    const pending = useProjectStore.getState().runAnalysis(requestFor(starting, design), 'human');
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    useProjectStore.getState().resetDemo();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('ABORTED');
    expect(useProjectStore.getState().project).toEqual(createDefaultProject());
    expect(useProjectStore.getState().analysisRun).toEqual({ status: 'idle' });
  });

  it('preserves the current result on worker failure and reports the original capability error', async () => {
    const project = currentBaselineProject();
    useProjectStore.setState({ project, analysisRun: { status: 'idle' }, commandNotice: null });
    const original = structuredClone(project);
    workerMock.execute.mockRejectedValue(controllerError('TOOL_UNAVAILABLE', 'This browser cannot start the local analysis worker.'));
    const design = project.designs[project.activeDesignId];
    const result = await useProjectStore.getState().runAnalysis(requestFor(project, design), 'human');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TOOL_UNAVAILABLE');
    expect(useProjectStore.getState().project).toEqual(original);
    expect(useProjectStore.getState().analysisRun.status).toBe('failed');
    expect(useProjectStore.getState().commandNotice?.code).toBe('TOOL_UNAVAILABLE');
  });

  it('commits a completed background run without overriding a newer human design selection', async () => {
    let finishWorker: (() => void) | undefined;
    workerMock.execute.mockImplementation((state: ProjectState, design: WingDesign, fidelity: SolverFidelity) => new Promise<AnalysisSnapshot>((resolve) => {
      finishWorker = () => resolve(buildAnalysisSnapshot(state, design, fidelity));
    }));
    const starting = useProjectStore.getState().project;
    const baseline = starting.designs[starting.activeDesignId];
    const pending = useProjectStore.getState().runAnalysis(requestFor(starting, baseline), 'human');
    const branch = useProjectStore.getState().createCandidate(baseline.designId, 'Candidate A', 'human');
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;
    expect(useProjectStore.getState().project.activeDesignId).toBe(branch.data.designId);
    finishWorker?.();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().project.activeDesignId).toBe(branch.data.designId);
    expect(useProjectStore.getState().project.designs[baseline.designId].latestAnalysisId).not.toBeNull();
    expect(useProjectStore.getState().project.selectedAnalysisId).toBeNull();
  });

  it('renders an idempotent non-converged replay as a committed diagnostic state', async () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const request = requestFor(state, design);
    const snapshot = buildAnalysisSnapshot(state, design, 'fast');
    snapshot.status = 'not_converged';
    snapshot.convergence.iterations = 40;
    snapshot.convergence.equilibriumResidual = 0.01;
    snapshot.convergence.twistChangeDeg = 0.1;
    snapshot.convergence.relativeLoadChange = 0.01;
    snapshot.constraints = evaluateDesignConstraints(
      state,
      design,
      'fast',
      snapshot.status,
      snapshot.metrics.structuralMassKg,
      snapshot.metrics.inducedDragN,
      snapshot.metrics.minYieldMargin,
      snapshot.metrics.tipDeflectionM,
    );
    const committed = commitAnalysisSnapshot(state, request, snapshot, 'solver');
    expect(committed.result.ok).toBe(false);
    if (committed.result.ok) return;
    expect(committed.result.error.committed).toBe(true);
    useProjectStore.setState({ project: committed.state, analysisRun: { status: 'idle' }, commandNotice: null });

    const replay = await useProjectStore.getState().runAnalysis(request, 'agent');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    const run = useProjectStore.getState().analysisRun;
    expect(run.status).toBe('not_converged');
    if (run.status === 'not_converged') expect(run.analysisId).toBe(snapshot.analysisId);
    expect(useProjectStore.getState().commandNotice).toBeNull();
    expect(workerMock.execute).not.toHaveBeenCalled();
  });
});
