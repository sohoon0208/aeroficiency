export type DesignId = `des_${string}`;
export type AnalysisId = `ana_${string}`;
export type ActivityId = `act_${string}`;
export type Actor = 'human' | 'agent' | 'solver' | 'system';
export type DesignKind = 'baseline' | 'candidate';
export type AnalysisStatus = 'converged' | 'not_converged' | 'failed';
export type AnalysisFreshness = 'current' | 'stale' | 'unavailable';
export type ConstraintState = 'pass' | 'fail' | 'unavailable' | 'stale';
export type SolverFidelity = 'fast' | 'standard';

export type AirfoilDefinition =
  | { kind: 'NACA4'; code: string }
  | { kind: 'COORDINATES'; name: string; points: Array<readonly [number, number]>; source?: string };

export interface AirfoilStation {
  id: string;
  eta: number;
  airfoil: AirfoilDefinition;
  blendToNext: 'LINEAR_CAMBER_THICKNESS' | 'HOLD';
}

export interface PolarRow {
  alphaDeg: number;
  cl: number;
  cd: number;
  cm: number;
}

export interface SectionPolar {
  polarId: string;
  airfoilStationId: string;
  reynolds: number;
  mach: number;
  transitionModel?: string;
  rows: PolarRow[];
  provenance: {
    source: 'USER_IMPORT' | 'XFOIL' | 'EXPERIMENT' | 'ANALYTIC_ESTIMATE';
    label: string;
    licence?: string;
  };
}

export interface PolarModel {
  kind: 'ANALYTIC_ATTACHED' | 'USER_TABLES';
  tables: SectionPolar[];
}

export interface WingGeometry {
  spanM: number;
  rootChordM: number;
  tipChordM: number;
  rootTwistDeg: number;
  tipTwistDeg: number;
  /** Legacy uniform-section alias retained for the stable WebMCP contract. */
  nacaCode: string;
  airfoilStations: AirfoilStation[];
  polarModel: PolarModel;
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
  /** Positive for solver wake downwash in the documented body-axis convention. */
  downwashMps: number;
  /** Positive downwash angle, subtracted from geometric local incidence. */
  inducedAngleDeg: number;
  inducedDragPerSpanNpm: number;
  airfoilLabel: string;
  zeroLiftAngleDeg: number;
  pitchingMomentCoefficient: number;
  reynoldsNumber: number;
  sectionalLiftCoefficient: number;
  profileDragCoefficient: number;
  profileDragPerSpanNpm: number;
  polarState: 'within_range' | 'extrapolated_alpha' | 'outside_reynolds' | 'outside_alpha' | 'analytic_estimate';
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
  profileDragEstimateN: number;
  profileDragCoefficientEstimate: number;
  combinedWingDragEstimateN: number;
  combinedDragCoefficientEstimate: number;
  estimatedWingLiftToDrag: number;
  spanEfficiencyEstimate: number | null;
  trimmedAlphaDeg: number;
  tipDeflectionM: number;
  tipElasticTwistDeg: number;
  minYieldMargin: number;
  maxBendingStressPa: number;
  maxTorsionalShearPa: number;
}

export interface PolarDiagnostics {
  model: 'analytic_attached_polar' | 'user_section_polars';
  profileDragAvailable: true;
  withinRangeStations: number;
  analyticEstimateStations: number;
  extrapolatedAlphaStations: number;
  outsideReynoldsStations: number;
  outsideAlphaStations: number;
  reynoldsRange: readonly [number, number];
  effectiveAlphaRangeDeg: readonly [number, number];
  provenance: string[];
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
  designKind: DesignKind;
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
  polarDiagnostics: PolarDiagnostics;
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
  | 'ANALYSIS_ALREADY_RUNNING'
  | 'REVISION_CONFLICT'
  | 'DUPLICATE_MUTATION_MISMATCH'
  | 'ANALYSIS_REQUIRED'
  | 'STALE_ANALYSIS'
  | 'INVALID_COMPARISON'
  | 'INCOMPATIBLE_ANALYSES'
  | 'DESIGN_LIMIT_REACHED'
  | 'WORKSPACE_STATE_INVALID'
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
      projectRevision?: number;
      designRevision?: number;
      flightCaseRevision?: number;
      constraintsRevision?: number;
    };
    analysisId?: AnalysisId;
    committed?: boolean;
    /** Fixed public category for a solver/controller failure; never raw exception text. */
    category?: string;
  };
}

export interface DomainSuccess<T> {
  ok: true;
  replayed: boolean;
  data: T;
}

export type DomainResult<T> = DomainSuccess<T> | DomainFailure;
