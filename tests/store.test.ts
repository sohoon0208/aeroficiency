import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/services/analysisController', () => ({ executeAnalysisWorker: workerMock.execute }));

import { commitAnalysisSnapshot } from '@/lib/domain/commands';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { AnalysisSnapshot, ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function requestFor(state: ProjectState, design: WingDesign, fidelity: SolverFidelity = 'fast') {
  return {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedProjectRevision: state.projectRevision,
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

  it('makes candidate, update, and analysis replays visible without duplicate revisions, activities, snapshots, or worker runs', async () => {
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    const createKey = createIdempotencyKey();
    const firstCreate = useProjectStore.getState().createCandidate(baseline.designId, 'Replay candidate', 'agent', createKey, baseline.revision, initial.projectRevision);
    expect(firstCreate.ok).toBe(true);
    if (!firstCreate.ok) return;
    const candidateId = firstCreate.data.designId;
    const afterCreate = structuredClone(useProjectStore.getState().project);
    const replayCreate = useProjectStore.getState().createCandidate(baseline.designId, 'Replay candidate', 'agent', createKey, baseline.revision, initial.projectRevision);
    expect(replayCreate).toMatchObject({ ok: true, replayed: true });
    expect(useProjectStore.getState().project).toEqual(afterCreate);
    expect(useProjectStore.getState().commandNotice).toMatchObject({ kind: 'replay', designId: candidateId, code: 'IDEMPOTENT_REPLAY' });

    const updateKey = createIdempotencyKey();
    const firstUpdate = useProjectStore.getState().updateStructure(candidateId, { skinThicknessMm: 1.7 }, 'agent', updateKey, 1);
    expect(firstUpdate.ok).toBe(true);
    if (!firstUpdate.ok) return;
    const afterUpdate = structuredClone(useProjectStore.getState().project);
    const replayUpdate = useProjectStore.getState().updateStructure(candidateId, { skinThicknessMm: 1.7 }, 'agent', updateKey, 1);
    expect(replayUpdate).toMatchObject({ ok: true, replayed: true });
    expect(useProjectStore.getState().project).toEqual(afterUpdate);
    expect(useProjectStore.getState().commandNotice?.message).toMatch(/no duplicate revision or activity/i);

    const candidate = afterUpdate.designs[candidateId];
    const request = requestFor(afterUpdate, candidate);
    const committed = commitAnalysisSnapshot(afterUpdate, request, buildAnalysisSnapshot(afterUpdate, candidate, 'fast'), 'solver');
    expect(committed.result.ok).toBe(true);
    if (!committed.result.ok) return;
    useProjectStore.setState({ project: committed.state, analysisRun: { status: 'idle' }, commandNotice: null });
    const beforeRunReplay = structuredClone(committed.state);
    const replayRun = await useProjectStore.getState().runAnalysis(request, 'agent');
    expect(replayRun).toMatchObject({ ok: true, replayed: true });
    expect(useProjectStore.getState().project).toEqual(beforeRunReplay);
    expect(workerMock.execute).not.toHaveBeenCalled();
    expect(useProjectStore.getState().commandNotice).toMatchObject({ kind: 'replay', designId: candidateId, code: 'IDEMPOTENT_REPLAY' });
    expect(useProjectStore.getState().commandNotice?.message).toContain(committed.result.data.analysisId);
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
    const second = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(requestFor(project, design)) as { ok: false; error: { code: string; message: string; retryable: boolean; safeNextAction: string } };
    expect(second.ok).toBe(false);
    expect(second.error.code).toBe('ANALYSIS_ALREADY_RUNNING');
    expect(second.error.message).toMatch(/already running/i);
    expect(second.error.retryable).toBe(true);
    expect(second.error.safeNextAction).toMatch(/finish or cancel/i);
    expect(workerMock.execute).toHaveBeenCalledTimes(1);

    useProjectStore.getState().cancelAnalysis();
    const aborted = await first;
    expect(aborted.ok).toBe(false);
    if (!aborted.ok) expect(aborted.error.code).toBe('ABORTED');
    expect(useProjectStore.getState().analysisRun.status).toBe('aborted');
    expect(useProjectStore.getState().project).toEqual(original);
  });

  it('keeps benign no-op edits silent and preserves presentation state', () => {
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    const presentation = {
      ...createEmptyPresentationFocus(7),
      focusedPanel: 'station' as const,
      designId: baseline.designId,
      analysisId: 'ana_00000000000000000000000001' as const,
      eta: 0.5,
      actor: 'agent' as const,
      message: 'Existing presentation focus.',
    };
    useProjectStore.setState({
      presentation,
      commandNotice: {
        kind: 'failure',
        actor: 'human',
        designId: baseline.designId,
        code: 'VALIDATION_ERROR',
        message: 'Old error.',
        safeNextAction: 'Correct it.',
        retryable: false,
      },
    });

    const result = useProjectStore.getState().updateGeometry(
      baseline.designId,
      { tipTwistDeg: baseline.geometry.tipTwistDeg },
      'human',
      createIdempotencyKey(),
      baseline.revision,
    );

    expect(result).toMatchObject({ ok: true, replayed: false, data: { outcome: 'unchanged' } });
    const current = useProjectStore.getState();
    expect(current.project.projectRevision).toBe(initial.projectRevision);
    expect(current.project.designs).toEqual(initial.designs);
    expect(current.project.activities).toEqual(initial.activities);
    expect(current.presentation).toEqual(presentation);
    expect(current.commandNotice).toBeNull();
  });

  it('routes a retained but stale analysis replay to the verified current replacement', async () => {
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    const created = useProjectStore.getState().createCandidate(baseline.designId, 'Stale replay candidate', 'agent');
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    let state = useProjectStore.getState().project;
    const candidateId = created.data.designId;
    const originalRequest = requestFor(state, state.designs[candidateId]);
    const firstCommit = commitAnalysisSnapshot(state, originalRequest, buildAnalysisSnapshot(state, state.designs[candidateId], 'fast'), 'solver');
    expect(firstCommit.result.ok).toBe(true);
    if (!firstCommit.result.ok) return;
    state = firstCommit.state;
    const originalAnalysisId = firstCommit.result.data.analysisId;
    const edit = useProjectStore.getState().updateStructure;
    useProjectStore.setState({ project: state, analysisRun: { status: 'idle' }, commandNotice: null });
    const edited = edit(candidateId, { skinThicknessMm: 1.7 }, 'human', createIdempotencyKey(), state.designs[candidateId].revision);
    expect(edited.ok).toBe(true);
    state = useProjectStore.getState().project;
    const replacementRequest = requestFor(state, state.designs[candidateId]);
    const replacementCommit = commitAnalysisSnapshot(state, replacementRequest, buildAnalysisSnapshot(state, state.designs[candidateId], 'fast'), 'solver');
    expect(replacementCommit.result.ok).toBe(true);
    if (!replacementCommit.result.ok) return;
    useProjectStore.setState({ project: replacementCommit.state, analysisRun: { status: 'idle' }, commandNotice: null });
    const replacementAnalysisId = replacementCommit.result.data.analysisId;

    const replay = await useProjectStore.getState().runAnalysis(originalRequest, 'agent');
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(useProjectStore.getState().project.selectedAnalysisId).toBe(replacementAnalysisId);
    expect(useProjectStore.getState().commandNotice?.message).toContain(originalAnalysisId);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toContain(replacementAnalysisId);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toMatch(/summary-readable historical evidence.*stale/i);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).not.toMatch(/no longer inspectable/i);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).not.toMatch(/continue from immutable analysis/i);
    expect(workerMock.execute).not.toHaveBeenCalled();
  });

  it('honors replay and duplicate-key mismatch semantics while another run is active', async () => {
    const initial = createDefaultProject();
    const design = initial.designs[initial.activeDesignId];
    const replayRequest = requestFor(initial, design);
    const committed = commitAnalysisSnapshot(initial, replayRequest, buildAnalysisSnapshot(initial, design, 'fast'), 'solver');
    if (!committed.result.ok) throw new Error(committed.result.error.message);
    useProjectStore.setState({ project: committed.state, analysisRun: { status: 'idle' }, commandNotice: null });
    workerMock.execute.mockImplementation((_state, _design, _fidelity, signal: AbortSignal) => new Promise<AnalysisSnapshot>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(controllerError('ABORTED', 'Analysis was aborted before commit.')), { once: true });
    }));

    const activeRequest = requestFor(committed.state, committed.state.designs[design.designId]);
    const pending = useProjectStore.getState().runAnalysis(activeRequest, 'human');
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    const replay = await useProjectStore.getState().runAnalysis(replayRequest, 'agent');
    expect(replay.ok).toBe(true);
    if (replay.ok) expect(replay.replayed).toBe(true);
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    expect(useProjectStore.getState().commandNotice).toMatchObject({ kind: 'replay', code: 'IDEMPOTENT_REPLAY' });
    expect(workerMock.execute).toHaveBeenCalledTimes(1);

    const mismatch = await useProjectStore.getState().runAnalysis({ ...replayRequest, fidelity: 'standard' }, 'agent');
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error.code).toBe('DUPLICATE_MUTATION_MISMATCH');
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    expect(workerMock.execute).toHaveBeenCalledTimes(1);
    useProjectStore.getState().cancelAnalysis();
    await pending;
  });

  it('persists a transient non-active design before human station follow-up and direct Site Tool analysis', async () => {
    const starting = useProjectStore.getState().project;
    const baseline = starting.designs[starting.activeDesignId];
    const branch = useProjectStore.getState().createCandidate(baseline.designId, 'Non-active candidate', 'human');
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;
    const candidateId = branch.data.designId;
    useProjectStore.getState().selectDesign(baseline.designId);
    useProjectStore.getState().focusAnalysisStation('ana_TRANSIENT' as never, candidateId, 0.25, 'agent');
    useProjectStore.getState().selectEta(0.4);
    expect(useProjectStore.getState().project.activeDesignId).toBe(candidateId);
    expect(useProjectStore.getState().project.selectedEta).toBe(0.4);
    expect(useProjectStore.getState().presentation.focusedPanel).toBe('none');

    useProjectStore.getState().selectDesign(baseline.designId);
    useProjectStore.getState().focusAnalysisStation('ana_TRANSIENT' as never, candidateId, 0.4, 'agent');
    workerMock.execute.mockImplementation((state: ProjectState, design: WingDesign, fidelity: SolverFidelity) => Promise.resolve(buildAnalysisSnapshot(state, design, fidelity)));
    const project = useProjectStore.getState().project;
    const candidate = project.designs[candidateId];
    const result = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!.execute(requestFor(project, candidate)) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(useProjectStore.getState().project.activeDesignId).toBe(candidateId);
    expect(useProjectStore.getState().project.selectedAnalysisId).toBe(useProjectStore.getState().project.designs[candidateId].latestAnalysisId);
    expect(useProjectStore.getState().presentation.focusedPanel).toBe('none');
  });

  it('rejects an unsupported combined target CL before worker launch but reports stale revisions first', async () => {
    const starting = useProjectStore.getState().project;
    const baseline = starting.designs[starting.activeDesignId];
    const branch = useProjectStore.getState().createCandidate(baseline.designId, 'Combined CL candidate', 'human');
    expect(branch.ok).toBe(true);
    if (!branch.ok) return;
    const updated = useProjectStore.getState().updateGeometry(branch.data.designId, { spanM: 4, rootChordM: 0.8, tipChordM: 0.3 }, 'human', createIdempotencyKey(), branch.data.revision);
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    const project = useProjectStore.getState().project;
    const candidate = project.designs[branch.data.designId];
    const runTool = AEROFICIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!;

    const stale = await runTool.execute({
      ...requestFor(project, candidate),
      expectedDesignRevision: branch.data.revision,
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: false; error: { code: string; current?: { designRevision: number } } };
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatchObject({ code: 'REVISION_CONFLICT', current: { designRevision: updated.data.newDesignRevision } });

    const invalid = await runTool.execute(requestFor(project, candidate)) as { ok: false; error: { code: string; issues?: Array<{ reason: string }> } };
    expect(invalid.ok).toBe(false);
    expect(invalid.error.code).toBe('VALIDATION_ERROR');
    expect(invalid.error.issues?.some((issue) => /require CL/i.test(issue.reason))).toBe(true);
    expect(workerMock.execute).not.toHaveBeenCalled();
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

  it.each([
    ['MODEL_RANGE_EXCEEDED', 'MODEL_RANGE_EXCEEDED', /small-deformation model range/i],
    ['TARGET_LIFT_UNBRACKETED', 'TARGET_LIFT_UNBRACKETED', /target lift could not be bracketed/i],
    ['TRIM_DID_NOT_CONVERGE', 'TRIM_DID_NOT_CONVERGE', /target-lift trim did not converge/i],
    ['VLM_SINGULAR', 'VLM_SINGULAR', /singular or ill-conditioned/i],
    ['NUMERICAL_FAILURE', 'NUMERICAL_FAILURE', /bounded numerical failure/i],
    ['ARBITRARY_SECRET_CODE', 'UNCLASSIFIED_ANALYSIS_FAILURE', /failed safely/i],
  ])('maps %s worker exceptions to a bounded %s recovery category', async (workerCode, category, messagePattern) => {
    const project = currentBaselineProject();
    useProjectStore.setState({ project, analysisRun: { status: 'idle' }, commandNotice: null });
    const secret = `DO_NOT_EXPOSE_${'X'.repeat(100_000)}`;
    workerMock.execute.mockRejectedValue(controllerError(workerCode, `${String.fromCharCode(0)}${secret}`));
    const design = project.designs[project.activeDesignId];
    const result = await useProjectStore.getState().runAnalysis(requestFor(project, design), 'agent');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ANALYSIS_FAILED');
    expect(result.error.category).toBe(category);
    expect(result.error.message).toMatch(messagePattern);
    expect(result.error.safeNextAction.length).toBeLessThanOrEqual(320);
    const publicState = {
      result,
      run: useProjectStore.getState().analysisRun,
      notice: useProjectStore.getState().commandNotice,
    };
    const json = JSON.stringify(publicState);
    expect(json.length).toBeLessThan(2_000);
    expect(json).not.toContain('DO_NOT_EXPOSE');
    expect(json).not.toContain('X'.repeat(100));
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
    expect(useProjectStore.getState().commandNotice).toMatchObject({ kind: 'success', designId: baseline.designId, code: 'ANALYSIS_COMMITTED' });
    expect(useProjectStore.getState().commandNotice?.message).toContain(useProjectStore.getState().project.designs[baseline.designId].latestAnalysisId as string);
    expect(useProjectStore.getState().commandNotice?.safeNextAction).toContain(baseline.designId);
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
    useProjectStore.getState().focusComparison(snapshot.analysisId, snapshot.analysisId, design.designId, 'agent');
    expect(useProjectStore.getState().presentation.focusedPanel).toBe('comparison');

    const replay = await useProjectStore.getState().runAnalysis(request, 'agent');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    const run = useProjectStore.getState().analysisRun;
    expect(run.status).toBe('not_converged');
    if (run.status === 'not_converged') expect(run.analysisId).toBe(snapshot.analysisId);
    expect(useProjectStore.getState().project.selectedAnalysisId).toBe(snapshot.analysisId);
    expect(useProjectStore.getState().commandNotice).toBeNull();
    expect(useProjectStore.getState().presentation.focusedPanel).toBe('none');
    expect(workerMock.execute).not.toHaveBeenCalled();
  });

  it('does not let a non-converged replay overwrite an unrelated active run or its focus', async () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const diagnosticRequest = requestFor(state, design);
    const diagnostic = buildAnalysisSnapshot(state, design, 'fast');
    diagnostic.status = 'not_converged';
    diagnostic.convergence.iterations = 40;
    diagnostic.convergence.equilibriumResidual = 0.01;
    diagnostic.convergence.twistChangeDeg = 0.1;
    diagnostic.convergence.relativeLoadChange = 0.01;
    diagnostic.constraints = evaluateDesignConstraints(
      state,
      design,
      'fast',
      diagnostic.status,
      diagnostic.metrics.structuralMassKg,
      diagnostic.metrics.inducedDragN,
      diagnostic.metrics.minYieldMargin,
      diagnostic.metrics.tipDeflectionM,
    );
    const committed = commitAnalysisSnapshot(state, diagnosticRequest, diagnostic, 'solver');
    expect(committed.result.ok).toBe(false);
    useProjectStore.setState({ project: committed.state, analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus(), commandNotice: null });
    workerMock.execute.mockImplementation((_state, _design, _fidelity, signal: AbortSignal) => new Promise<AnalysisSnapshot>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(controllerError('ABORTED', 'Analysis was aborted before commit.')), { once: true });
    }));

    const currentDesign = committed.state.designs[design.designId];
    const pending = useProjectStore.getState().runAnalysis(requestFor(committed.state, currentDesign), 'human');
    useProjectStore.getState().focusAnalysisStation(diagnostic.analysisId, design.designId, 0, 'agent');
    const focusBeforeReplay = structuredClone(useProjectStore.getState().presentation);
    const replay = await useProjectStore.getState().runAnalysis(diagnosticRequest, 'agent');
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    expect(useProjectStore.getState().analysisRun.status).toBe('running');
    expect(useProjectStore.getState().presentation).toEqual(focusBeforeReplay);
    expect(useProjectStore.getState().commandNotice?.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    expect(workerMock.execute).toHaveBeenCalledTimes(1);
    useProjectStore.getState().cancelAnalysis();
    await pending;
  });
});
