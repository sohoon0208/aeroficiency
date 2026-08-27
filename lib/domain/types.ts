export type DesignId = `des_${string}`;
export type AnalysisId = `ana_${string}`;
export type ActivityId = `act_${string}`;
export type Actor = 'human' | 'agent' | 'solver' | 'system';
export type DesignKind = 'baseline' | 'candidate';
export type AnalysisStatus = 'converged' | 'not_converged' | 'failed';
export type AnalysisFreshness = 'current' | 'stale' | 'unavailable';
export type ConstraintState = 'pass' | 'fail' | 'unavailable' | 'stale';
export type SolverFidelity = 'fast' | 'standard';

export interface WingGeometry {
  spanM: number;
  rootChordM: number;
  tipChordM: number;
  rootTwistDeg: number;
  tipTwistDeg: number;
  nacaCode: string;
}

export interface WingStructure {
  skinThicknessMm: number;
  frontWebThicknessMm: number;
  rearWebThicknessMm: number;
  frontSparXOverC: number;
  rearSparXOverC: number;
  elasticAxisXOverC: number;
  material: 'aluminum_2024_t3';
}

export interface MaterialDefinition {
  key: WingStructure['material'];
  label: string;
  densityKgM3: number;
  youngsModulusPa: number;
  poissonRatio: number;
  shearModulusPa: number;
  yieldStrengthPa: number;
}

export interface FlightCase {
  revision: number;
  mode: 'target_lift';
  targetLiftN: number;
  velocityMps: number;
  altitudeM: number;
  airDensityKgM3: number;
  dynamicViscosityPaS: number;
}

export interface DesignConstraints {
  revision: number;
  minMassReductionPct: number;
  minYieldMargin: number;
  maxTipDeflectionM: number;
  maxInducedDragIncreasePct: number;
}

export interface WingDesign {
  designId: DesignId;
  label: string;
  kind: DesignKind;
  revision: number;
  sourceDesignId: DesignId | null;
  sourceDesignRevision: number | null;
  geometry: WingGeometry;
  structure: WingStructure;
  latestAnalysisId: AnalysisId | null;
  createdAt: string;
  updatedAt: string;
}

export interface SpanStationResult {
  eta: number;
  yM: number;
  chordM: number;
  geometricTwistDeg: number;
  liftPerSpanNpm: number;
  circulationM2s: number;
  shearN: number;
  bendingMomentNm: number;
  torqueNm: number;
  deflectionM: number;
  elasticTwistDeg: number;
  bendingStiffnessNm2: number;
  torsionalStiffnessNm2: number;
  vonMisesStressPa: number;
  yieldMargin: number | null;
}

export interface AnalysisConvergence {
  iterations: number;
  equilibriumResidual: number;
  twistChangeDeg: number;
  relativeLoadChange: number;
  targetLiftErrorPct: number;
}

export interface AnalysisMetrics {
  wingAreaM2: number;
  aspectRatio: number;
  structuralMassKg: number;
  liftN: number;
  liftCoefficient: number;
  inducedDragN: number;
  inducedDragCoefficientEstimate: number | null;
  spanEfficiencyEstimate: number | null;
  trimmedAlphaDeg: number;
  tipDeflectionM: number;
  tipElasticTwistDeg: number;
  minYieldMargin: number;
  maxBendingStressPa: number;
  maxTorsionalShearPa: number;
}

export interface ConstraintResult {
  key: 'mass_reduction' | 'yield_margin' | 'tip_deflection' | 'induced_drag' | 'convergence';
  label: string;
  state: ConstraintState;
  actual: number | null;
  limit: number | null;
  unit: string;
  detail: string;
}

export interface AnalysisSnapshot {
  analysisId: AnalysisId;
  designId: DesignId;
  status: AnalysisStatus;
  designRevision: number;
  flightCaseRevision: number;
  constraintsRevision: number;
  fidelity: SolverFidelity;
  solverVersion: string;
  inputFingerprint: string;
  createdAt: string;
  convergence: AnalysisConvergence;
  metrics: AnalysisMetrics;
  stations: SpanStationResult[];
  constraints: ConstraintResult[];
  warnings: string[];
}

export interface ActivityEvent {
  activityId: ActivityId;
  actor: Actor;
  operation: string;
  targetDesignId: DesignId | null;
  fromRevision: number | null;
  toRevision: number | null;
  summary: string;
  changedFields: Record<string, { from: number | string; to: number | string; unit?: string }>;
  analysisId: AnalysisId | null;
  status: 'success' | 'failed' | 'aborted';
  timestamp: string;
}

export interface IdempotencyRecord {
  tool: string;
  requestHash: string;
  result: unknown;
  committedAt: string;
}

export interface ProjectState {
  projectId: string;
  projectRevision: number;
  activeDesignId: DesignId;
  selectedAnalysisId: AnalysisId | null;
  selectedEta: number;
  flightCase: FlightCase;
  constraints: DesignConstraints;
  designs: Record<DesignId, WingDesign>;
  analyses: Record<AnalysisId, AnalysisSnapshot>;
  activities: ActivityEvent[];
  idempotencyLedger: Record<string, IdempotencyRecord>;
  solverVersion: string;
}

export interface RevisionExpectation {
  designRevision: number;
  flightCaseRevision?: number;
  constraintsRevision?: number;
}

export type DomainErrorCode =
  | 'VALIDATION_ERROR'
  | 'DESIGN_NOT_FOUND'
  | 'ANALYSIS_NOT_FOUND'
  | 'BASELINE_PROTECTED'
  | 'REVISION_CONFLICT'
  | 'DUPLICATE_MUTATION_MISMATCH'
  | 'ANALYSIS_REQUIRED'
  | 'STALE_ANALYSIS'
  | 'ANALYSIS_FAILED'
  | 'ANALYSIS_DID_NOT_CONVERGE'
  | 'ABORTED'
  | 'TOOL_UNAVAILABLE';

export interface DomainIssue {
  path: string;
  reason: string;
}

export interface DomainFailure {
  ok: false;
  error: {
    code: DomainErrorCode;
    message: string;
    retryable: boolean;
    safeNextAction: string;
    issues?: DomainIssue[];
    current?: {
      designRevision?: number;
      flightCaseRevision?: number;
      constraintsRevision?: number;
    };
    analysisId?: AnalysisId;
    committed?: boolean;
  };
}

export interface DomainSuccess<T> {
  ok: true;
  replayed: boolean;
  data: T;
}

export type DomainResult<T> = DomainSuccess<T> | DomainFailure;
