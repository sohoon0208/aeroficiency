import { describe, expect, it } from 'vitest';
import {
  commitAnalysisSnapshot,
  createCandidateVariant,
  updateWingStructure,
} from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { AnalysisMetrics, ProjectState, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

function commitStandardAnalysis(state: ProjectState, design: WingDesign) {
  const snapshot = buildAnalysisSnapshot(state, design, 'standard');
  const transition = commitAnalysisSnapshot(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  }, snapshot, 'solver');

  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return { state: transition.state, snapshot };
}

function runMassStudyWorkflow() {
  let state = createDefaultProject();
  const baseline = state.designs[state.activeDesignId];
  const baselineRun = commitStandardAnalysis(state, baseline);
  state = baselineRun.state;

  const branch = createCandidateVariant(state, {
    sourceDesignId: baseline.designId,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Agent mass study',
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  state = branch.state;

  const candidate = state.designs[branch.result.data.designId];
  const structureUpdate = updateWingStructure(state, {
    designId: candidate.designId,
    expectedDesignRevision: candidate.revision,
    idempotencyKey: createIdempotencyKey(),
    patch: {
      skinThicknessMm: 1.65,
      frontWebThicknessMm: 2,
      rearWebThicknessMm: 2,
    },
  }, 'agent');
  if (!structureUpdate.result.ok) throw new Error(structureUpdate.result.error.message);
  state = structureUpdate.state;

  const updatedCandidate = state.designs[candidate.designId];
  const candidateRun = commitStandardAnalysis(state, updatedCandidate);
  const passedConstraints = candidateRun.snapshot.constraints
    .filter((constraint) => constraint.state === 'pass')
    .map((constraint) => constraint.key)
    .sort();

  return {
    baselineMetrics: baselineRun.snapshot.metrics,
    candidateMetrics: candidateRun.snapshot.metrics,
    passedConstraints,
    status: candidateRun.snapshot.status,
  };
}

function stableMetricVector(metrics: AnalysisMetrics) {
  return {
    structuralMassKg: metrics.structuralMassKg,
    inducedDragN: metrics.inducedDragN,
    tipDeflectionM: metrics.tipDeflectionM,
    tipElasticTwistDeg: metrics.tipElasticTwistDeg,
    minYieldMargin: metrics.minYieldMargin,
    trimmedAlphaDeg: metrics.trimmedAlphaDeg,
  };
}

describe('deterministic solver-domain fixture', () => {
  it('reproduces the baseline-to-candidate numerical workflow ten out of ten times', () => {
    const runs = Array.from({ length: 10 }, () => runMassStudyWorkflow());
    const expectedConstraintKeys = [
      'convergence',
      'induced_drag',
      'mass_reduction',
      'tip_deflection',
      'yield_margin',
    ];

    for (const run of runs) {
      expect(run.status).toBe('converged');
      expect(run.passedConstraints).toEqual(expectedConstraintKeys);
      expect(stableMetricVector(run.baselineMetrics)).toEqual(stableMetricVector(runs[0].baselineMetrics));
      expect(stableMetricVector(run.candidateMetrics)).toEqual(stableMetricVector(runs[0].candidateMetrics));
    }

    const fixture = runs[0];
    expect(fixture.candidateMetrics.structuralMassKg).toBeCloseTo(109.0991790496317, 9);
    expect(fixture.candidateMetrics.inducedDragN).toBeCloseTo(851.2300805254258, 9);
    expect(fixture.candidateMetrics.tipDeflectionM).toBeCloseTo(0.11883217173082616, 12);
    expect(fixture.candidateMetrics.tipElasticTwistDeg).toBeCloseTo(0.19373222630717152, 12);
    expect(fixture.candidateMetrics.minYieldMargin).toBeCloseTo(3.439588805384481, 12);
    expect(fixture.candidateMetrics.trimmedAlphaDeg).toBeCloseTo(6.199361801147461, 12);
    const massReductionPct = 100 * (fixture.baselineMetrics.structuralMassKg - fixture.candidateMetrics.structuralMassKg)
      / fixture.baselineMetrics.structuralMassKg;
    const dragChangePct = 100 * (fixture.candidateMetrics.inducedDragN - fixture.baselineMetrics.inducedDragN)
      / fixture.baselineMetrics.inducedDragN;
    expect(massReductionPct).toBeCloseTo(8.493002215773709, 10);
    expect(dragChangePct).toBeCloseTo(-0.014198717561214946, 12);
  });
});
