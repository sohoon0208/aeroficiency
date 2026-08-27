import type { MaterialDefinition } from './types';

export const DESIGN_LIMITS = {
  spanM: [4, 16],
  rootChordM: [0.8, 4],
  tipChordM: [0.3, 3],
  rootTwistDeg: [0, 0],
  tipTwistDeg: [-6, 3],
  skinThicknessMm: [1.2, 6],
  frontWebThicknessMm: [1.5, 8],
  rearWebThicknessMm: [1.5, 8],
  frontSparXOverC: [0.12, 0.35],
  rearSparXOverC: [0.55, 0.8],
  elasticAxisXOverC: [0.2, 0.55],
  taperRatio: [0.2, 1],
  aspectRatio: [4, 14],
  targetLiftN: [2_000, 120_000],
  velocityMps: [20, 85],
  altitudeM: [0, 11_000],
} as const;

export const ALUMINUM_2024_T3: MaterialDefinition = {
  key: 'aluminum_2024_t3',
  label: 'Aluminum 2024-T3',
  densityKgM3: 2_780,
  youngsModulusPa: 73.1e9,
  poissonRatio: 0.33,
  shearModulusPa: 73.1e9 / (2 * (1 + 0.33)),
  yieldStrengthPa: 345e6,
};

export const SOLVER_VERSION = 'aerociency-0.2.0';
export const MAX_ACTIVITY_EVENTS = 80;
export const MAX_DESIGNS = 6;
export const MAX_ANALYSES = 24;
export const MAX_IDEMPOTENCY_RECORDS = 120;

export const MODEL_WARNINGS = [
  'Preliminary low-order analysis; not for certification.',
  'Inviscid, incompressible, attached-flow model.',
  'Profile drag and stall are omitted.',
  'Camber uses a thin-airfoil zero-lift correction.',
  'Airfoil thickness does not influence the aerodynamic lattice.',
  'Airfoil pitching moment is omitted.',
  'Buckling, fatigue, and local failure modes are omitted.',
  'Bending deformation is not coupled back to aerodynamics.',
  'Induced drag is a discrete-wake estimate, not total drag.',
] as const;

export const SOLVER_SETTINGS = {
  fast: { fullSpanPanelCount: 16 },
  standard: { fullSpanPanelCount: 32 },
  vortexCoreRatio: 1e-6,
  alphaBracketDeg: [-8, 12],
  trimMaxIterations: 48,
  trimRelativeLiftTolerance: 1e-7,
  trimAlphaToleranceRad: 1e-8,
  couplingMaxIterations: 40,
  relaxationFactor: 0.35,
  equilibriumToleranceRad: 2e-5,
  iterateChangeToleranceRad: 1e-5,
  relativeLoadTolerance: 2e-4,
  coupledLiftTolerance: 1e-5,
  modelFlags: {
    zeroSweep: true,
    zeroDihedral: true,
    torsionCoupled: true,
    bendingCoupled: false,
    targetLiftTrim: true,
    wakeOnlyInducedDrag: true,
  },
} as const;
