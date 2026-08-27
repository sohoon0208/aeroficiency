import { describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { designAnalysisFreshness } from '@/lib/domain/validation';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

describe('immutable analysis snapshots', () => {
  it('builds and commits a current, finite baseline result', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const snapshot = buildAnalysisSnapshot(state, design, 'standard');
    expect(snapshot.status).toBe('converged');
    expect(snapshot.metrics.structuralMassKg).toBeGreaterThan(0);
    expect(snapshot.metrics.inducedDragN).toBeGreaterThan(0);
    expect(snapshot.stations.every((station) => Number.isFinite(station.yieldMargin ?? 0))).toBe(true);
    const tip = snapshot.stations.at(-1)!;
    expect(tip.eta).toBe(1);
    expect(tip.liftPerSpanNpm).toBe(0);
    expect(tip.circulationM2s).toBe(0);
    expect(snapshot.stations.at(-2)!.liftPerSpanNpm).toBeGreaterThan(0);
    expect(snapshot.stations.at(-2)!.circulationM2s).toBeGreaterThan(0);
    const transition = commitAnalysisSnapshot(state, {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, snapshot, 'human');
    expect(transition.result.ok).toBe(true);
    expect(designAnalysisFreshness(transition.state, transition.state.designs[design.designId])).toBe('current');
    expect(snapshot.constraints.find((constraint) => constraint.key === 'mass_reduction')?.state).toBe('unavailable');
  });

  it('commits a non-converged diagnostic snapshot without treating constraints as passed', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
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
    const request = {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'fast' as const,
    };
    const transition = commitAnalysisSnapshot(state, request, snapshot, 'solver');
    expect(transition.result.ok).toBe(false);
    if (!transition.result.ok) {
      expect(transition.result.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
      expect(transition.result.error.committed).toBe(true);
      expect(transition.result.error.analysisId).toBe(snapshot.analysisId);
    }
    expect(transition.state.analyses[snapshot.analysisId].status).toBe('not_converged');
    expect(transition.state.analyses[snapshot.analysisId].constraints.every((constraint) => constraint.state === 'unavailable')).toBe(true);
    expect(transition.state.designs[design.designId].latestAnalysisId).toBeNull();
    const replay = commitAnalysisSnapshot(transition.state, request, snapshot, 'solver');
    expect(replay.result.ok).toBe(false);
    if (!replay.result.ok) expect(replay.result.error.code).toBe('ANALYSIS_DID_NOT_CONVERGE');
    expect(Object.keys(replay.state.analyses)).toHaveLength(1);
  });
});
