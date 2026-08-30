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
    expectedProjectRevision: state.projectRevision,
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
    expectedProjectRevision: state.projectRevision,
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
    profileDragEstimateN: metrics.profileDragEstimateN,
    combinedWingDragEstimateN: metrics.combinedWingDragEstimateN,
    estimatedWingLiftToDrag: metrics.estimatedWingLiftToDrag,
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
    expect(fixture.candidateMetrics.structuralMassKg).toBeCloseTo(109.13377350384792, 9);
    expect(fixture.candidateMetrics.inducedDragN).toBeCloseTo(856.8669026323952, 9);
    expect(fixture.candidateMetrics.profileDragEstimateN).toBeCloseTo(550.2345064337524, 9);
    expect(fixture.candidateMetrics.combinedWingDragEstimateN).toBeCloseTo(1407.1014090661474, 9);
    expect(fixture.candidateMetrics.estimatedWingLiftToDrag).toBeCloseTo(22.45751384898774, 12);
    expect(fixture.candidateMetrics.tipDeflectionM).toBeCloseTo(0.11896830161683179, 12);
    expect(fixture.candidateMetrics.tipElasticTwistDeg).toBeCloseTo(0.053642939905364034, 12);
    expect(fixture.candidateMetrics.minYieldMargin).toBeCloseTo(3.4541592255035125, 12);
    expect(fixture.candidateMetrics.trimmedAlphaDeg).toBeCloseTo(5.853485584259032, 12);
    const massReductionPct = 100 * (fixture.baselineMetrics.structuralMassKg - fixture.candidateMetrics.structuralMassKg)
      / fixture.baselineMetrics.structuralMassKg;
    const dragChangePct = 100 * (fixture.candidateMetrics.inducedDragN - fixture.baselineMetrics.inducedDragN)
      / fixture.baselineMetrics.inducedDragN;
    expect(massReductionPct).toBeCloseTo(8.493188692216165, 10);
    expect(dragChangePct).toBeCloseTo(-0.003271683370555275, 12);
  }, 40_000);
});
