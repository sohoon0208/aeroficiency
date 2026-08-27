import { ALUMINUM_2024_T3, SOLVER_VERSION } from './limits';
import type { ProjectState, WingDesign } from './types';

export const FIXED_IDS = {
  project: 'prj_00000000000000000000000001',
  baseline: 'des_00000000000000000000000001',
  initialActivity: 'act_00000000000000000000000001',
} as const;

export const DEMO_CREATED_AT = '2026-08-27T00:00:00.000Z';

export function createBaselineDesign(): WingDesign {
  return {
    designId: FIXED_IDS.baseline,
    label: 'Baseline',
    kind: 'baseline',
    revision: 1,
    sourceDesignId: null,
    sourceDesignRevision: null,
    geometry: {
      spanM: 12,
      rootChordM: 2.4,
      tipChordM: 1.08,
      rootTwistDeg: 0,
      tipTwistDeg: -2,
      nacaCode: '2412',
    },
    structure: {
      skinThicknessMm: 1.8,
      frontWebThicknessMm: 2.2,
      rearWebThicknessMm: 2.2,
      frontSparXOverC: 0.2,
      rearSparXOverC: 0.65,
      elasticAxisXOverC: 0.38,
      material: ALUMINUM_2024_T3.key,
    },
    latestAnalysisId: null,
    createdAt: DEMO_CREATED_AT,
    updatedAt: DEMO_CREATED_AT,
  };
}

export function createDefaultProject(): ProjectState {
  const baseline = createBaselineDesign();
  return {
    projectId: FIXED_IDS.project,
    projectRevision: 1,
    activeDesignId: baseline.designId,
    selectedAnalysisId: null,
    selectedEta: 0.5,
    flightCase: {
      revision: 1,
      mode: 'target_lift',
      targetLiftN: 31_600,
      velocityMps: 64,
      altitudeM: 0,
      airDensityKgM3: 1.225,
      dynamicViscosityPaS: 1.7894e-5,
    },
    constraints: {
      revision: 1,
      minMassReductionPct: 5,
      minYieldMargin: 1.5,
      maxTipDeflectionM: 0.6,
      maxInducedDragIncreasePct: 0,
    },
    designs: { [baseline.designId]: baseline },
    analyses: {},
    activities: [
      {
        activityId: FIXED_IDS.initialActivity,
        actor: 'system',
        operation: 'reset_demo',
        targetDesignId: baseline.designId,
        fromRevision: null,
        toRevision: baseline.revision,
        summary: 'Deterministic demo workspace created.',
        changedFields: {},
        analysisId: null,
        status: 'success',
        timestamp: DEMO_CREATED_AT,
      },
    ],
    idempotencyLedger: {},
    solverVersion: SOLVER_VERSION,
  };
}
