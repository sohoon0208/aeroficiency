import { describe, expect, it } from 'vitest';
import {
  commitAnalysisSnapshot,
  createCandidateVariant,
  preflightAnalysisRun,
  setBaselineDesign,
  updateWingGeometry,
  updateWingStructure,
} from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { MAX_DESIGNS, MAX_IDEMPOTENCY_RECORDS } from '@/lib/domain/limits';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { designAnalysisFreshness, validateStructure } from '@/lib/domain/validation';
import type { AnalysisSnapshot, ProjectState, SolverFidelity } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

function runRequest(state: ProjectState, fidelity: SolverFidelity = 'fast') {
  const design = state.designs[state.activeDesignId];
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

function branchCandidate(state: ProjectState, label = 'Candidate A') {
  const baseline = state.designs[state.activeDesignId];
  const branch = createCandidateVariant(state, {
    sourceDesignId: baseline.designId,
    expectedProjectRevision: state.projectRevision,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: label,
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  return { state: branch.state, designId: branch.result.data.designId };
}

describe('domain mutation and snapshot boundaries', () => {
  it('rejects nonfinite structure inputs and unknown patch fields', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    expect(validateStructure({ ...baseline.structure, elasticAxisXOverC: Number.NaN })).not.toHaveLength(0);
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Candidate A',
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    expect(branch.result.ok).toBe(true);
    if (!branch.result.ok) return;
    const candidate = branch.state.designs[branch.result.data.designId];
    const transition = updateWingStructure(branch.state, {
      designId: candidate.designId,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { evil: 42 } as never,
    }, 'agent');
    expect(transition.result.ok).toBe(false);
    expect(transition.state).toBe(branch.state);
    expect('evil' in transition.state.designs[candidate.designId].structure).toBe(false);
  });

  it('replays an identical branch request without duplication', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const request = {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Candidate A',
      idempotencyKey: createIdempotencyKey(),
    };
    const first = createCandidateVariant(state, request, 'agent');
    expect(first.result.ok).toBe(true);
    const second = createCandidateVariant(first.state, request, 'agent');
    expect(second.result.ok && second.result.replayed).toBe(true);
    expect(Object.keys(second.state.designs)).toHaveLength(2);
  });

  it('fails closed instead of duplicating candidate creation after the bounded replay record is evicted', () => {
    const initial = createDefaultProject();
    const baseline = initial.designs[initial.activeDesignId];
    const originalRequest = {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: initial.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Eviction-safe candidate',
      idempotencyKey: createIdempotencyKey(),
    };
    const created = createCandidateVariant(initial, originalRequest, 'agent');
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    let state = created.state;
    const candidateId = created.result.data.designId;
    for (let index = 0; index < MAX_IDEMPOTENCY_RECORDS; index += 1) {
      const design = state.designs[candidateId];
      const transition = updateWingStructure(state, {
        designId: candidateId,
        expectedDesignRevision: design.revision,
        idempotencyKey: createIdempotencyKey(),
        patch: { skinThicknessMm: index % 2 === 0 ? 1.7 : 1.71 },
      }, 'agent');
      expect(transition.result.ok).toBe(true);
      if (!transition.result.ok) return;
      state = transition.state;
    }
    expect(Object.keys(state.idempotencyLedger)).toHaveLength(MAX_IDEMPOTENCY_RECORDS);
    const designCount = Object.keys(state.designs).length;
    const replayAfterEviction = createCandidateVariant(state, originalRequest, 'agent');
    expect(replayAfterEviction.result.ok).toBe(false);
    if (!replayAfterEviction.result.ok) {
      expect(replayAfterEviction.result.error.code).toBe('REVISION_CONFLICT');
      expect(replayAfterEviction.result.error.current?.projectRevision).toBe(state.projectRevision);
    }
    expect(Object.keys(replayAfterEviction.state.designs)).toHaveLength(designCount);
    expect(replayAfterEviction.state).toBe(state);
  });

  it('fails closed instead of relaunching an analysis after its bounded replay record is evicted', () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const originalRequest = runRequest(state);
    const committed = commitAnalysisSnapshot(state, originalRequest, buildAnalysisSnapshot(state, baseline, 'fast'), 'solver');
    expect(committed.result.ok).toBe(true);
    if (!committed.result.ok) return;
    state = committed.state;
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Ledger filler candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    expect(branch.result.ok).toBe(true);
    if (!branch.result.ok) return;
    state = branch.state;
    const candidateId = branch.result.data.designId;
    for (let index = 0; index < MAX_IDEMPOTENCY_RECORDS; index += 1) {
      const design = state.designs[candidateId];
      const transition = updateWingStructure(state, {
        designId: candidateId,
        expectedDesignRevision: design.revision,
        idempotencyKey: createIdempotencyKey(),
        patch: { skinThicknessMm: index % 2 === 0 ? 1.7 : 1.71 },
      }, 'agent');
      expect(transition.result.ok).toBe(true);
      if (!transition.result.ok) return;
      state = transition.state;
    }
    const analysisCount = Object.keys(state.analyses).length;
    const replayAfterEviction = preflightAnalysisRun(state, originalRequest);
    expect(replayAfterEviction.ok).toBe(false);
    if (!replayAfterEviction.ok) expect(replayAfterEviction.error.code).toBe('REVISION_CONFLICT');
    expect(Object.keys(state.analyses)).toHaveLength(analysisCount);
  });

  it('edits the Baseline, rejects stale revisions, and rejects idempotency-key payload drift', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const baselineUpdate = updateWingGeometry(state, {
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -1.5 },
    }, 'human');
    expect(baselineUpdate.result.ok).toBe(true);
    expect(baselineUpdate.state).not.toBe(state);
    expect(baselineUpdate.state.designs[baseline.designId]).toMatchObject({ kind: 'baseline', revision: 2, geometry: { tipTwistDeg: -1.5 } });

    const branchState = baselineUpdate.state;
    const editableBaseline = branchState.designs[baseline.designId];

    const key = createIdempotencyKey();
    const firstBranch = createCandidateVariant(branchState, {
      sourceDesignId: editableBaseline.designId,
      expectedProjectRevision: branchState.projectRevision,
      expectedSourceDesignRevision: editableBaseline.revision,
      candidateLabel: 'Candidate A',
      idempotencyKey: key,
    }, 'agent');
    expect(firstBranch.result.ok).toBe(true);
    const mismatchedReplay = createCandidateVariant(firstBranch.state, {
      sourceDesignId: editableBaseline.designId,
      expectedProjectRevision: branchState.projectRevision,
      expectedSourceDesignRevision: editableBaseline.revision,
      candidateLabel: 'Different payload',
      idempotencyKey: key,
    }, 'agent');
    expect(mismatchedReplay.result.ok).toBe(false);
    if (!mismatchedReplay.result.ok) expect(mismatchedReplay.result.error.code).toBe('DUPLICATE_MUTATION_MISMATCH');
    expect(mismatchedReplay.state).toBe(firstBranch.state);

    if (!firstBranch.result.ok) return;
    const candidate = firstBranch.state.designs[firstBranch.result.data.designId];
    const firstUpdate = updateWingGeometry(firstBranch.state, {
      designId: candidate.designId,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -2.2 },
    }, 'human');
    expect(firstUpdate.result.ok).toBe(true);
    const staleUpdate = updateWingGeometry(firstUpdate.state, {
      designId: candidate.designId,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -2.4 },
    }, 'agent');
    expect(staleUpdate.result.ok).toBe(false);
    if (!staleUpdate.result.ok) {
      expect(staleUpdate.result.error.code).toBe('REVISION_CONFLICT');
      expect(staleUpdate.result.error.current?.designRevision).toBe(candidate.revision + 1);
    }
    expect(staleUpdate.state).toBe(firstUpdate.state);
  });

  it('promotes a candidate to Baseline, preserves both designs, and stales every reference-dependent analysis', () => {
    let state = createDefaultProject();
    const originalBaseline = state.designs[state.activeDesignId];
    const baselineRequest = runRequest(state);
    const baselineSnapshot = buildAnalysisSnapshot(state, originalBaseline, 'fast');
    const baselineRun = commitAnalysisSnapshot(state, baselineRequest, baselineSnapshot, 'solver');
    if (!baselineRun.result.ok) throw new Error(baselineRun.result.error.message);
    state = baselineRun.state;

    const branch = createCandidateVariant(state, {
      sourceDesignId: originalBaseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: originalBaseline.revision,
      candidateLabel: 'Candidate A',
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    state = branch.state;
    const candidate = state.designs[branch.result.data.designId];
    const candidateRequest = runRequest(state);
    const candidateSnapshot = buildAnalysisSnapshot(state, candidate, 'fast');
    const candidateRun = commitAnalysisSnapshot(state, candidateRequest, candidateSnapshot, 'solver');
    if (!candidateRun.result.ok) throw new Error(candidateRun.result.error.message);
    state = candidateRun.state;

    const secondBranch = createCandidateVariant(state, {
      sourceDesignId: originalBaseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: state.designs[originalBaseline.designId].revision,
      candidateLabel: 'Candidate B',
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    if (!secondBranch.result.ok) throw new Error(secondBranch.result.error.message);
    state = secondBranch.state;
    const secondCandidate = state.designs[secondBranch.result.data.designId];
    const secondCandidateRequest = runRequest(state);
    const secondCandidateSnapshot = buildAnalysisSnapshot(state, secondCandidate, 'fast');
    const secondCandidateRun = commitAnalysisSnapshot(state, secondCandidateRequest, secondCandidateSnapshot, 'solver');
    if (!secondCandidateRun.result.ok) throw new Error(secondCandidateRun.result.error.message);
    state = secondCandidateRun.state;
    expect(designAnalysisFreshness(state, state.designs[originalBaseline.designId])).toBe('current');
    expect(designAnalysisFreshness(state, state.designs[candidate.designId])).toBe('current');
    expect(designAnalysisFreshness(state, state.designs[secondCandidate.designId])).toBe('current');

    const promoted = setBaselineDesign(state, {
      designId: candidate.designId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    if (!promoted.result.ok) throw new Error(promoted.result.error.message);
    const next = promoted.state;
    expect(Object.values(next.designs).filter((design) => design.kind === 'baseline')).toHaveLength(1);
    expect(next.designs[candidate.designId]).toMatchObject({ kind: 'baseline', revision: candidate.revision + 1 });
    expect(next.designs[originalBaseline.designId]).toMatchObject({ kind: 'candidate', revision: originalBaseline.revision + 1 });
    expect(next.designs[candidate.designId].geometry).toEqual(candidate.geometry);
    expect(next.designs[originalBaseline.designId].geometry).toEqual(originalBaseline.geometry);
    expect(designAnalysisFreshness(next, next.designs[candidate.designId])).toBe('stale');
    expect(designAnalysisFreshness(next, next.designs[originalBaseline.designId])).toBe('stale');
    expect(designAnalysisFreshness(next, next.designs[secondCandidate.designId])).toBe('stale');
    expect(promoted.result.data.invalidatedAnalysisIds).toEqual(expect.arrayContaining([
      baselineRun.result.data.analysisId,
      candidateRun.result.data.analysisId,
      secondCandidateRun.result.data.analysisId,
    ]));
    expect(promoted.result.data.invalidatedAnalysisIds).toHaveLength(3);
    expect(next.activities[0].operation).toBe('set_baseline_design');
  });

  it('rejects a late worker result after a newer edit and detects dependency conflicts in preflight', () => {
    const branch = branchCandidate(createDefaultProject());
    const candidate = branch.state.designs[branch.designId];
    const request = runRequest(branch.state);
    const snapshot = buildAnalysisSnapshot(branch.state, candidate, 'fast');
    const edited = updateWingStructure(branch.state, {
      designId: candidate.designId,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7 },
    }, 'human');
    expect(edited.result.ok).toBe(true);
    const beforeLateCommit = structuredClone(edited.state);
    const late = commitAnalysisSnapshot(edited.state, request, snapshot, 'solver');
    expect(late.result.ok).toBe(false);
    if (!late.result.ok) expect(late.result.error.code).toBe('REVISION_CONFLICT');
    expect(late.state).toBe(edited.state);
    expect(late.state).toEqual(beforeLateCommit);

    const latestDesign = edited.state.designs[candidate.designId];
    const conflictedPreflight = preflightAnalysisRun(edited.state, {
      designId: latestDesign.designId,
      expectedDesignRevision: latestDesign.revision,
      expectedProjectRevision: edited.state.projectRevision,
      expectedFlightCaseRevision: edited.state.flightCase.revision + 1,
      expectedConstraintsRevision: edited.state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast',
    });
    expect(conflictedPreflight.ok).toBe(false);
    if (!conflictedPreflight.ok) expect(conflictedPreflight.error.code).toBe('REVISION_CONFLICT');
  });

  it('rejects malformed or semantically inconsistent snapshots without mutating state', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const validSnapshot = buildAnalysisSnapshot(state, design, 'fast');
    const stateBefore = structuredClone(state);
    const cases: Array<{ name: string; mutate: (snapshot: AnalysisSnapshot) => void }> = [
      { name: 'wrong solver version', mutate: (snapshot) => { snapshot.solverVersion = 'wrong'; } },
      { name: 'oversized analysis identifier', mutate: (snapshot) => { snapshot.analysisId = `ana_${'A'.repeat(10_000)}` as AnalysisSnapshot['analysisId']; } },
      { name: 'zero iterations', mutate: (snapshot) => { snapshot.convergence.iterations = 0; } },
      { name: 'negative equilibrium residual', mutate: (snapshot) => { snapshot.convergence.equilibriumResidual = -1; } },
      { name: 'excessive load change', mutate: (snapshot) => { snapshot.convergence.relativeLoadChange = 1; } },
      { name: 'coefficient inconsistent with lift and qS', mutate: (snapshot) => { snapshot.metrics.liftCoefficient *= 1.1; } },
      { name: 'negative induced-drag coefficient', mutate: (snapshot) => { snapshot.metrics.inducedDragCoefficientEstimate = -1; } },
      { name: 'angle outside trim bracket', mutate: (snapshot) => { snapshot.metrics.trimmedAlphaDeg = 999; } },
      { name: 'negative stress', mutate: (snapshot) => { snapshot.metrics.maxBendingStressPa = -1; } },
      {
        name: 'forged structural mass with matching constraint semantics',
        mutate: (snapshot) => {
          snapshot.metrics.structuralMassKg = 1;
          snapshot.constraints = evaluateDesignConstraints(
            state,
            design,
            snapshot.fidelity,
            snapshot.status,
            snapshot.metrics.structuralMassKg,
            snapshot.metrics.inducedDragN,
            snapshot.metrics.minYieldMargin,
            snapshot.metrics.tipDeflectionM,
          );
        },
      },
      {
        name: 'forged aggregate yield metrics with matching constraint semantics',
        mutate: (snapshot) => {
          snapshot.metrics.minYieldMargin = 999;
          snapshot.metrics.maxBendingStressPa = 0;
          snapshot.metrics.maxTorsionalShearPa = 0;
          snapshot.constraints = evaluateDesignConstraints(
            state,
            design,
            snapshot.fidelity,
            snapshot.status,
            snapshot.metrics.structuralMassKg,
            snapshot.metrics.inducedDragN,
            snapshot.metrics.minYieldMargin,
            snapshot.metrics.tipDeflectionM,
          );
        },
      },
      { name: 'nonzero tip circulation', mutate: (snapshot) => { snapshot.stations.at(-1)!.circulationM2s = 1; } },
      { name: 'forged station downwash angle', mutate: (snapshot) => { snapshot.stations[1].inducedAngleDeg += 1; } },
      { name: 'retired 3D flow diagnostic', mutate: (snapshot) => { (snapshot as unknown as Record<string, unknown>).flowDiagnostic = {}; } },
      {
        name: 'partial station records',
        mutate: (snapshot) => { (snapshot as unknown as { stations: unknown }).stations = [{ eta: 0 }, { eta: 1 }]; },
      },
      { name: 'stored stale constraint state', mutate: (snapshot) => { snapshot.constraints[0].state = 'stale'; } },
      {
        name: 'constraint outcome inconsistent with trusted metrics',
        mutate: (snapshot) => {
          const constraint = snapshot.constraints.find((item) => item.key === 'yield_margin');
          if (!constraint) throw new Error('Missing yield-margin constraint fixture.');
          constraint.actual = 999;
          constraint.state = 'fail';
        },
      },
      { name: 'missing mandatory warnings', mutate: (snapshot) => { snapshot.warnings = ['Incomplete warning set']; } },
      { name: 'null metrics record', mutate: (snapshot) => { (snapshot as unknown as { metrics: unknown }).metrics = null; } },
      { name: 'unexpected top-level key', mutate: (snapshot) => { (snapshot as unknown as Record<string, unknown>).extra = true; } },
    ];

    for (const testCase of cases) {
      const snapshot = structuredClone(validSnapshot);
      testCase.mutate(snapshot);
      const transition = commitAnalysisSnapshot(state, runRequest(state), snapshot, 'solver');
      expect.soft(transition.result.ok, testCase.name).toBe(false);
      if (!transition.result.ok) expect.soft(transition.result.error.code, testCase.name).toBe('ANALYSIS_FAILED');
      expect.soft(transition.state, testCase.name).toBe(state);
      expect.soft(state, testCase.name).toEqual(stateBefore);
      expect.soft(Object.keys(state.analyses), testCase.name).toHaveLength(0);
    }
  });

  it('accepts a no-op update as unchanged without invalidating a current analysis', () => {
    const branch = branchCandidate(createDefaultProject());
    const candidate = branch.state.designs[branch.designId];
    const snapshot = buildAnalysisSnapshot(branch.state, candidate, 'fast');
    const committed = commitAnalysisSnapshot(branch.state, runRequest(branch.state), snapshot, 'solver');
    expect(committed.result.ok).toBe(true);
    if (!committed.result.ok) return;
    const analyzedCandidate = committed.state.designs[candidate.designId];
    expect(designAnalysisFreshness(committed.state, analyzedCandidate)).toBe('current');

    const idempotencyKey = createIdempotencyKey();
    const noOp = updateWingStructure(committed.state, {
      designId: analyzedCandidate.designId,
      expectedDesignRevision: analyzedCandidate.revision,
      idempotencyKey,
      patch: { skinThicknessMm: analyzedCandidate.structure.skinThicknessMm },
    }, 'agent');

    expect(noOp.result).toMatchObject({
      ok: true,
      replayed: false,
      data: {
        outcome: 'unchanged',
        previousDesignRevision: analyzedCandidate.revision,
        newDesignRevision: analyzedCandidate.revision,
        projectRevision: committed.state.projectRevision,
        changedFields: {},
        invalidatedAnalysisId: null,
        invalidatedComparisonDesignIds: [],
        analysisFreshness: 'current',
        activityId: null,
      },
    });
    expect(noOp.state).not.toBe(committed.state);
    expect(noOp.state.designs).toEqual(committed.state.designs);
    expect(noOp.state.activities).toEqual(committed.state.activities);
    expect(noOp.state.projectRevision).toBe(committed.state.projectRevision);
    expect(designAnalysisFreshness(noOp.state, noOp.state.designs[candidate.designId])).toBe('current');
    expect(noOp.state.analyses[snapshot.analysisId]).toEqual(committed.state.analyses[snapshot.analysisId]);

    const replay = updateWingStructure(noOp.state, {
      designId: analyzedCandidate.designId,
      expectedDesignRevision: analyzedCandidate.revision,
      idempotencyKey,
      patch: { skinThicknessMm: analyzedCandidate.structure.skinThicknessMm },
    }, 'agent');
    expect(replay.result).toMatchObject({ ok: true, replayed: true, data: { outcome: 'unchanged' } });
    expect(replay.state).toBe(noOp.state);

    const mismatched = updateWingStructure(noOp.state, {
      designId: analyzedCandidate.designId,
      expectedDesignRevision: analyzedCandidate.revision,
      idempotencyKey,
      patch: { skinThicknessMm: analyzedCandidate.structure.skinThicknessMm + 0.1 },
    }, 'agent');
    expect(mismatched.result.ok).toBe(false);
    if (!mismatched.result.ok) expect(mismatched.result.error.code).toBe('DUPLICATE_MUTATION_MISMATCH');
  });

  it('accepts re-selecting the current Baseline as unchanged while preserving revision checks', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const idempotencyKey = createIdempotencyKey();
    const unchanged = setBaselineDesign(state, {
      designId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: baseline.revision,
      idempotencyKey,
    }, 'agent');

    expect(unchanged.result).toMatchObject({
      ok: true,
      replayed: false,
      data: {
        outcome: 'unchanged',
        baselineDesignId: baseline.designId,
        baselineDesignRevision: baseline.revision,
        previousBaselineDesignId: baseline.designId,
        previousBaselineDesignRevision: baseline.revision,
        projectRevision: state.projectRevision,
        invalidatedAnalysisIds: [],
        activityId: null,
      },
    });
    expect(unchanged.state.designs).toEqual(state.designs);
    expect(unchanged.state.activities).toEqual(state.activities);
    expect(unchanged.state.projectRevision).toBe(state.projectRevision);

    const replay = setBaselineDesign(unchanged.state, {
      designId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedDesignRevision: baseline.revision,
      idempotencyKey,
    }, 'agent');
    expect(replay.result).toMatchObject({ ok: true, replayed: true, data: { outcome: 'unchanged' } });

    const stale = setBaselineDesign(state, {
      designId: baseline.designId,
      expectedProjectRevision: state.projectRevision + 1,
      expectedDesignRevision: baseline.revision,
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    expect(stale.result.ok).toBe(false);
    if (!stale.result.ok) expect(stale.result.error.code).toBe('REVISION_CONFLICT');
  });

  it('distinguishes a design-capacity limit from an invalid workspace role state', () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    for (let index = 1; index < MAX_DESIGNS; index += 1) {
      const created = createCandidateVariant(state, {
        sourceDesignId: baseline.designId,
        expectedProjectRevision: state.projectRevision,
        expectedSourceDesignRevision: baseline.revision,
        candidateLabel: `Candidate ${index}`,
        idempotencyKey: createIdempotencyKey(),
      }, 'agent');
      expect(created.result.ok).toBe(true);
      state = created.state;
    }
    const overLimit = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'One too many',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    expect(overLimit.result.ok).toBe(false);
    if (!overLimit.result.ok) expect(overLimit.result.error.code).toBe('DESIGN_LIMIT_REACHED');

    const invalidWorkspace = structuredClone(createDefaultProject());
    const invalidTarget = invalidWorkspace.designs[invalidWorkspace.activeDesignId];
    invalidTarget.kind = 'candidate';
    const invalidRoleChange = setBaselineDesign(invalidWorkspace, {
      designId: invalidTarget.designId,
      expectedProjectRevision: invalidWorkspace.projectRevision,
      expectedDesignRevision: invalidTarget.revision,
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    expect(invalidRoleChange.result.ok).toBe(false);
    if (!invalidRoleChange.result.ok) expect(invalidRoleChange.result.error.code).toBe('WORKSPACE_STATE_INVALID');
  });

  it('isolates committed snapshots, returned metrics, and idempotent replay payloads', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const snapshot = buildAnalysisSnapshot(state, design, 'fast');
    const request = runRequest(state);
    const transition = commitAnalysisSnapshot(state, request, snapshot, 'solver');
    expect(transition.result.ok).toBe(true);
    if (!transition.result.ok) return;

    const analysisId = transition.result.data.analysisId;
    const expectedLiftN = transition.state.analyses[analysisId].metrics.liftN;
    snapshot.metrics.liftN = -1;
    transition.result.data.metrics.liftN = -2;
    expect(transition.state.analyses[analysisId].metrics.liftN).toBe(expectedLiftN);

    const replay = commitAnalysisSnapshot(transition.state, request, snapshot, 'solver');
    expect(replay.result.ok && replay.result.replayed).toBe(true);
    if (!replay.result.ok) return;
    expect(replay.result.data.metrics.liftN).toBe(expectedLiftN);
    replay.result.data.metrics.liftN = -3;

    const secondReplay = commitAnalysisSnapshot(transition.state, request, snapshot, 'solver');
    expect(secondReplay.result.ok).toBe(true);
    if (!secondReplay.result.ok) return;
    expect(secondReplay.result.data.metrics.liftN).toBe(expectedLiftN);
    expect(transition.state.analyses[analysisId].metrics.liftN).toBe(expectedLiftN);
  });

  it('isolates update result diffs from activity and idempotency state', () => {
    const branch = branchCandidate(createDefaultProject());
    const candidate = branch.state.designs[branch.designId];
    const request = {
      designId: candidate.designId,
      expectedDesignRevision: candidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7 },
    };
    const first = updateWingStructure(branch.state, request, 'agent');
    expect(first.result.ok).toBe(true);
    if (!first.result.ok) return;
    const expectedActivity = structuredClone(first.state.activities[0]);
    first.result.data.changedFields['structure.skinThicknessMm'].to = 999;
    expect(first.state.activities[0]).toEqual(expectedActivity);
    expect(first.state.designs[candidate.designId].structure.skinThicknessMm).toBe(1.7);

    const replay = updateWingStructure(first.state, request, 'agent');
    expect(replay.result.ok && replay.result.replayed).toBe(true);
    if (!replay.result.ok) return;
    expect(replay.result.data.changedFields['structure.skinThicknessMm'].to).toBe(1.7);
    replay.result.data.changedFields['structure.skinThicknessMm'].to = 888;

    const secondReplay = updateWingStructure(first.state, request, 'agent');
    expect(secondReplay.result.ok).toBe(true);
    if (!secondReplay.result.ok) return;
    expect(secondReplay.result.data.changedFields['structure.skinThicknessMm'].to).toBe(1.7);
    expect(first.state.activities[0]).toEqual(expectedActivity);
  });

  it('rejects the thin-wall-invalid geometry/structure combination through either update path', () => {
    const thinTipGeometry = {
      spanM: 4,
      rootChordM: 1,
      tipChordM: 0.3,
      rootTwistDeg: 0,
      tipTwistDeg: 0,
      nacaCode: '0012',
    };
    const thickGauges = { skinThicknessMm: 6, frontWebThicknessMm: 8, rearWebThicknessMm: 8 };

    const geometryFirst = branchCandidate(createDefaultProject(), 'Geometry first');
    const firstDesign = geometryFirst.state.designs[geometryFirst.designId];
    const geometryUpdate = updateWingGeometry(geometryFirst.state, {
      designId: firstDesign.designId,
      expectedDesignRevision: firstDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: thinTipGeometry,
    }, 'agent');
    expect(geometryUpdate.result.ok).toBe(true);
    if (!geometryUpdate.result.ok) return;
    const geometryUpdatedDesign = geometryUpdate.state.designs[firstDesign.designId];
    const beforeRejectedStructure = structuredClone(geometryUpdate.state);
    const rejectedStructure = updateWingStructure(geometryUpdate.state, {
      designId: geometryUpdatedDesign.designId,
      expectedDesignRevision: geometryUpdatedDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: thickGauges,
    }, 'agent');
    expect(rejectedStructure.result.ok).toBe(false);
    if (!rejectedStructure.result.ok) {
      expect(rejectedStructure.result.error.code).toBe('VALIDATION_ERROR');
      expect(rejectedStructure.result.error.issues?.some((issue) => /thin-wall/i.test(issue.reason))).toBe(true);
    }
    expect(rejectedStructure.state).toBe(geometryUpdate.state);
    expect(rejectedStructure.state).toEqual(beforeRejectedStructure);

    const structureFirst = branchCandidate(createDefaultProject(), 'Structure first');
    const secondDesign = structureFirst.state.designs[structureFirst.designId];
    const structureUpdate = updateWingStructure(structureFirst.state, {
      designId: secondDesign.designId,
      expectedDesignRevision: secondDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: thickGauges,
    }, 'agent');
    expect(structureUpdate.result.ok).toBe(true);
    if (!structureUpdate.result.ok) return;
    const structureUpdatedDesign = structureUpdate.state.designs[secondDesign.designId];
    const beforeRejectedGeometry = structuredClone(structureUpdate.state);
    const rejectedGeometry = updateWingGeometry(structureUpdate.state, {
      designId: structureUpdatedDesign.designId,
      expectedDesignRevision: structureUpdatedDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: thinTipGeometry,
    }, 'agent');
    expect(rejectedGeometry.result.ok).toBe(false);
    if (!rejectedGeometry.result.ok) {
      expect(rejectedGeometry.result.error.code).toBe('VALIDATION_ERROR');
      expect(rejectedGeometry.result.error.issues?.some((issue) => /thin-wall/i.test(issue.reason))).toBe(true);
    }
    expect(rejectedGeometry.state).toBe(structureUpdate.state);
    expect(rejectedGeometry.state).toEqual(beforeRejectedGeometry);
  });
});
