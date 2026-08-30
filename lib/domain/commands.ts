import { ALUMINUM_2024_T3, MAX_ACTIVITY_EVENTS, MAX_ANALYSES, MAX_DESIGNS, MAX_IDEMPOTENCY_RECORDS, MODEL_WARNINGS, SOLVER_SETTINGS } from './limits';
import { evaluateDesignConstraints } from './constraints';
import { createEntityId, ENTITY_ID_LENGTH, sha256, stableStringify } from './ids';
import { designAnalysisFreshness, designInputFingerprint, requiredTargetLiftCoefficient, validateDesign, validateFlightCase } from './validation';
import { expectedStructuralMassKg } from '../solver/wingBox';
import { localAirfoilSection } from '../solver/airfoilSections';
import { trustDomainFailure } from './publicErrors';
import type {
  ActivityEvent,
  ActivityId,
  Actor,
  AnalysisFreshness,
  AnalysisId,
  AnalysisSnapshot,
  DesignId,
  DomainFailure,
  DomainResult,
  ProjectState,
  SolverFidelity,
  WingDesign,
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
  return trustDomainFailure({ ok: false, error: { code, message, retryable: false, safeNextAction, ...options } });
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
  } catch {
    return fail('VALIDATION_ERROR', 'The request cannot be canonicalized safely.', 'Remove non-finite, undefined, cyclic, or unsupported values and retry.');
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
  expectedProjectRevision: number;
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

export interface SetBaselineInput {
  designId: DesignId;
  expectedProjectRevision: number;
  expectedDesignRevision: number;
  idempotencyKey: string;
}

export interface SetBaselineResult {
  outcome: 'changed' | 'unchanged';
  baselineDesignId: DesignId;
  baselineDesignRevision: number;
  previousBaselineDesignId: DesignId;
  previousBaselineDesignRevision: number;
  projectRevision: number;
  invalidatedAnalysisIds: AnalysisId[];
  activityId: string | null;
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
  if (state.projectRevision !== input.expectedProjectRevision || source.revision !== input.expectedSourceDesignRevision) {
    return {
      state,
      result: fail('REVISION_CONFLICT', 'The project or source design advanced before candidate creation.', 'Read the current state and retry with the returned project and design revisions and a new UUID.', {
        retryable: true,
        current: { projectRevision: state.projectRevision, designRevision: source.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
      }),
    };
  }
  const label = input.candidateLabel.trim();
  if (!label || label.length > 48 || /[\u0000-\u001f\u007f]/.test(label)) {
    return { state, result: fail('VALIDATION_ERROR', 'Candidate label must contain 1–48 visible characters.', 'Choose a short visible candidate label and retry.', { issues: [{ path: 'candidateLabel', reason: 'Invalid visible label.' }] }) };
  }
  if (Object.keys(state.designs).length >= MAX_DESIGNS) {
    return { state, result: fail('DESIGN_LIMIT_REACHED', `This workspace supports at most ${MAX_DESIGNS} designs.`, 'Continue with an existing candidate or reset the demo workspace.') };
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

export function setBaselineDesign(
  state: ProjectState,
  input: SetBaselineInput,
  actor: Actor,
  runtime: CommandRuntime = defaultRuntime,
): StateTransition<SetBaselineResult> {
  const replay = idempotentReplay<SetBaselineResult>(state, 'set_baseline_design', input.idempotencyKey, input);
  if (replay) return { state, result: replay };
  const target = state.designs[input.designId];
  if (!target) return { state, result: fail('DESIGN_NOT_FOUND', 'The requested design does not exist.', 'Read the current design state and retry with an explicit design ID.') };
  const baselines = Object.values(state.designs).filter((design) => design.kind === 'baseline');
  if (baselines.length !== 1) {
    return { state, result: fail('WORKSPACE_STATE_INVALID', 'The workspace does not contain exactly one Baseline reference.', 'Reset the reference case before changing the Baseline role.') };
  }
  const previousBaseline = baselines[0];
  if (state.projectRevision !== input.expectedProjectRevision || target.revision !== input.expectedDesignRevision) {
    return {
      state,
      result: fail('REVISION_CONFLICT', 'The project or selected candidate advanced before the Baseline role changed.', 'Read the current state and retry with the returned project and design revisions and a new UUID.', {
        retryable: true,
        current: { projectRevision: state.projectRevision, designRevision: target.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
      }),
    };
  }

  if (target.kind === 'baseline') {
    const next = cloneState(state);
    const now = runtime.now();
    const data: SetBaselineResult = {
      outcome: 'unchanged',
      baselineDesignId: target.designId,
      baselineDesignRevision: target.revision,
      previousBaselineDesignId: target.designId,
      previousBaselineDesignRevision: target.revision,
      projectRevision: state.projectRevision,
      invalidatedAnalysisIds: [],
      activityId: null,
    };
    recordIdempotency(next, 'set_baseline_design', input.idempotencyKey, input, data, now);
    return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
  }

  const next = cloneState(state);
  const now = runtime.now();
  const activityId = runtime.createId('act');
  const nextTarget = next.designs[target.designId];
  const nextPreviousBaseline = next.designs[previousBaseline.designId];
  const invalidatedAnalysisIds = Object.values(next.designs)
    .map((design) => design.latestAnalysisId)
    .filter((id): id is AnalysisId => Boolean(id));

  nextTarget.kind = 'baseline';
  nextTarget.revision += 1;
  nextTarget.updatedAt = now;
  nextPreviousBaseline.kind = 'candidate';
  nextPreviousBaseline.revision += 1;
  nextPreviousBaseline.updatedAt = now;
  next.projectRevision += 1;
  next.activeDesignId = nextTarget.designId;
  next.selectedAnalysisId = nextTarget.latestAnalysisId;

  addActivity(next, {
    activityId,
    actor,
    operation: 'set_baseline_design',
    targetDesignId: nextTarget.designId,
    fromRevision: target.revision,
    toRevision: nextTarget.revision,
    summary: `${nextTarget.label} is now the Baseline reference; ${nextPreviousBaseline.label} remains available as a candidate. Dependent comparisons are stale.`,
    changedFields: {
      designRole: { from: 'candidate', to: 'baseline' },
      previousBaselineRole: { from: 'baseline', to: 'candidate' },
    },
    analysisId: nextTarget.latestAnalysisId,
    status: 'success',
    timestamp: now,
  });

  const data: SetBaselineResult = {
    outcome: 'changed',
    baselineDesignId: nextTarget.designId,
    baselineDesignRevision: nextTarget.revision,
    previousBaselineDesignId: nextPreviousBaseline.designId,
    previousBaselineDesignRevision: nextPreviousBaseline.revision,
    projectRevision: next.projectRevision,
    invalidatedAnalysisIds,
    activityId,
  };
  recordIdempotency(next, 'set_baseline_design', input.idempotencyKey, input, data, now);
  return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
}

export interface UpdateDesignInput<TPatch> {
  designId: DesignId;
  expectedDesignRevision: number;
  idempotencyKey: string;
  patch: TPatch;
}

export interface UpdateDesignResult {
  outcome: 'changed' | 'unchanged';
  designId: DesignId;
  previousDesignRevision: number;
  newDesignRevision: number;
  projectRevision: number;
  changedFields: Record<string, { from: number | string; to: number | string; unit?: string }>;
  invalidatedAnalysisId: AnalysisId | null;
  invalidatedComparisonDesignIds: DesignId[];
  analysisFreshness: AnalysisFreshness;
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
  const candidatePart = { ...structuredClone(currentPart), ...structuredClone(input.patch) } as TPart;
  if (part === 'geometry') {
    const geometry = candidatePart as WingGeometry;
    const geometryPatch = input.patch as Partial<WingGeometry>;
    if (geometryPatch.nacaCode !== undefined && geometryPatch.airfoilStations === undefined) {
      geometry.airfoilStations = geometry.airfoilStations.map((station) => ({
        ...station,
        airfoil: { kind: 'NACA4', code: geometry.nacaCode },
      }));
    }
    const rootAirfoil = geometry.airfoilStations[0]?.airfoil;
    if (geometryPatch.airfoilStations !== undefined && geometryPatch.nacaCode === undefined && rootAirfoil?.kind === 'NACA4') {
      geometry.nacaCode = rootAirfoil.code;
    }
  }
  const candidateGeometry = part === 'geometry' ? candidatePart as WingGeometry : design.geometry;
  const candidateStructure = part === 'structure' ? candidatePart as WingStructure : design.structure;
  const issues = validateDesign(candidateGeometry, candidateStructure);
  if (issues.length) {
    return { state, result: fail('VALIDATION_ERROR', 'The requested design values are outside the supported model.', 'Correct the listed values and retry; no partial update was applied.', { issues: issues.slice(0, 6) }) };
  }
  const changedFields: UpdateDesignResult['changedFields'] = {};
  for (const key of keys) {
    const fromValue = currentPart[key as keyof TPart];
    const toValue = candidatePart[key as keyof TPart];
    if (stableStringify(fromValue) !== stableStringify(toValue)) {
      const summarizeValue = (value: unknown) => {
        if (typeof value === 'number' || typeof value === 'string') return value;
        if (key === 'airfoilStations' && Array.isArray(value)) return `${value.length} station${value.length === 1 ? '' : 's'}`;
        if (key === 'polarModel' && isRecord(value)) {
          const tables = Array.isArray(value.tables) ? value.tables.length : 0;
          return value.kind === 'USER_TABLES' ? `${tables} user polar table${tables === 1 ? '' : 's'}` : 'analytic attached-flow estimate';
        }
        return 'configured value';
      };
      changedFields[`${part}.${key}`] = { from: summarizeValue(fromValue), to: summarizeValue(toValue), unit: units[key] };
    }
  }
  if (Object.keys(changedFields).length === 0) {
    const next = cloneState(state);
    const now = runtime.now();
    const data: UpdateDesignResult = {
      outcome: 'unchanged',
      designId: design.designId,
      previousDesignRevision: design.revision,
      newDesignRevision: design.revision,
      projectRevision: state.projectRevision,
      changedFields: {},
      invalidatedAnalysisId: null,
      invalidatedComparisonDesignIds: [],
      analysisFreshness: designAnalysisFreshness(state, design),
      activityId: null,
    };
    recordIdempotency(next, tool, input.idempotencyKey, input, data, now);
    return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
  }
  const next = cloneState(state);
  const now = runtime.now();
  const nextDesign = next.designs[input.designId];
  const previousDesignRevision = nextDesign.revision;
  const invalidatedAnalysisId = nextDesign.latestAnalysisId;
  const invalidatedComparisonDesignIds = design.kind === 'baseline'
    ? Object.values(next.designs).filter((item) => item.kind === 'candidate' && item.latestAnalysisId).map((item) => item.designId)
    : [];
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
    summary: `${Object.keys(changedFields).length} ${part} field${Object.keys(changedFields).length === 1 ? '' : 's'} updated. ${design.kind === 'baseline' ? 'Baseline analysis and dependent candidate comparisons are stale.' : 'Analysis is stale.'}`,
    changedFields,
    analysisId: invalidatedAnalysisId,
    status: 'success',
    timestamp: now,
  });
  const data: UpdateDesignResult = {
    outcome: 'changed',
    designId: nextDesign.designId,
    previousDesignRevision,
    newDesignRevision: nextDesign.revision,
    projectRevision: next.projectRevision,
    changedFields,
    invalidatedAnalysisId,
    invalidatedComparisonDesignIds,
    analysisFreshness: invalidatedAnalysisId ? 'stale' : 'unavailable',
    activityId,
  };
  recordIdempotency(next, tool, input.idempotencyKey, input, data, now);
  return { state: next, result: { ok: true, replayed: false, data: structuredClone(data) } };
}

export function updateWingGeometry(state: ProjectState, input: UpdateDesignInput<Partial<WingGeometry>>, actor: Actor, runtime: CommandRuntime = defaultRuntime) {
  return updateDesignPart(state, input, actor, 'update_wing_geometry', 'geometry', {
    spanM: 'm', rootChordM: 'm', tipChordM: 'm', rootTwistDeg: 'deg', tipTwistDeg: 'deg', nacaCode: '', airfoilStations: '', polarModel: '',
  }, runtime);
}

export function updateWingStructure(state: ProjectState, input: UpdateDesignInput<Partial<WingStructure>>, actor: Actor, runtime: CommandRuntime = defaultRuntime) {
  return updateDesignPart(state, input, actor, 'update_wing_structure', 'structure', {
    skinThicknessMm: 'mm', frontWebThicknessMm: 'mm', rearWebThicknessMm: 'mm', frontSparXOverC: 'c', rearSparXOverC: 'c', elasticAxisXOverC: 'c', material: '',
  }, runtime);
}

export interface RunAnalysisRequest {
  designId: DesignId;
  expectedProjectRevision: number;
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
  checkSummary: {
    designKind: WingDesign['kind'];
    configured: number;
    applicable: number;
    passed: number;
    failed: number;
    unavailable: number;
    allApplicableSatisfied: boolean;
  };
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
      const diagnosticRetained = Boolean(state.analyses[replay.data.analysisId]);
      const owner = state.designs[replay.data.designId];
      const currentReplacementAnalysisId = owner?.latestAnalysisId && analysisIsCurrent(state, owner.latestAnalysisId)
        ? owner.latestAnalysisId
        : null;
      return fail(
        'ANALYSIS_DID_NOT_CONVERGE',
        diagnosticRetained
          ? 'The original idempotent analysis did not converge; its diagnostic snapshot remains retained and configured checks are unavailable.'
          : 'The original idempotent analysis did not converge, and its diagnostic snapshot is no longer retained in the bounded analysis history.',
        currentReplacementAnalysisId
          ? `Use current converged analysis ${currentReplacementAnalysisId} for current evidence; review the replayed diagnostic only as historical context.`
          : diagnosticRetained
            ? 'Review the retained diagnostic and current model range; run the current design revision with a new UUID only if new evidence is needed.'
            : 'Read the current state and run the current design revision with a new UUID only if new inspectable evidence is needed.',
        diagnosticRetained ? { analysisId: replay.data.analysisId, committed: true } : { committed: false },
      );
    }
    return { ok: true, replayed: true, data: { kind: 'replay', result: replay.data } };
  }
  const design = state.designs[request.designId];
  if (!design) return fail('DESIGN_NOT_FOUND', 'The requested design does not exist.', 'Read the current design state and retry with an explicit design ID.');
  if (request.fidelity !== 'fast' && request.fidelity !== 'standard') return fail('VALIDATION_ERROR', 'Unsupported solver fidelity.', 'Use fast or standard fidelity.');
  const conflict = state.projectRevision !== request.expectedProjectRevision
    || design.revision !== request.expectedDesignRevision
    || state.flightCase.revision !== request.expectedFlightCaseRevision
    || state.constraints.revision !== request.expectedConstraintsRevision;
  if (conflict) {
    return fail('REVISION_CONFLICT', 'The design or a dependency advanced before analysis began.', 'Read the current state and retry with the returned revisions and a new UUID.', {
      retryable: true,
      current: { projectRevision: state.projectRevision, designRevision: design.revision, flightCaseRevision: state.flightCase.revision, constraintsRevision: state.constraints.revision },
    });
  }
  const inputIssues = [...validateDesign(design.geometry, design.structure), ...validateFlightCase(state.flightCase)];
  const targetCl = requiredTargetLiftCoefficient(design.geometry, state.flightCase);
  if (Number.isFinite(targetCl) && (targetCl < SOLVER_SETTINGS.requiredTargetCl[0] || targetCl > SOLVER_SETTINGS.requiredTargetCl[1])) {
    inputIssues.push({
      path: 'flightCase.targetLiftN',
      reason: `The combined geometry, density, speed, and target lift require CL ${targetCl.toFixed(3)}, outside the supported ${SOLVER_SETTINGS.requiredTargetCl[0]}–${SOLVER_SETTINGS.requiredTargetCl[1].toFixed(2)} range.`,
    });
  }
  if (inputIssues.length) return fail('VALIDATION_ERROR', 'The design or flight case is outside the supported analysis model.', 'Correct the listed values before running analysis.', { issues: inputIssues.slice(0, 6) });
  return { ok: true, replayed: false, data: { kind: 'ready', designId: design.designId, inputFingerprint: designInputFingerprint(state, design, request.fidelity) } };
}

const SNAPSHOT_KEYS = ['analysisId', 'designId', 'designKind', 'status', 'designRevision', 'flightCaseRevision', 'constraintsRevision', 'fidelity', 'solverVersion', 'inputFingerprint', 'createdAt', 'convergence', 'metrics', 'stations', 'polarDiagnostics', 'constraints', 'warnings'] as const;
const CONVERGENCE_KEYS = ['iterations', 'equilibriumResidual', 'twistChangeDeg', 'relativeLoadChange', 'targetLiftErrorPct'] as const;
const METRIC_KEYS = ['wingAreaM2', 'aspectRatio', 'structuralMassKg', 'liftN', 'liftCoefficient', 'inducedDragN', 'inducedDragCoefficientEstimate', 'profileDragEstimateN', 'profileDragCoefficientEstimate', 'combinedWingDragEstimateN', 'combinedDragCoefficientEstimate', 'estimatedWingLiftToDrag', 'spanEfficiencyEstimate', 'trimmedAlphaDeg', 'tipDeflectionM', 'tipElasticTwistDeg', 'minYieldMargin', 'maxBendingStressPa', 'maxTorsionalShearPa'] as const;
const STATION_KEYS = ['eta', 'yM', 'chordM', 'geometricTwistDeg', 'liftPerSpanNpm', 'circulationM2s', 'downwashMps', 'inducedAngleDeg', 'inducedDragPerSpanNpm', 'airfoilLabel', 'zeroLiftAngleDeg', 'pitchingMomentCoefficient', 'reynoldsNumber', 'sectionalLiftCoefficient', 'profileDragCoefficient', 'profileDragPerSpanNpm', 'polarState', 'shearN', 'bendingMomentNm', 'torqueNm', 'deflectionM', 'elasticTwistDeg', 'bendingStiffnessNm2', 'torsionalStiffnessNm2', 'vonMisesStressPa', 'yieldMargin'] as const;
const POLAR_DIAGNOSTIC_KEYS = ['model', 'profileDragAvailable', 'withinRangeStations', 'analyticEstimateStations', 'extrapolatedAlphaStations', 'outsideReynoldsStations', 'outsideAlphaStations', 'reynoldsRange', 'effectiveAlphaRangeDeg', 'provenance'] as const;
const CONSTRAINT_KEYS = ['key', 'label', 'state', 'actual', 'limit', 'unit', 'detail'] as const;
const EXPECTED_CONSTRAINT_KEYS = ['mass_reduction', 'yield_margin', 'tip_deflection', 'induced_drag', 'convergence'] as const;

export function summarizeAnalysisChecks(analysis: AnalysisSnapshot, kind: WingDesign['kind']): RunAnalysisResult['checkSummary'] {
  const applicableKeys = kind === 'baseline'
    ? new Set<AnalysisSnapshot['constraints'][number]['key']>(['yield_margin', 'tip_deflection', 'convergence'])
    : new Set<AnalysisSnapshot['constraints'][number]['key']>(EXPECTED_CONSTRAINT_KEYS);
  const applicable = analysis.constraints.filter((check) => applicableKeys.has(check.key));
  return {
    designKind: kind,
    configured: EXPECTED_CONSTRAINT_KEYS.length,
    applicable: applicable.length,
    passed: applicable.filter((check) => check.state === 'pass').length,
    failed: applicable.filter((check) => check.state === 'fail').length,
    unavailable: analysis.constraints.filter((check) => check.state === 'unavailable').length,
    allApplicableSatisfied: analysis.status === 'converged' && applicable.length > 0 && applicable.every((check) => check.state === 'pass'),
  };
}

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
      || raw.designKind !== design.kind
      || raw.designRevision !== request.expectedDesignRevision
      || raw.flightCaseRevision !== request.expectedFlightCaseRevision
      || raw.constraintsRevision !== request.expectedConstraintsRevision
      || raw.fidelity !== request.fidelity
      || raw.solverVersion !== state.solverVersion
      || raw.inputFingerprint !== expectedFingerprint
      || typeof raw.analysisId !== 'string'
      || raw.analysisId.length !== ENTITY_ID_LENGTH
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
    if (metrics.inducedDragCoefficientEstimate !== null && !finite(metrics.inducedDragCoefficientEstimate)) return false;
    if (metrics.spanEfficiencyEstimate !== null && !finite(metrics.spanEfficiencyEstimate)) return false;
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
      || (metrics.profileDragEstimateN as number) <= 0
      || !nearlyEqual(metrics.profileDragCoefficientEstimate as number, (metrics.profileDragEstimateN as number) / dynamicPressureArea)
      || !nearlyEqual(metrics.combinedWingDragEstimateN as number, (metrics.inducedDragN as number) + (metrics.profileDragEstimateN as number))
      || !nearlyEqual(metrics.combinedDragCoefficientEstimate as number, (metrics.combinedWingDragEstimateN as number) / dynamicPressureArea)
      || (metrics.combinedDragCoefficientEstimate as number) <= 0
      || !nearlyEqual(metrics.estimatedWingLiftToDrag as number, (metrics.liftN as number) / (metrics.combinedWingDragEstimateN as number))
      || (metrics.estimatedWingLiftToDrag as number) <= 0
      || (metrics.spanEfficiencyEstimate !== null
        && ((metrics.spanEfficiencyEstimate as number) <= 0
          || metrics.inducedDragCoefficientEstimate === null
          || !nearlyEqual(metrics.spanEfficiencyEstimate as number, (metrics.liftCoefficient as number) ** 2 / (Math.PI * aspectRatio * (metrics.inducedDragCoefficientEstimate as number)))))
      || (metrics.trimmedAlphaDeg as number) < SOLVER_SETTINGS.alphaBracketDeg[0] - 1e-8
      || (metrics.trimmedAlphaDeg as number) > SOLVER_SETTINGS.alphaBracketDeg[1] + 1e-8
      || Math.abs(metrics.tipDeflectionM as number) > SOLVER_SETTINGS.maxTipDeflectionSemispanFraction * design.geometry.spanM / 2 + 1e-9
      || Math.abs(metrics.tipElasticTwistDeg as number) > SOLVER_SETTINGS.maxElasticTwistDeg + 1e-8
      || (metrics.minYieldMargin as number) <= 0
      || (metrics.maxBendingStressPa as number) < 0
      || (metrics.maxTorsionalShearPa as number) < 0) return false;
    if (!Array.isArray(raw.stations)) return false;
    const expectedStationCount = request.fidelity === 'fast' ? SOLVER_SETTINGS.fast.fullSpanPanelCount / 2 + 1 : SOLVER_SETTINGS.standard.fullSpanPanelCount / 2 + 1;
    if (raw.stations.length !== expectedStationCount) return false;
    for (let index = 0; index < raw.stations.length; index += 1) {
      const station = raw.stations[index];
      if (!isRecord(station) || !exactKeys(station, STATION_KEYS)) return false;
      if (!STATION_KEYS.filter((key) => key !== 'yieldMargin' && key !== 'airfoilLabel' && key !== 'polarState').every((key) => finite(station[key]))) return false;
      if (station.yieldMargin !== null && (!finite(station.yieldMargin) || station.yieldMargin <= 0)) return false;
      if (typeof station.airfoilLabel !== 'string' || station.airfoilLabel.length < 1 || station.airfoilLabel.length > 80 || /[\u0000-\u001f\u007f]/.test(station.airfoilLabel)) return false;
      if (!['within_range', 'extrapolated_alpha', 'outside_reynolds', 'outside_alpha', 'analytic_estimate'].includes(station.polarState as string)) return false;
      const eta = station.eta as number;
      if (eta < 0 || eta > 1 || (index > 0 && eta <= (raw.stations[index - 1] as Record<string, number>).eta)) return false;
      const expectedY = eta * design.geometry.spanM / 2;
      const expectedChord = design.geometry.rootChordM + (design.geometry.tipChordM - design.geometry.rootChordM) * eta;
      const expectedGeometricTwist = design.geometry.rootTwistDeg + (design.geometry.tipTwistDeg - design.geometry.rootTwistDeg) * eta;
      const expectedSection = localAirfoilSection(design.geometry, eta, 80);
      const expectedReynolds = state.flightCase.airDensityKgM3 * state.flightCase.velocityMps * expectedChord / state.flightCase.dynamicViscosityPaS;
      if (!nearlyEqual(station.yM as number, expectedY)
        || !nearlyEqual(station.chordM as number, expectedChord)
        || !nearlyEqual(station.geometricTwistDeg as number, expectedGeometricTwist)
        || station.airfoilLabel !== expectedSection.label
        || !nearlyEqual(station.zeroLiftAngleDeg as number, expectedSection.zeroLiftAngleRad * 180 / Math.PI, 1e-7, 1e-8)
        || !nearlyEqual(station.reynoldsNumber as number, expectedReynolds)
        || Math.abs(station.pitchingMomentCoefficient as number) > 2
        || Math.abs(station.sectionalLiftCoefficient as number) > 3
        || (station.profileDragCoefficient as number) < 0
        || (station.profileDragPerSpanNpm as number) < 0
        || (station.downwashMps as number) < -1e-10
        || (station.inducedAngleDeg as number) < -1e-10
        || !nearlyEqual(
          station.inducedAngleDeg as number,
          Math.atan2(station.downwashMps as number, state.flightCase.velocityMps) * 180 / Math.PI,
          1e-8,
          1e-9,
        )
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
      || !nearlyEqual(lastStation.downwashMps as number, 0, 0, 1e-12)
      || !nearlyEqual(lastStation.inducedAngleDeg as number, 0, 0, 1e-12)
      || !nearlyEqual(lastStation.inducedDragPerSpanNpm as number, 0, 0, 1e-12)
      || !nearlyEqual(lastStation.profileDragPerSpanNpm as number, 0, 0, 1e-12)
      || aggregateVonMisesPa + 1e-6 < maximumStationVonMisesPa
      || aggregateVonMisesPa + 1e-6 < (metrics.maxBendingStressPa as number)
      || aggregateVonMisesPa + 1e-6 < Math.sqrt(3) * (metrics.maxTorsionalShearPa as number)
      || aggregateVonMisesPa > componentUpperBoundPa * (1 + 1e-8) + 1e-6) return false;

    const expectedPanelCount = request.fidelity === 'fast' ? SOLVER_SETTINGS.fast.fullSpanPanelCount : SOLVER_SETTINGS.standard.fullSpanPanelCount;

    if (!isRecord(raw.polarDiagnostics) || !exactKeys(raw.polarDiagnostics, POLAR_DIAGNOSTIC_KEYS)) return false;
    const polarDiagnostics = raw.polarDiagnostics;
    const countKeys = ['withinRangeStations', 'analyticEstimateStations', 'extrapolatedAlphaStations', 'outsideReynoldsStations', 'outsideAlphaStations'] as const;
    if (polarDiagnostics.model !== (design.geometry.polarModel.kind === 'USER_TABLES' ? 'user_section_polars' : 'analytic_attached_polar')
      || polarDiagnostics.profileDragAvailable !== true
      || !countKeys.every((key) => Number.isInteger(polarDiagnostics[key]) && (polarDiagnostics[key] as number) >= 0)
      || countKeys.reduce((sum, key) => sum + (polarDiagnostics[key] as number), 0) !== expectedPanelCount / 2
      || !Array.isArray(polarDiagnostics.reynoldsRange) || polarDiagnostics.reynoldsRange.length !== 2 || !polarDiagnostics.reynoldsRange.every(finite)
      || (polarDiagnostics.reynoldsRange[0] as number) <= 0 || (polarDiagnostics.reynoldsRange[1] as number) < (polarDiagnostics.reynoldsRange[0] as number)
      || !Array.isArray(polarDiagnostics.effectiveAlphaRangeDeg) || polarDiagnostics.effectiveAlphaRangeDeg.length !== 2 || !polarDiagnostics.effectiveAlphaRangeDeg.every(finite)
      || (polarDiagnostics.effectiveAlphaRangeDeg[1] as number) < (polarDiagnostics.effectiveAlphaRangeDeg[0] as number)
      || !Array.isArray(polarDiagnostics.provenance) || polarDiagnostics.provenance.length < 1 || polarDiagnostics.provenance.length > 6
      || !polarDiagnostics.provenance.every((value) => typeof value === 'string' && value.length > 0 && value.length <= 120 && !/[\u0000-\u001f\u007f]/.test(value))) return false;

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
    checkSummary: summarizeAnalysisChecks(trustedSnapshot, design.kind),
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
