import { ALUMINUM_2024_T3, MAX_ACTIVITY_EVENTS, MAX_ANALYSES, MAX_DESIGNS, MAX_IDEMPOTENCY_RECORDS, MODEL_WARNINGS, SOLVER_SETTINGS } from './limits';
import { evaluateDesignConstraints } from './constraints';
import { createEntityId, sha256, stableStringify } from './ids';
import { designAnalysisFreshness, designInputFingerprint, validateDesign, validateFlightCase } from './validation';
import { expectedStructuralMassKg } from '../solver/wingBox';
import type {
  ActivityEvent,
  ActivityId,
  Actor,
  AnalysisId,
  AnalysisSnapshot,
  DesignId,
  DomainFailure,
  DomainResult,
  ProjectState,
  SolverFidelity,
  WingGeometry,
  WingStructure,
} from './types';

export interface CommandRuntime {
  now: () => string;
  createId: typeof createEntityId;
}

const defaultRuntime: CommandRuntime = {
  now: () => new Date().toISOString(),
  createId: createEntityId,
};

export interface StateTransition<T> {
  state: ProjectState;
  result: DomainResult<T>;
}

function fail(code: DomainFailure['error']['code'], message: string, safeNextAction: string, options: Partial<DomainFailure['error']> = {}): DomainFailure {
  return { ok: false, error: { code, message, retryable: false, safeNextAction, ...options } };
}

function ledgerKey(tool: string, idempotencyKey: string) {
  return `${tool}/${idempotencyKey}`;
}

function requestHash(request: object) {
  const hashable = { ...request } as Record<string, unknown>;
  delete hashable.idempotencyKey;
  return sha256(stableStringify(hashable));
}

export function idempotentReplay<T>(state: ProjectState, tool: string, idempotencyKey: string, request: object): DomainResult<T> | null {
  const record = state.idempotencyLedger[ledgerKey(tool, idempotencyKey)];
  let hash: string;
  try {
    hash = requestHash(request);
  } catch (error) {
    return fail('VALIDATION_ERROR', error instanceof Error ? error.message : 'The request cannot be canonicalized.', 'Remove non-finite, undefined, cyclic, or unsupported values and retry.');
  }
  if (!record) return null;
  if (record.requestHash !== hash) {
    return fail(
      'DUPLICATE_MUTATION_MISMATCH',
      'This idempotency key was already used with a different request.',
      'Create a new UUID and retry the intended request.',
    );
  }
  return { ok: true, replayed: true, data: structuredClone(record.result as T) };
}

function recordIdempotency<T>(state: ProjectState, tool: string, idempotencyKey: string, request: object, result: T, now: string) {
  state.idempotencyLedger[ledgerKey(tool, idempotencyKey)] = {
    tool,
    requestHash: requestHash(request),
    result: structuredClone(result),
    committedAt: now,
  };
  const keys = Object.keys(state.idempotencyLedger);
  while (keys.length > MAX_IDEMPOTENCY_RECORDS) {
    const oldest = keys.shift();
    if (oldest) delete state.idempotencyLedger[oldest];
  }
}

function addActivity(state: ProjectState, event: ActivityEvent) {
  state.activities = [structuredClone(event), ...state.activities].slice(0, MAX_ACTIVITY_EVENTS);
}

function cloneState(state: ProjectState) {
  return structuredClone(state);
}

export interface CreateCandidateInput {
  sourceDesignId: DesignId;
  expectedSourceDesignRevision: number;
  candidateLabel: string;
  idempotencyKey: string;
}

export interface CreateCandidateResult {
  designId: DesignId;
  label: string;
  kind: 'candidate';
  revision: 1;
  sourceDesignId: DesignId;
  sourceDesignRevision: number;
  projectRevision: number;
  activityId: string;
}

export function createCandidateVariant(
  state: ProjectState,
  input: CreateCandidateInput,
  actor: Actor,
  runtime: CommandRuntime = defaultRuntime,
): StateTransition<CreateCandidateResult> {
  const replay = idempotentReplay<CreateCandidateResult>(state, 'create_candidate_variant', input.idempotencyKey, input);
  if (replay) return { state, result: replay };
  const source = state.designs[input.sourceDesignId];
  if (!source) return { state, result: fail('DESIGN_NOT_FOUND', 'The source design does not exist.', 'Read the current design state and retry with an explicit design ID.') };
  if (source.revision !== input.expectedSourceDesignRevision) {
    return {
      state,
      result: fail('REVISION_CONFLICT', `The source advanced from revision ${input.expectedSourceDesignRevision} to ${source.revision}.`, 'Read the current state and retry with the returned revision.', {
        retryable: true,
        current: { designRevision: source.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
      }),
    };
  }
  const label = input.candidateLabel.trim();
  if (!label || label.length > 48 || /[\u0000-\u001f\u007f]/.test(label)) {
    return { state, result: fail('VALIDATION_ERROR', 'Candidate label must contain 1–48 visible characters.', 'Choose a short visible candidate label and retry.', { issues: [{ path: 'candidateLabel', reason: 'Invalid visible label.' }] }) };
  }
  if (Object.keys(state.designs).length >= MAX_DESIGNS) {
    return { state, result: fail('VALIDATION_ERROR', `This workspace supports at most ${MAX_DESIGNS} designs.`, 'Continue with an existing candidate or reset the demo workspace.') };
  }
  const next = cloneState(state);
  const now = runtime.now();
  const designId = runtime.createId('des') as DesignId;
  const activityId = runtime.createId('act');
  next.projectRevision += 1;
  next.designs[designId] = {
    ...structuredClone(source),
    designId,
    label,
    kind: 'candidate',
    revision: 1,
    sourceDesignId: source.designId,
    sourceDesignRevision: source.revision,
    latestAnalysisId: null,
    createdAt: now,
    updatedAt: now,
  };
  next.activeDesignId = designId;
  next.selectedAnalysisId = null;
  const data: CreateCandidateResult = {
    designId,
    label,
    kind: 'candidate',
    revision: 1,
    sourceDesignId: source.designId,
    sourceDesignRevision: source.revision,
    projectRevision: next.projectRevision,
    activityId,
  };
  addActivity(next, {
    activityId,
    actor,
    operation: 'create_candidate_variant',
    targetDesignId: designId,
    fromRevision: null,
    toRevision: 1,
    summary: `${label} branched from ${source.label} revision ${source.revision}.`,
    changedFields: {},
    analysisId: null,
    status: 'success',
    timestamp: now,
  });
  recordIdempotency(next, 'create_candidate_variant', input.idempotencyKey, input, data, now);
  return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
}

export interface UpdateDesignInput<TPatch> {
  designId: DesignId;
  expectedDesignRevision: number;
  idempotencyKey: string;
  patch: TPatch;
}

export interface UpdateDesignResult {
  designId: DesignId;
  previousDesignRevision: number;
  newDesignRevision: number;
  projectRevision: number;
  changedFields: Record<string, { from: number | string; to: number | string; unit?: string }>;
  invalidatedAnalysisId: AnalysisId | null;
  analysisFreshness: 'stale' | 'unavailable';
  activityId: string | null;
}

function updateDesignPart<TPart extends WingGeometry | WingStructure>(
  state: ProjectState,
  input: UpdateDesignInput<Partial<TPart>>,
  actor: Actor,
  tool: 'update_wing_geometry' | 'update_wing_structure',
  part: 'geometry' | 'structure',
  units: Record<string, string>,
  runtime: CommandRuntime,
): StateTransition<UpdateDesignResult> {
  const replay = idempotentReplay<UpdateDesignResult>(state, tool, input.idempotencyKey, input);
  if (replay) return { state, result: replay };
  const design = state.designs[input.designId];
  if (!design) return { state, result: fail('DESIGN_NOT_FOUND', 'The requested design does not exist.', 'Read the current design state and retry with an explicit design ID.') };
  if (design.kind === 'baseline') {
    return { state, result: fail('BASELINE_PROTECTED', 'The baseline is protected and was not changed.', 'Create a candidate variant, then apply the update to that candidate.') };
  }
  if (design.revision !== input.expectedDesignRevision) {
    return {
      state,
      result: fail('REVISION_CONFLICT', `${design.label} advanced from revision ${input.expectedDesignRevision} to ${design.revision}.`, 'Read the current design state, preserve the human values, and retry with a new UUID.', {
        retryable: true,
        current: { designRevision: design.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
      }),
    };
  }
  const keys = Object.keys(input.patch);
  if (keys.length === 0) {
    return { state, result: fail('VALIDATION_ERROR', 'The patch must contain at least one supported field.', 'Provide one or more absolute values in the patch.', { issues: [{ path: 'patch', reason: 'Empty patch.' }] }) };
  }
  const currentPart = design[part] as TPart;
  const unsupported = keys.filter((key) => !Object.hasOwn(currentPart, key));
  if (unsupported.length) {
    return { state, result: fail('VALIDATION_ERROR', 'The patch contains unsupported fields.', 'Remove every field not listed in the tool schema and retry.', { issues: unsupported.slice(0, 6).map((key) => ({ path: `patch.${key}`, reason: 'Unknown field.' })) }) };
  }
  const candidatePart = { ...currentPart, ...input.patch } as TPart;
  const candidateGeometry = part === 'geometry' ? candidatePart as WingGeometry : design.geometry;
  const candidateStructure = part === 'structure' ? candidatePart as WingStructure : design.structure;
  const issues = validateDesign(candidateGeometry, candidateStructure);
  if (issues.length) {
    return { state, result: fail('VALIDATION_ERROR', 'The requested design values are outside the supported model.', 'Correct the listed values and retry; no partial update was applied.', { issues: issues.slice(0, 6) }) };
  }
  const changedFields: UpdateDesignResult['changedFields'] = {};
  for (const key of keys) {
    const from = currentPart[key as keyof TPart] as number | string;
    const to = candidatePart[key as keyof TPart] as number | string;
    if (from !== to) changedFields[`${part}.${key}`] = { from, to, unit: units[key] };
  }
  if (Object.keys(changedFields).length === 0) {
    return {
      state,
      result: fail(
        'VALIDATION_ERROR',
        'The patch matches the current design and no values changed.',
        'Read the current revision and omit no-op updates; the existing analysis remains current.',
        { issues: [{ path: 'patch', reason: 'Every supplied value already matches the design.' }] },
      ),
    };
  }
  const next = cloneState(state);
  const now = runtime.now();
  const nextDesign = next.designs[input.designId];
  const previousDesignRevision = nextDesign.revision;
  const invalidatedAnalysisId = nextDesign.latestAnalysisId;
  let activityId: ActivityId | null = null;
  activityId = runtime.createId('act');
  nextDesign[part] = candidatePart as WingGeometry & WingStructure;
  nextDesign.revision += 1;
  nextDesign.updatedAt = now;
  next.projectRevision += 1;
  next.activeDesignId = nextDesign.designId;
  next.selectedAnalysisId = invalidatedAnalysisId;
  addActivity(next, {
    activityId,
    actor,
    operation: tool,
    targetDesignId: nextDesign.designId,
    fromRevision: previousDesignRevision,
    toRevision: nextDesign.revision,
    summary: `${Object.keys(changedFields).length} ${part} field${Object.keys(changedFields).length === 1 ? '' : 's'} updated. Analysis is stale.`,
    changedFields,
    analysisId: invalidatedAnalysisId,
    status: 'success',
    timestamp: now,
  });
  const data: UpdateDesignResult = {
    designId: nextDesign.designId,
    previousDesignRevision,
    newDesignRevision: nextDesign.revision,
    projectRevision: next.projectRevision,
    changedFields,
    invalidatedAnalysisId,
    analysisFreshness: invalidatedAnalysisId ? 'stale' : 'unavailable',
    activityId,
  };
  recordIdempotency(next, tool, input.idempotencyKey, input, data, now);
  return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
}

export function updateWingGeometry(state: ProjectState, input: UpdateDesignInput<Partial<WingGeometry>>, actor: Actor, runtime: CommandRuntime = defaultRuntime) {
  return updateDesignPart(state, input, actor, 'update_wing_geometry', 'geometry', {
    spanM: 'm', rootChordM: 'm', tipChordM: 'm', rootTwistDeg: 'deg', tipTwistDeg: 'deg', nacaCode: '',
  }, runtime);
}

export function updateWingStructure(state: ProjectState, input: UpdateDesignInput<Partial<WingStructure>>, actor: Actor, runtime: CommandRuntime = defaultRuntime) {
  return updateDesignPart(state, input, actor, 'update_wing_structure', 'structure', {
    skinThicknessMm: 'mm', frontWebThicknessMm: 'mm', rearWebThicknessMm: 'mm', frontSparXOverC: 'c', rearSparXOverC: 'c', elasticAxisXOverC: 'c', material: '',
  }, runtime);
}

export interface RunAnalysisRequest {
  designId: DesignId;
  expectedDesignRevision: number;
  expectedFlightCaseRevision: number;
  expectedConstraintsRevision: number;
  idempotencyKey: string;
  fidelity: SolverFidelity;
}

export interface RunAnalysisResult {
  analysisId: AnalysisId;
  designId: DesignId;
  designRevision: number;
  flightCaseRevision: number;
  constraintsRevision: number;
  projectRevision: number;
  fidelity: SolverFidelity;
  solverVersion: string;
  inputFingerprint: string;
  status: AnalysisSnapshot['status'];
  iterations: number;
  metrics: AnalysisSnapshot['metrics'];
  allConstraintsSatisfied: boolean;
  warnings: string[];
  activityId: string;
}

export type AnalysisPreflightResult = DomainResult<
  | { kind: 'ready'; designId: DesignId; inputFingerprint: string }
  | { kind: 'replay'; result: RunAnalysisResult }
>;

export function preflightAnalysisRun(state: ProjectState, request: RunAnalysisRequest): AnalysisPreflightResult {
  const replay = idempotentReplay<RunAnalysisResult>(state, 'run_aeroelastic_analysis', request.idempotencyKey, request);
  if (replay) {
    if (!replay.ok) return replay;
    if (replay.data.status !== 'converged') {
      return fail('ANALYSIS_DID_NOT_CONVERGE', 'The original idempotent analysis did not converge, so constraints remain unavailable.', 'Review the model range, change the candidate, and retry with a new UUID.', { analysisId: replay.data.analysisId, committed: true });
    }
    return { ok: true, replayed: true, data: { kind: 'replay', result: replay.data } };
  }
  const design = state.designs[request.designId];
  if (!design) return fail('DESIGN_NOT_FOUND', 'The requested design does not exist.', 'Read the current design state and retry with an explicit design ID.');
  if (request.fidelity !== 'fast' && request.fidelity !== 'standard') return fail('VALIDATION_ERROR', 'Unsupported solver fidelity.', 'Use fast or standard fidelity.');
  const inputIssues = [...validateDesign(design.geometry, design.structure), ...validateFlightCase(state.flightCase)];
  if (inputIssues.length) return fail('VALIDATION_ERROR', 'The design or flight case is outside the supported analysis model.', 'Correct the listed values before running analysis.', { issues: inputIssues.slice(0, 6) });
  const conflict = design.revision !== request.expectedDesignRevision
    || state.flightCase.revision !== request.expectedFlightCaseRevision
    || state.constraints.revision !== request.expectedConstraintsRevision;
  if (conflict) {
    return fail('REVISION_CONFLICT', 'The design or a dependency advanced before analysis began.', 'Read the current state and retry with the returned revisions and a new UUID.', {
      retryable: true,
      current: { designRevision: design.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
    });
  }
  return { ok: true, replayed: false, data: { kind: 'ready', designId: design.designId, inputFingerprint: designInputFingerprint(state, design, request.fidelity) } };
}

const SNAPSHOT_KEYS = ['analysisId', 'designId', 'status', 'designRevision', 'flightCaseRevision', 'constraintsRevision', 'fidelity', 'solverVersion', 'inputFingerprint', 'createdAt', 'convergence', 'metrics', 'stations', 'constraints', 'warnings'] as const;
const CONVERGENCE_KEYS = ['iterations', 'equilibriumResidual', 'twistChangeDeg', 'relativeLoadChange', 'targetLiftErrorPct'] as const;
const METRIC_KEYS = ['wingAreaM2', 'aspectRatio', 'structuralMassKg', 'liftN', 'liftCoefficient', 'inducedDragN', 'inducedDragCoefficientEstimate', 'spanEfficiencyEstimate', 'trimmedAlphaDeg', 'tipDeflectionM', 'tipElasticTwistDeg', 'minYieldMargin', 'maxBendingStressPa', 'maxTorsionalShearPa'] as const;
const STATION_KEYS = ['eta', 'yM', 'chordM', 'geometricTwistDeg', 'liftPerSpanNpm', 'circulationM2s', 'shearN', 'bendingMomentNm', 'torqueNm', 'deflectionM', 'elasticTwistDeg', 'bendingStiffnessNm2', 'torsionalStiffnessNm2', 'vonMisesStressPa', 'yieldMargin'] as const;
const CONSTRAINT_KEYS = ['key', 'label', 'state', 'actual', 'limit', 'unit', 'detail'] as const;
const EXPECTED_CONSTRAINT_KEYS = ['mass_reduction', 'yield_margin', 'tip_deflection', 'induced_drag', 'convergence'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function nearlyEqual(left: number, right: number, relativeTolerance = 1e-8, absoluteTolerance = 1e-10) {
  return Math.abs(left - right) <= Math.max(absoluteTolerance, relativeTolerance * Math.max(1, Math.abs(left), Math.abs(right)));
}

function snapshotIsValid(
  raw: unknown,
  state: ProjectState,
  design: ProjectState['designs'][DesignId],
  request: RunAnalysisRequest,
  expectedFingerprint: string,
): raw is AnalysisSnapshot {
  try {
    if (!isRecord(raw) || !exactKeys(raw, SNAPSHOT_KEYS)) return false;
    const status = raw.status;
    if (status !== 'converged' && status !== 'not_converged') return false;
    if (raw.designId !== request.designId
      || raw.designRevision !== request.expectedDesignRevision
      || raw.flightCaseRevision !== request.expectedFlightCaseRevision
      || raw.constraintsRevision !== request.expectedConstraintsRevision
      || raw.fidelity !== request.fidelity
      || raw.solverVersion !== state.solverVersion
      || raw.inputFingerprint !== expectedFingerprint
      || typeof raw.analysisId !== 'string'
      || !/^ana_[0-9A-Z]+$/.test(raw.analysisId)
      || Object.hasOwn(state.analyses, raw.analysisId)
      || typeof raw.inputFingerprint !== 'string'
      || !/^fp_[0-9a-f]{64}$/.test(raw.inputFingerprint)
      || typeof raw.createdAt !== 'string'
      || !Number.isFinite(Date.parse(raw.createdAt))) return false;

    if (!isRecord(raw.convergence) || !exactKeys(raw.convergence, CONVERGENCE_KEYS)) return false;
    const convergence = raw.convergence;
    if (!Number.isInteger(convergence.iterations) || (convergence.iterations as number) < 2 || (convergence.iterations as number) > SOLVER_SETTINGS.couplingMaxIterations) return false;
    if (![convergence.equilibriumResidual, convergence.twistChangeDeg, convergence.relativeLoadChange, convergence.targetLiftErrorPct].every(finite)) return false;
    if ((convergence.equilibriumResidual as number) < 0 || (convergence.twistChangeDeg as number) < 0 || (convergence.relativeLoadChange as number) < 0 || (convergence.targetLiftErrorPct as number) < 0) return false;
    if (status === 'converged') {
      const twistToleranceDeg = SOLVER_SETTINGS.iterateChangeToleranceRad * 180 / Math.PI;
      if ((convergence.equilibriumResidual as number) > SOLVER_SETTINGS.equilibriumToleranceRad * 1.001
        || (convergence.twistChangeDeg as number) > twistToleranceDeg * 1.001
        || (convergence.relativeLoadChange as number) > SOLVER_SETTINGS.relativeLoadTolerance * 1.001
        || (convergence.targetLiftErrorPct as number) > 100 * SOLVER_SETTINGS.coupledLiftTolerance * 1.001) return false;
    } else if (convergence.iterations !== SOLVER_SETTINGS.couplingMaxIterations) return false;

    if (!isRecord(raw.metrics) || !exactKeys(raw.metrics, METRIC_KEYS)) return false;
    const metrics = raw.metrics;
    if (!METRIC_KEYS.filter((key) => key !== 'inducedDragCoefficientEstimate' && key !== 'spanEfficiencyEstimate').every((key) => finite(metrics[key]))) return false;
    if (!finite(metrics.inducedDragCoefficientEstimate) || metrics.spanEfficiencyEstimate !== null) return false;
    const area = design.geometry.spanM * (design.geometry.rootChordM + design.geometry.tipChordM) / 2;
    const aspectRatio = design.geometry.spanM ** 2 / area;
    const dynamicPressureArea = 0.5 * state.flightCase.airDensityKgM3 * state.flightCase.velocityMps ** 2 * area;
    if ((metrics.wingAreaM2 as number) <= 0
      || !nearlyEqual(metrics.wingAreaM2 as number, area)
      || !nearlyEqual(metrics.aspectRatio as number, aspectRatio)
      || (metrics.structuralMassKg as number) <= 0
      || !nearlyEqual(metrics.structuralMassKg as number, expectedStructuralMassKg(design), 1e-8, 1e-8)
      || (metrics.liftN as number) <= 0
      || Math.abs((metrics.liftN as number) - state.flightCase.targetLiftN) / state.flightCase.targetLiftN > SOLVER_SETTINGS.coupledLiftTolerance * 1.001
      || !nearlyEqual(metrics.liftCoefficient as number, (metrics.liftN as number) / dynamicPressureArea)
      || (metrics.inducedDragN as number) < 0
      || (metrics.inducedDragCoefficientEstimate !== null
        && ((metrics.inducedDragCoefficientEstimate as number) < 0
          || !nearlyEqual(metrics.inducedDragCoefficientEstimate as number, (metrics.inducedDragN as number) / dynamicPressureArea)))
      || (metrics.spanEfficiencyEstimate !== null && (metrics.spanEfficiencyEstimate as number) <= 0)
      || (metrics.trimmedAlphaDeg as number) < SOLVER_SETTINGS.alphaBracketDeg[0] - 1e-8
      || (metrics.trimmedAlphaDeg as number) > SOLVER_SETTINGS.alphaBracketDeg[1] + 1e-8
      || Math.abs(metrics.tipDeflectionM as number) > 0.1 * design.geometry.spanM / 2 + 1e-9
      || Math.abs(metrics.tipElasticTwistDeg as number) > 15 + 1e-8
      || (metrics.minYieldMargin as number) <= 0
      || (metrics.maxBendingStressPa as number) < 0
      || (metrics.maxTorsionalShearPa as number) < 0) return false;
    if (!Array.isArray(raw.stations)) return false;
    const expectedStationCount = request.fidelity === 'fast' ? SOLVER_SETTINGS.fast.fullSpanPanelCount / 2 + 1 : SOLVER_SETTINGS.standard.fullSpanPanelCount / 2 + 1;
    if (raw.stations.length !== expectedStationCount) return false;
    for (let index = 0; index < raw.stations.length; index += 1) {
      const station = raw.stations[index];
      if (!isRecord(station) || !exactKeys(station, STATION_KEYS)) return false;
      if (!STATION_KEYS.filter((key) => key !== 'yieldMargin').every((key) => finite(station[key]))) return false;
      if (station.yieldMargin !== null && (!finite(station.yieldMargin) || station.yieldMargin <= 0)) return false;
      const eta = station.eta as number;
      if (eta < 0 || eta > 1 || (index > 0 && eta <= (raw.stations[index - 1] as Record<string, number>).eta)) return false;
      const expectedY = eta * design.geometry.spanM / 2;
      const expectedChord = design.geometry.rootChordM + (design.geometry.tipChordM - design.geometry.rootChordM) * eta;
      const expectedGeometricTwist = design.geometry.rootTwistDeg + (design.geometry.tipTwistDeg - design.geometry.rootTwistDeg) * eta;
      if (!nearlyEqual(station.yM as number, expectedY)
        || !nearlyEqual(station.chordM as number, expectedChord)
        || !nearlyEqual(station.geometricTwistDeg as number, expectedGeometricTwist)
        || (station.chordM as number) <= 0
        || (station.bendingStiffnessNm2 as number) <= 0
        || (station.torsionalStiffnessNm2 as number) <= 0
        || (station.vonMisesStressPa as number) < 0
        || ((station.vonMisesStressPa as number) === 0 && station.yieldMargin !== null)
        || ((station.vonMisesStressPa as number) > 0 && (station.yieldMargin === null || !nearlyEqual(station.yieldMargin as number, ALUMINUM_2024_T3.yieldStrengthPa / (station.vonMisesStressPa as number))))) return false;
    }
    const firstStation = raw.stations[0] as Record<string, number | null>;
    const lastStation = raw.stations[raw.stations.length - 1] as Record<string, number | null>;
    const maximumStationVonMisesPa = Math.max(...raw.stations.map((station) => (station as Record<string, number>).vonMisesStressPa));
    const aggregateVonMisesPa = ALUMINUM_2024_T3.yieldStrengthPa / (metrics.minYieldMargin as number);
    const componentUpperBoundPa = Math.hypot(
      metrics.maxBendingStressPa as number,
      Math.sqrt(3) * (metrics.maxTorsionalShearPa as number),
    );
    if (!nearlyEqual(firstStation.eta as number, 0, 0, 1e-12)
      || !nearlyEqual(lastStation.eta as number, 1, 0, 1e-12)
      || !nearlyEqual(firstStation.deflectionM as number, 0, 0, 1e-10)
      || !nearlyEqual(firstStation.elasticTwistDeg as number, 0, 0, 1e-10)
      || !nearlyEqual(lastStation.deflectionM as number, metrics.tipDeflectionM as number)
      || !nearlyEqual(lastStation.elasticTwistDeg as number, metrics.tipElasticTwistDeg as number)
      || !nearlyEqual(lastStation.liftPerSpanNpm as number, 0, 0, 1e-9)
      || !nearlyEqual(lastStation.circulationM2s as number, 0, 0, 1e-12)
      || aggregateVonMisesPa + 1e-6 < maximumStationVonMisesPa
      || aggregateVonMisesPa + 1e-6 < (metrics.maxBendingStressPa as number)
      || aggregateVonMisesPa + 1e-6 < Math.sqrt(3) * (metrics.maxTorsionalShearPa as number)
      || aggregateVonMisesPa > componentUpperBoundPa * (1 + 1e-8) + 1e-6) return false;

    if (!Array.isArray(raw.constraints) || raw.constraints.length !== EXPECTED_CONSTRAINT_KEYS.length) return false;
    const expectedConstraints = evaluateDesignConstraints(
      state,
      design,
      request.fidelity,
      status,
      metrics.structuralMassKg as number,
      metrics.inducedDragN as number,
      metrics.minYieldMargin as number,
      metrics.tipDeflectionM as number,
    );
    const seen = new Set<string>();
    for (const constraint of raw.constraints) {
      if (!isRecord(constraint) || !exactKeys(constraint, CONSTRAINT_KEYS)) return false;
      if (!EXPECTED_CONSTRAINT_KEYS.includes(constraint.key as typeof EXPECTED_CONSTRAINT_KEYS[number]) || seen.has(constraint.key as string)) return false;
      seen.add(constraint.key as string);
      if (!['pass', 'fail', 'unavailable'].includes(constraint.state as string)) return false;
      if (typeof constraint.label !== 'string' || constraint.label.length < 1 || constraint.label.length > 100 || /[\u0000-\u001f\u007f]/.test(constraint.label)) return false;
      if (typeof constraint.detail !== 'string' || constraint.detail.length < 1 || constraint.detail.length > 240 || /[\u0000-\u001f\u007f]/.test(constraint.detail)) return false;
      if (typeof constraint.unit !== 'string' || constraint.unit.length > 20) return false;
      if (constraint.actual !== null && !finite(constraint.actual)) return false;
      if (constraint.limit !== null && !finite(constraint.limit)) return false;
      if (constraint.state === 'unavailable' && (constraint.actual !== null || constraint.limit !== null)) return false;
      if (constraint.state !== 'unavailable' && (!finite(constraint.actual) || !finite(constraint.limit))) return false;
      if (status !== 'converged' && constraint.state !== 'unavailable') return false;
      const expected = expectedConstraints.find((item) => item.key === constraint.key);
      if (!expected
        || constraint.label !== expected.label
        || constraint.state !== expected.state
        || constraint.unit !== expected.unit
        || constraint.detail !== expected.detail
        || (expected.actual === null ? constraint.actual !== null : !finite(constraint.actual) || !nearlyEqual(constraint.actual, expected.actual))
        || (expected.limit === null ? constraint.limit !== null : !finite(constraint.limit) || !nearlyEqual(constraint.limit, expected.limit))) return false;
    }
    const convergenceConstraint = raw.constraints.find((constraint) => isRecord(constraint) && constraint.key === 'convergence') as Record<string, unknown> | undefined;
    if (!convergenceConstraint || (status === 'converged' && convergenceConstraint.state !== 'pass') || (status !== 'converged' && convergenceConstraint.state !== 'unavailable')) return false;

    if (!Array.isArray(raw.warnings) || raw.warnings.length !== MODEL_WARNINGS.length) return false;
    const warnings = raw.warnings;
    if (!warnings.every((warning) => typeof warning === 'string' && warning.length > 0 && warning.length <= 240 && !/[\u0000-\u001f\u007f]/.test(warning))) return false;
    if (!MODEL_WARNINGS.every((warning, index) => warnings[index] === warning)) return false;
    return true;
  } catch {
    return false;
  }
}

export function commitAnalysisSnapshot(
  state: ProjectState,
  request: RunAnalysisRequest,
  snapshot: AnalysisSnapshot,
  actor: Actor,
  runtime: CommandRuntime = defaultRuntime,
): StateTransition<RunAnalysisResult> {
  const replay = idempotentReplay<RunAnalysisResult>(state, 'run_aeroelastic_analysis', request.idempotencyKey, request);
  if (replay) {
    if (replay.ok && replay.data.status !== 'converged') {
      return { state, result: fail('ANALYSIS_DID_NOT_CONVERGE', 'The original idempotent analysis did not converge, so constraints remain unavailable.', 'Review the model range, change the candidate, and retry with a new UUID.', { analysisId: replay.data.analysisId, committed: true }) };
    }
    return { state, result: replay };
  }
  const design = state.designs[request.designId];
  if (!design) return { state, result: fail('DESIGN_NOT_FOUND', 'The requested design no longer exists.', 'Read the current design state and retry.') };
  const conflict = design.revision !== request.expectedDesignRevision || state.flightCase.revision !== request.expectedFlightCaseRevision || state.constraints.revision !== request.expectedConstraintsRevision;
  const expectedFingerprint = designInputFingerprint(state, design, request.fidelity);
  if (conflict) {
    return {
      state,
      result: fail('REVISION_CONFLICT', 'The design or its dependencies changed while the solver was running. No result was committed.', 'Read the current state and run a new analysis for the latest revisions.', {
        retryable: true,
        current: { designRevision: design.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
      }),
    };
  }
  if (!snapshotIsValid(snapshot, state, design, request, expectedFingerprint)) {
    return { state, result: fail('ANALYSIS_FAILED', 'The solver returned a malformed or mismatched snapshot. No result was committed.', 'Run a new analysis from the current state; if this repeats, inspect the solver diagnostics.', { retryable: true, committed: false }) };
  }
  const trustedSnapshot = structuredClone(snapshot);
  const next = cloneState(state);
  const now = runtime.now();
  const activityId = runtime.createId('act');
  next.analyses[trustedSnapshot.analysisId] = trustedSnapshot;
  const protectedAnalysisIds = new Set(Object.values(next.designs).map((item) => item.latestAnalysisId).filter(Boolean));
  protectedAnalysisIds.add(trustedSnapshot.analysisId);
  const analysisIds = Object.values(next.analyses).sort((left, right) => left.createdAt.localeCompare(right.createdAt)).map((item) => item.analysisId);
  while (Object.keys(next.analyses).length > MAX_ANALYSES && analysisIds.length) {
    const oldest = analysisIds.shift();
    if (oldest && !protectedAnalysisIds.has(oldest)) delete next.analyses[oldest];
  }
  if (trustedSnapshot.status === 'converged') next.designs[design.designId].latestAnalysisId = trustedSnapshot.analysisId;
  if (next.activeDesignId === design.designId) next.selectedAnalysisId = trustedSnapshot.analysisId;
  next.projectRevision += 1;
  addActivity(next, {
    activityId,
    actor,
    operation: 'run_aeroelastic_analysis',
    targetDesignId: design.designId,
    fromRevision: design.revision,
    toRevision: design.revision,
    summary: trustedSnapshot.status === 'converged' ? `Analysis converged in ${trustedSnapshot.convergence.iterations} iterations.` : 'Analysis did not converge; constraints are unavailable.',
    changedFields: {},
    analysisId: trustedSnapshot.analysisId,
    status: 'success',
    timestamp: now,
  });
  const data: RunAnalysisResult = {
    analysisId: trustedSnapshot.analysisId,
    designId: design.designId,
    designRevision: trustedSnapshot.designRevision,
    flightCaseRevision: trustedSnapshot.flightCaseRevision,
    constraintsRevision: trustedSnapshot.constraintsRevision,
    projectRevision: next.projectRevision,
    fidelity: trustedSnapshot.fidelity,
    solverVersion: trustedSnapshot.solverVersion,
    inputFingerprint: trustedSnapshot.inputFingerprint,
    status: trustedSnapshot.status,
    iterations: trustedSnapshot.convergence.iterations,
    metrics: structuredClone(trustedSnapshot.metrics),
    allConstraintsSatisfied: trustedSnapshot.status === 'converged' && trustedSnapshot.constraints.length === EXPECTED_CONSTRAINT_KEYS.length && trustedSnapshot.constraints.every((constraint) => constraint.state === 'pass'),
    warnings: trustedSnapshot.warnings.slice(0, 4),
    activityId,
  };
  recordIdempotency(next, 'run_aeroelastic_analysis', request.idempotencyKey, request, data, now);
  if (trustedSnapshot.status !== 'converged') {
    return {
      state: next,
      result: fail('ANALYSIS_DID_NOT_CONVERGE', 'The committed analysis did not converge, so constraints are unavailable.', 'Review the model-range warnings, stiffen the candidate, and run a new analysis.', { analysisId: trustedSnapshot.analysisId, committed: true }),
    };
  }
  return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
}

export function selectDesign(state: ProjectState, designId: DesignId) {
  if (!state.designs[designId]) return state;
  return { ...state, activeDesignId: designId, selectedAnalysisId: state.designs[designId].latestAnalysisId };
}

export function selectAnalysis(state: ProjectState, analysisId: AnalysisId | null) {
  if (analysisId && !state.analyses[analysisId]) return state;
  return { ...state, selectedAnalysisId: analysisId };
}

export function selectEta(state: ProjectState, eta: number) {
  return { ...state, selectedEta: Math.max(0, Math.min(1, eta)) };
}

export function analysisIsCurrent(state: ProjectState, analysisId: AnalysisId) {
  const analysis = state.analyses[analysisId];
  const design = analysis ? state.designs[analysis.designId] : null;
  return Boolean(analysis && design && design.latestAnalysisId === analysisId && designAnalysisFreshness(state, design) === 'current');
}
