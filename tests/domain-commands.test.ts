import { describe, expect, it } from 'vitest';
import {
  commitAnalysisSnapshot,
  createCandidateVariant,
  preflightAnalysisRun,
  updateWingGeometry,
  updateWingStructure,
} from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { designAnalysisFreshness, validateStructure } from '@/lib/domain/validation';
import type { AnalysisSnapshot, ProjectState, SolverFidelity } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

function runRequest(state: ProjectState, fidelity: SolverFidelity = 'fast') {
  const design = state.designs[state.activeDesignId];
  return {
    designId: design.designId,
    expectedDesignRevision: design.revision,
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

  it('protects the baseline, rejects stale revisions, and rejects idempotency-key payload drift', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const protectedUpdate = updateWingGeometry(state, {
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -1.5 },
    }, 'human');
    expect(protectedUpdate.result.ok).toBe(false);
    if (!protectedUpdate.result.ok) expect(protectedUpdate.result.error.code).toBe('BASELINE_PROTECTED');
    expect(protectedUpdate.state).toBe(state);

    const key = createIdempotencyKey();
    const firstBranch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Candidate A',
      idempotencyKey: key,
    }, 'agent');
    expect(firstBranch.result.ok).toBe(true);
    const mismatchedReplay = createCandidateVariant(firstBranch.state, {
      sourceDesignId: baseline.designId,
      expectedSourceDesignRevision: baseline.revision,
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

  it('rejects a no-op update without invalidating a current analysis', () => {
    const branch = branchCandidate(createDefaultProject());
    const candidate = branch.state.designs[branch.designId];
    const snapshot = buildAnalysisSnapshot(branch.state, candidate, 'fast');
    const committed = commitAnalysisSnapshot(branch.state, runRequest(branch.state), snapshot, 'solver');
    expect(committed.result.ok).toBe(true);
    if (!committed.result.ok) return;
    const analyzedCandidate = committed.state.designs[candidate.designId];
    expect(designAnalysisFreshness(committed.state, analyzedCandidate)).toBe('current');

    const noOp = updateWingStructure(committed.state, {
      designId: analyzedCandidate.designId,
      expectedDesignRevision: analyzedCandidate.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: analyzedCandidate.structure.skinThicknessMm },
    }, 'agent');

    expect(noOp.result.ok).toBe(false);
    if (!noOp.result.ok) expect(noOp.result.error.code).toBe('VALIDATION_ERROR');
    expect(noOp.state).toBe(committed.state);
    expect(designAnalysisFreshness(noOp.state, noOp.state.designs[candidate.designId])).toBe('current');
    expect(noOp.state.analyses[snapshot.analysisId]).toEqual(committed.state.analyses[snapshot.analysisId]);
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
