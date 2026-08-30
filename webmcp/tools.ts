import { z, type ZodType } from 'zod';
import { analysisIsCurrent, summarizeAnalysisChecks } from '@/lib/domain/commands';
import { ENTITY_ID_LENGTH } from '@/lib/domain/ids';
import { MAX_AIRFOIL_COORDINATE_POINTS, MAX_AIRFOIL_STATIONS, MAX_POLAR_ROWS, MAX_POLAR_TABLES, MIN_AIRFOIL_STATION_SEPARATION } from '@/lib/domain/limits';
import { compactModelValidity, completeModelValidity, modelValidityStatus } from '@/lib/domain/modelValidity';
import { boundedPublicText, MAX_PUBLIC_SAFE_ACTION_CHARS, sanitizeDomainFailure, trustDomainFailure } from '@/lib/domain/publicErrors';
import { designAnalysisFreshness } from '@/lib/domain/validation';
import type { AnalysisId, AnalysisMetrics, DesignId, DomainFailure, DomainIssue, DomainResult, ProjectState } from '@/lib/domain/types';
import { CANONICAL_TRADE_OFF_SENTENCE } from '@/lib/presentation/copy';
import { classifyDragChange } from '@/lib/presentation/verdict';
import { useProjectStore } from '@/store/projectStore';

const designId = z.string().length(ENTITY_ID_LENGTH).regex(/^des_[0-9A-Z]+$/);
const analysisId = z.string().length(ENTITY_ID_LENGTH).regex(/^ana_[0-9A-Z]+$/);
const idempotencyKey = z.string().uuid();
const designStateInput = z.object({ designId: designId.optional() }).strict();
const analysisInput = z.object({ analysisId }).strict();
const stationInput = z.object({ analysisId, eta: z.number().finite().min(0).max(1) }).strict();
const createCandidateInput = z.object({
  sourceDesignId: designId,
  expectedProjectRevision: z.number().int().positive(),
  expectedSourceDesignRevision: z.number().int().positive(),
  candidateLabel: z.string().min(1).max(48).regex(/^(?=.*\S)[^\u0000-\u001f\u007f]{1,48}$/),
  idempotencyKey,
}).strict();
const setBaselineInput = z.object({
  designId,
  expectedProjectRevision: z.number().int().positive(),
  expectedDesignRevision: z.number().int().positive(),
  idempotencyKey,
}).strict();
const nacaCode = z.string().regex(/^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/);
const airfoilDefinition = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('NACA4'), code: nacaCode }).strict(),
  z.object({
    kind: z.literal('COORDINATES'),
    name: z.string().trim().min(1).max(40).regex(/^[^\u0000-\u001f\u007f]+$/),
    points: z.array(z.tuple([z.number().finite().min(-1e4).max(1e4), z.number().finite().min(-1e4).max(1e4)]))
      .min(24).max(MAX_AIRFOIL_COORDINATE_POINTS),
    source: z.string().max(120).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  }).strict(),
]);
const airfoilStation = z.object({
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,23}$/),
  eta: z.number().finite().min(0).max(1),
  airfoil: airfoilDefinition,
  blendToNext: z.enum(['LINEAR_CAMBER_THICKNESS', 'HOLD']),
}).strict();
const polarRow = z.object({
  alphaDeg: z.number().finite().min(-30).max(30),
  cl: z.number().finite().min(-5).max(5),
  cd: z.number().finite().positive().max(2),
  cm: z.number().finite().min(-2).max(2),
}).strict();
const sectionPolar = z.object({
  polarId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,31}$/),
  airfoilStationId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,23}$/),
  reynolds: z.number().finite().min(5e4).max(5e7),
  mach: z.number().finite().min(0).max(0.3),
  transitionModel: z.string().max(80).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  rows: z.array(polarRow).min(7).max(MAX_POLAR_ROWS),
  provenance: z.object({
    source: z.enum(['USER_IMPORT', 'XFOIL', 'EXPERIMENT']),
    label: z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f]+$/),
    licence: z.string().max(80).regex(/^[^\u0000-\u001f\u007f]*$/).optional(),
  }).strict(),
}).strict();
const polarModel = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ANALYTIC_ATTACHED'), tables: z.array(sectionPolar).length(0) }).strict(),
  z.object({ kind: z.literal('USER_TABLES'), tables: z.array(sectionPolar).min(2).max(MAX_POLAR_TABLES) }).strict(),
]);
const geometryPatch = z.object({
  spanM: z.number().finite().min(4).max(16).optional(),
  rootChordM: z.number().finite().min(0.8).max(4).optional(),
  tipChordM: z.number().finite().min(0.3).max(3).optional(),
  tipTwistDeg: z.number().finite().min(-6).max(3).optional(),
  nacaCode: nacaCode.optional(),
  airfoilStations: z.array(airfoilStation).min(2).max(MAX_AIRFOIL_STATIONS).optional(),
  polarModel: polarModel.optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'Patch must contain at least one field.');
const structurePatch = z.object({
  skinThicknessMm: z.number().finite().min(1.2).max(6).optional(),
  frontWebThicknessMm: z.number().finite().min(1.5).max(8).optional(),
  rearWebThicknessMm: z.number().finite().min(1.5).max(8).optional(),
  elasticAxisXOverC: z.number().finite().gt(0.2).max(0.55).optional(),
}).strict().refine((patch) => Object.keys(patch).length > 0, 'Patch must contain at least one field.');
const updateGeometryInput = z.object({ designId, expectedDesignRevision: z.number().int().positive(), idempotencyKey, patch: geometryPatch }).strict();
const updateStructureInput = z.object({ designId, expectedDesignRevision: z.number().int().positive(), idempotencyKey, patch: structurePatch }).strict();
const runInput = z.object({
  designId,
  expectedProjectRevision: z.number().int().positive(),
  expectedDesignRevision: z.number().int().positive(),
  expectedFlightCaseRevision: z.number().int().positive(),
  expectedConstraintsRevision: z.number().int().positive(),
  idempotencyKey,
  fidelity: z.enum(['fast', 'standard']),
}).strict();
const compareInput = z.object({ referenceAnalysisId: analysisId, candidateAnalysisId: analysisId }).strict();
export const MAX_SITE_TOOL_OUTPUT_UTF8_BYTES = 6_000;

function fail(code: DomainFailure['error']['code'], message: string, safeNextAction: string, options: Partial<DomainFailure['error']> = {}): DomainFailure {
  return trustDomainFailure({
    ok: false,
    error: {
      code,
      retryable: false,
      ...options,
      message: boundedPublicText(options.message ?? message, 'The tool failed safely.'),
      safeNextAction: boundedPublicText(options.safeNextAction ?? safeNextAction, 'Read the current state before continuing.', MAX_PUBLIC_SAFE_ACTION_CHARS),
      ...(options.category ? { category: boundedPublicText(options.category, 'TOOL_EXECUTION_EXCEPTION', 64) } : {}),
    },
  });
}

function validationFailure(error: z.ZodError): DomainFailure {
  const bounded = (value: string, maximum: number) => value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maximum);
  const issues: DomainIssue[] = error.issues.slice(0, 6).map((issue) => ({
    path: bounded(issue.path.slice(0, 6).map((segment) => String(segment).slice(0, 40)).join('.') || 'input', 180),
    reason: issue.code === 'unrecognized_keys'
      ? 'Unexpected properties are not allowed.'
      : bounded(issue.message, 240),
  }));
  return fail('VALIDATION_ERROR', 'Tool input did not match the bounded Aeroficiency contract.', 'Correct the listed fields and retry.', { issues });
}

async function parsed<T>(schema: ZodType<T>, input: unknown, execute: (value: T, signal?: AbortSignal) => unknown | Promise<unknown>, signal?: AbortSignal) {
  try {
    const result = schema.safeParse(input);
    if (!result.success) return validationFailure(result.error);
    const executed = await execute(result.data, signal);
    const bounded = executed
      && typeof executed === 'object'
      && 'ok' in executed
      && executed.ok === false
      && 'error' in executed
      ? sanitizeDomainFailure(executed as DomainFailure)
      : executed;
    const cloned = structuredClone(bounded);
    const serialized = JSON.stringify(cloned);
    if (new TextEncoder().encode(serialized).byteLength > MAX_SITE_TOOL_OUTPUT_UTF8_BYTES) {
      return fail(
        'ANALYSIS_FAILED',
        'The Site Tool result exceeded the bounded public output envelope.',
        'Read a narrower explicit resource or reset the bounded workspace before retrying.',
        { category: 'TOOL_OUTPUT_LIMIT' },
      );
    }
    return cloned;
  } catch {
    return fail(
      'ANALYSIS_FAILED',
      'The Site Tool stopped safely before returning a result.',
      'Read the current design state before deciding whether to retry.',
      { category: 'TOOL_EXECUTION_EXCEPTION' },
    );
  }
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const idSchema = (prefix: 'des' | 'ana') => ({ type: 'string', minLength: ENTITY_ID_LENGTH, maxLength: ENTITY_ID_LENGTH, pattern: `^${prefix}_[0-9A-Z]+$` });
const uuidSchema = { type: 'string', format: 'uuid' };
const annotations = (readOnly: boolean): AeroficiencyToolAnnotations => ({ readOnlyHint: readOnly, untrustedContentHint: true });
const nacaCodeSchema = { type: 'string', pattern: '^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$' };
const airfoilDefinitionSchema = {
  oneOf: [
    objectSchema({ kind: { const: 'NACA4' }, code: nacaCodeSchema }, ['kind', 'code']),
    objectSchema({
      kind: { const: 'COORDINATES' },
      name: { type: 'string', minLength: 1, maxLength: 40 },
      points: {
        type: 'array', minItems: 24, maxItems: MAX_AIRFOIL_COORDINATE_POINTS,
        items: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -1e4, maximum: 1e4 } },
      },
      source: { type: 'string', maxLength: 120 },
    }, ['kind', 'name', 'points']),
  ],
};
const airfoilStationSchema = objectSchema({
  id: { type: 'string', minLength: 2, maxLength: 24, pattern: '^[A-Za-z][A-Za-z0-9_-]{1,23}$' },
  eta: { type: 'number', minimum: 0, maximum: 1, description: `Ordered stations must be separated by at least ${MIN_AIRFOIL_STATION_SEPARATION} eta; root 0 and tip 1 are required.` },
  airfoil: airfoilDefinitionSchema,
  blendToNext: { type: 'string', enum: ['LINEAR_CAMBER_THICKNESS', 'HOLD'] },
}, ['id', 'eta', 'airfoil', 'blendToNext']);
const polarRowSchema = objectSchema({
  alphaDeg: { type: 'number', minimum: -30, maximum: 30 },
  cl: { type: 'number', minimum: -5, maximum: 5 },
  cd: { type: 'number', exclusiveMinimum: 0, maximum: 2 },
  cm: { type: 'number', minimum: -2, maximum: 2 },
}, ['alphaDeg', 'cl', 'cd', 'cm']);
const sectionPolarSchema = objectSchema({
  polarId: { type: 'string', minLength: 2, maxLength: 32, pattern: '^[A-Za-z][A-Za-z0-9_-]{1,31}$' },
  airfoilStationId: { type: 'string', minLength: 2, maxLength: 24, pattern: '^[A-Za-z][A-Za-z0-9_-]{1,23}$' },
  reynolds: { type: 'number', minimum: 5e4, maximum: 5e7 },
  mach: { type: 'number', minimum: 0, maximum: 0.3 },
  transitionModel: { type: 'string', maxLength: 80 },
  rows: { type: 'array', minItems: 7, maxItems: MAX_POLAR_ROWS, items: polarRowSchema },
  provenance: objectSchema({
    source: { type: 'string', enum: ['USER_IMPORT', 'XFOIL', 'EXPERIMENT'] },
    label: { type: 'string', minLength: 1, maxLength: 80 },
    licence: { type: 'string', maxLength: 80 },
  }, ['source', 'label']),
}, ['polarId', 'airfoilStationId', 'reynolds', 'mach', 'rows', 'provenance']);
const polarModelSchema = {
  oneOf: [
    objectSchema({ kind: { const: 'ANALYTIC_ATTACHED' }, tables: { type: 'array', maxItems: 0 } }, ['kind', 'tables']),
    objectSchema({ kind: { const: 'USER_TABLES' }, tables: { type: 'array', minItems: 2, maxItems: MAX_POLAR_TABLES, items: sectionPolarSchema } }, ['kind', 'tables']),
  ],
};
const geometryPatchSchema = {
  ...objectSchema({
    spanM: { type: 'number', minimum: 4, maximum: 16 },
    rootChordM: { type: 'number', minimum: 0.8, maximum: 4 },
    tipChordM: { type: 'number', minimum: 0.3, maximum: 3 },
    tipTwistDeg: { type: 'number', minimum: -6, maximum: 3 },
    nacaCode: nacaCodeSchema,
    airfoilStations: { type: 'array', minItems: 2, maxItems: MAX_AIRFOIL_STATIONS, items: airfoilStationSchema },
    polarModel: polarModelSchema,
  }),
  minProperties: 1,
};

function publicMetrics(metrics: AnalysisMetrics) {
  return {
    modeledWingBoxWallMassKg: metrics.structuralMassKg,
    liftN: metrics.liftN,
    liftCoefficient: metrics.liftCoefficient,
    wakeInducedDragEstimateN: metrics.inducedDragN,
    wakeInducedDragCoefficientEstimate: metrics.inducedDragCoefficientEstimate,
    profileDragEstimateN: metrics.profileDragEstimateN,
    profileDragCoefficientEstimate: metrics.profileDragCoefficientEstimate,
    combinedWingDragEstimateN: metrics.combinedWingDragEstimateN,
    combinedDragCoefficientEstimate: metrics.combinedDragCoefficientEstimate,
    estimatedWingLiftToDrag: metrics.estimatedWingLiftToDrag,
    trimmedAlphaDeg: metrics.trimmedAlphaDeg,
    tipDeflectionM: metrics.tipDeflectionM,
    tipElasticTwistDeg: metrics.tipElasticTwistDeg,
    modeledYieldRatio: metrics.minYieldMargin,
  };
}

const rounded = (value: number, decimals = 6) => Number(value.toFixed(decimals));

function publicSummaryMetrics(metrics: AnalysisMetrics) {
  return {
    liftN: rounded(metrics.liftN, 3),
    modeledWingBoxWallMassKg: rounded(metrics.structuralMassKg),
    wakeInducedDragEstimateN: rounded(metrics.inducedDragN),
    dragN: { profile: rounded(metrics.profileDragEstimateN), combined: rounded(metrics.combinedWingDragEstimateN) },
    estimatedLOverD: rounded(metrics.estimatedWingLiftToDrag, 3),
    tipDeflectionM: rounded(metrics.tipDeflectionM),
    modeledYieldRatio: rounded(metrics.minYieldMargin),
  };
}

function designReplayState(designIdValue: DesignId, returnedRevision: number) {
  const current = useProjectStore.getState().project.designs[designIdValue];
  return {
    designRetained: Boolean(current),
    returnedRevision,
    currentDesignRevision: current?.revision ?? null,
    returnedRevisionIsCurrent: Boolean(current && current.revision === returnedRevision),
  };
}

function publicConfiguredChecks(constraints: ProjectState['constraints']) {
  return {
    revision: constraints.revision,
    minimumModeledWingBoxWallMassReductionPct: constraints.minMassReductionPct,
    minimumModeledYieldRatio: constraints.minYieldMargin,
    maximumTipDeflectionM: constraints.maxTipDeflectionM,
    maximumWakeInducedDragEstimateIncreasePct: constraints.maxInducedDragIncreasePct,
    requiredStaticAnalysisConvergence: true,
  };
}

function publicDesign(design: ProjectState['designs'][DesignId]) {
  const geometry = design.geometry;
  const polarByStation = geometry.polarModel.kind === 'USER_TABLES'
    ? geometry.airfoilStations.map((station) => {
      const tables = geometry.polarModel.tables.filter((table) => table.airfoilStationId === station.id);
      return {
        id: station.id,
        tableCount: tables.length,
        reynoldsRange: tables.length ? [Math.min(...tables.map((table) => table.reynolds)), Math.max(...tables.map((table) => table.reynolds))] : null,
        mach: tables[0]?.mach ?? null,
        alphaRangeDeg: tables.length ? [
          Math.min(...tables.map((table) => table.rows[0]?.alphaDeg ?? 0)),
          Math.max(...tables.map((table) => table.rows.at(-1)?.alphaDeg ?? 0)),
        ] : null,
        sources: [...new Set(tables.map((table) => table.provenance.source))],
      };
    })
    : [];
  return {
    designId: design.designId,
    label: design.label,
    kind: design.kind,
    revision: design.revision,
    sourceDesignId: design.sourceDesignId,
    sourceDesignRevision: design.sourceDesignRevision,
    geometry: {
      spanM: geometry.spanM,
      rootChordM: geometry.rootChordM,
      tipChordM: geometry.tipChordM,
      rootTwistDeg: geometry.rootTwistDeg,
      tipTwistDeg: geometry.tipTwistDeg,
      nacaCode: geometry.nacaCode,
      airfoilStations: geometry.airfoilStations.map((station) => ({
        id: station.id,
        eta: station.eta,
        blendToNext: station.blendToNext,
        airfoil: station.airfoil.kind === 'NACA4'
          ? { kind: station.airfoil.kind, code: station.airfoil.code }
          : {
            kind: station.airfoil.kind,
            name: station.airfoil.name,
            pointCount: station.airfoil.points.length,
            sourceProvided: Boolean(station.airfoil.source),
          },
      })),
      polarModel: {
        kind: geometry.polarModel.kind,
        tableCount: geometry.polarModel.tables.length,
        stations: polarByStation,
      },
    },
    structure: design.structure,
    latestAnalysisId: design.latestAnalysisId,
  };
}

function publicDesignIdentity(design: ProjectState['designs'][DesignId]) {
  return {
    designId: design.designId,
    label: design.label,
    kind: design.kind,
    revision: design.revision,
    latestAnalysisId: design.latestAnalysisId,
    detailLevel: 'identity' as const,
  };
}

function getDesignState(requestedDesignId?: DesignId): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  const inspectedDesign = requestedDesignId ? state.designs[requestedDesignId] : null;
  if (requestedDesignId && !inspectedDesign) return fail('DESIGN_NOT_FOUND', 'The requested design does not exist.', 'Read design summaries and retry with an available design ID.');
  const activeDesign = state.designs[state.activeDesignId];
  const inspectingAnotherDesign = Boolean(inspectedDesign && inspectedDesign.designId !== activeDesign.designId);
  return {
    ok: true,
    replayed: false,
    data: {
      projectId: state.projectId,
      projectRevision: state.projectRevision,
      activeDesignId: state.activeDesignId,
      selectedAnalysisId: state.selectedAnalysisId,
      activeDesign: {
        ...(inspectingAnotherDesign ? publicDesignIdentity(activeDesign) : publicDesign(activeDesign)),
        analysisFreshness: designAnalysisFreshness(state, activeDesign),
      },
      ...(inspectingAnotherDesign ? {
        inspectedDesign: {
          ...publicDesign(inspectedDesign!),
          detailLevel: 'full' as const,
          analysisFreshness: designAnalysisFreshness(state, inspectedDesign!),
        },
      } : {}),
      designs: Object.values(state.designs).map((design) => ({
        designId: design.designId,
        label: design.label,
        kind: design.kind,
        revision: design.revision,
        sourceDesignId: design.sourceDesignId,
        sourceDesignRevision: design.sourceDesignRevision,
        latestAnalysisId: design.latestAnalysisId,
        analysisFreshness: designAnalysisFreshness(state, design),
      })),
      flightCase: state.flightCase,
      configuredChecks: publicConfiguredChecks(state.constraints),
      solverVersion: state.solverVersion,
      modelValidity: { status: compactModelValidity().status, method: compactModelValidity().method },
      recentActivity: state.activities.slice(0, 2).map((event) => ({ actor: event.actor, operation: event.operation, targetDesignId: event.targetDesignId, fromRevision: event.fromRevision, toRevision: event.toRevision, analysisId: event.analysisId })),
      summary: 'Read explicit revisions before any write; every design is editable and exactly one design holds the Baseline reference role.',
    },
  };
}

function criticalStation(stations: ReturnType<typeof useProjectStore.getState>['project']['analyses'][AnalysisId]['stations']) {
  const minimumMargin = stations.filter((station) => station.yieldMargin !== null).reduce((minimum, station) => (
    !minimum || (station.yieldMargin ?? Number.POSITIVE_INFINITY) < (minimum.yieldMargin ?? Number.POSITIVE_INFINITY) ? station : minimum
  ), null as typeof stations[number] | null);
  const station = minimumMargin ?? stations[0];
  return {
    eta: rounded(station.eta),
    modeledYieldRatio: station.yieldMargin === null ? null : rounded(station.yieldMargin),
  };
}

function getAnalysisSummary(id: AnalysisId): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  const analysis = state.analyses[id];
  if (!analysis) return fail('ANALYSIS_REQUIRED', 'The requested immutable analysis does not exist.', 'Run an analysis or read the current design state for available analysis IDs.');
  const design = state.designs[analysis.designId];
  const current = analysisIsCurrent(state, id);
  const currentReplacementId = !current && design.latestAnalysisId && analysisIsCurrent(state, design.latestAnalysisId)
    ? design.latestAnalysisId
    : null;
  const freshness = analysis.status !== 'converged'
    ? currentReplacementId
      ? { state: 'not_converged', useAnalysisId: currentReplacementId }
      : { state: 'not_converged', requiredAction: 'CORRECT_AND_RUN_CURRENT' }
    : current
      ? { state: 'current' }
      : currentReplacementId
        ? { state: 'stale', useAnalysisId: currentReplacementId }
        : { state: 'stale', requiredAction: 'RUN_CURRENT_ANALYSIS' };
  const fullCheckSummary = summarizeAnalysisChecks(analysis, analysis.designKind);
  return {
    ok: true,
    replayed: false,
    data: {
      analysisId: analysis.analysisId,
      designId: analysis.designId,
      revisions: { design: analysis.designRevision, case: analysis.flightCaseRevision, checks: analysis.constraintsRevision },
      status: analysis.status,
      freshness,
      fidelity: analysis.fidelity,
      convergence: { iterations: analysis.convergence.iterations },
      metrics: publicSummaryMetrics(analysis.metrics),
      constraints: analysis.status === 'converged'
        ? analysis.constraints.map((constraint) => `${constraint.key}:${constraint.state}`)
        : ['all:unavailable'],
      checkSummary: {
        designKind: fullCheckSummary.designKind,
        applicable: fullCheckSummary.applicable,
        passed: fullCheckSummary.passed,
        unavailable: fullCheckSummary.unavailable,
      },
      criticalStations: [criticalStation(analysis.stations)],
      modelValidity: completeModelValidity(),
    },
  };
}

function inspectStation(id: AnalysisId, eta: number): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  const analysis = state.analyses[id];
  if (!analysis) return fail('ANALYSIS_REQUIRED', 'The requested immutable analysis does not exist.', 'Run an analysis or use get_design_state to find an analysis ID.');
  if (analysis.status !== 'converged') {
    const owner = state.designs[analysis.designId];
    const replacement = owner?.latestAnalysisId && analysisIsCurrent(state, owner.latestAnalysisId) ? owner.latestAnalysisId : null;
    return fail(
      'ANALYSIS_DID_NOT_CONVERGE',
      'Only a converged current analysis can focus visible station evidence.',
      replacement
        ? `Inspect current immutable analysis ${replacement}; no rerun is required.`
        : 'Correct the design and run a new converged analysis before inspecting a station.',
    );
  }
  if (!analysisIsCurrent(state, id)) {
    const owner = state.designs[analysis.designId];
    const replacement = owner?.latestAnalysisId && analysisIsCurrent(state, owner.latestAnalysisId) ? owner.latestAnalysisId : null;
    return fail(
      'STALE_ANALYSIS',
      'Station focus was not applied because the immutable analysis is stale.',
      replacement
        ? `Inspect current immutable analysis ${replacement}; no rerun is required.`
        : 'Run the current design revision, then inspect that new immutable analysis ID.',
    );
  }
  const station = analysis.stations.reduce((nearest, candidate) => Math.abs(candidate.eta - eta) < Math.abs(nearest.eta - eta) ? candidate : nearest);
  useProjectStore.getState().focusAnalysisStation(id, analysis.designId, station.eta, 'agent');
  return {
    ok: true,
    replayed: false,
    data: {
      analysisId: id,
      designId: analysis.designId,
      requestedEta: eta,
      resolvedEta: station.eta,
      station: {
        eta: station.eta,
        yM: station.yM,
        chordM: station.chordM,
        liftPerSpanNpm: station.liftPerSpanNpm,
        airfoilLabel: station.airfoilLabel,
        zeroLiftAngleDeg: station.zeroLiftAngleDeg,
        reynoldsNumber: station.reynoldsNumber,
        sectionalLiftCoefficient: station.sectionalLiftCoefficient,
        profileDragCoefficient: station.profileDragCoefficient,
        profileDragPerSpanNpm: station.profileDragPerSpanNpm,
        polarState: station.polarState,
        bendingMomentNm: station.bendingMomentNm,
        torqueNm: station.torqueNm,
        deflectionM: station.deflectionM,
        elasticTwistDeg: station.elasticTwistDeg,
        vonMisesStressPa: station.vonMisesStressPa,
        modeledYieldRatio: station.yieldMargin,
      },
      modelValidity: modelValidityStatus(),
      visualFocusApplied: true,
      summary: `Visible evidence focused at solver station η=${station.eta.toFixed(3)} without changing engineering data.`,
    },
  };
}

function compareAnalyses(referenceId: AnalysisId, candidateId: AnalysisId): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  if (referenceId === candidateId) return fail('VALIDATION_ERROR', 'Reference and candidate analysis IDs must differ.', 'Choose two different immutable analyses.');
  const reference = state.analyses[referenceId];
  const candidate = state.analyses[candidateId];
  if (!reference || !candidate) return fail('ANALYSIS_REQUIRED', 'One or both immutable analyses do not exist.', 'Run the missing analysis and retry with explicit IDs.');
  const referenceDesign = state.designs[reference.designId];
  const candidateDesign = state.designs[candidate.designId];
  if (referenceDesign?.kind !== 'baseline' || candidateDesign?.kind !== 'candidate') return fail('VALIDATION_ERROR', 'Comparison requires the current Baseline reference and a candidate.', 'Choose the current Baseline analysis as reference and a current candidate analysis as candidate.');
  if (!analysisIsCurrent(state, referenceId) || !analysisIsCurrent(state, candidateId)) {
    const currentReferenceId = referenceDesign?.latestAnalysisId && analysisIsCurrent(state, referenceDesign.latestAnalysisId) ? referenceDesign.latestAnalysisId : null;
    const currentCandidateId = candidateDesign?.latestAnalysisId && analysisIsCurrent(state, candidateDesign.latestAnalysisId) ? candidateDesign.latestAnalysisId : null;
    const replacements = [
      currentReferenceId ? `reference ${currentReferenceId}` : null,
      currentCandidateId ? `candidate ${currentCandidateId}` : null,
    ].filter(Boolean).join(' and ');
    const missing = [
      currentReferenceId ? null : 'reference',
      currentCandidateId ? null : 'candidate',
    ].filter(Boolean).join(' and ');
    const currentReference = currentReferenceId ? state.analyses[currentReferenceId] : null;
    const currentCandidate = currentCandidateId ? state.analyses[currentCandidateId] : null;
    const replacementsCompatible = Boolean(
      currentReference
      && currentCandidate
      && currentReference.flightCaseRevision === currentCandidate.flightCaseRevision
      && currentReference.constraintsRevision === currentCandidate.constraintsRevision
      && currentReference.fidelity === currentCandidate.fidelity
      && currentReference.solverVersion === currentCandidate.solverVersion,
    );
    return fail(
      'STALE_ANALYSIS',
      'Comparison requires two current converged analyses.',
      missing
        ? `${replacements ? `Use current ${replacements}; ` : ''}run a current ${missing} analysis, then compare the explicit current IDs.`
        : replacementsCompatible
          ? `Use current ${replacements}; no rerun is required.`
          : `Current ${replacements} use incompatible fidelity or settings. Run candidate design ${candidateDesign.designId} at ${currentReference?.fidelity ?? 'the chosen shared'} fidelity with matching current settings, then compare the explicit current IDs.`,
    );
  }
  if (reference.flightCaseRevision !== candidate.flightCaseRevision || reference.constraintsRevision !== candidate.constraintsRevision || reference.fidelity !== candidate.fidelity || reference.solverVersion !== candidate.solverVersion) return fail('VALIDATION_ERROR', 'Analyses use incompatible flight cases, configured checks, fidelity, or solver versions.', 'Run both designs with identical settings before comparing.');
  const delta = (candidateValue: number, referenceValue: number) => ({ absolute: candidateValue - referenceValue, percent: referenceValue === 0 ? null : 100 * (candidateValue - referenceValue) / referenceValue });
  const wallMassDelta = delta(candidate.metrics.structuralMassKg, reference.metrics.structuralMassKg);
  const wakeDragDelta = delta(candidate.metrics.inducedDragN, reference.metrics.inducedDragN);
  const profileDragDelta = delta(candidate.metrics.profileDragEstimateN, reference.metrics.profileDragEstimateN);
  const combinedDragDelta = delta(candidate.metrics.combinedWingDragEstimateN, reference.metrics.combinedWingDragEstimateN);
  const dragMeaning = wakeDragDelta.percent === null ? 'undefined' : classifyDragChange(wakeDragDelta.percent);
  const allConfiguredChecksPass = candidate.constraints.length === 5 && candidate.constraints.every((constraint) => constraint.state === 'pass');
  useProjectStore.getState().focusComparison(referenceId, candidateId, candidate.designId, 'agent');
  return {
    ok: true,
    replayed: false,
    data: {
      reference: { analysisId: referenceId, designId: reference.designId, designRevision: reference.designRevision },
      candidate: { analysisId: candidateId, designId: candidate.designId, designRevision: candidate.designRevision },
      compatibility: { compatible: true, flightCaseRevision: candidate.flightCaseRevision, constraintsRevision: candidate.constraintsRevision, fidelity: candidate.fidelity, solverVersion: candidate.solverVersion },
      deltas: {
        modeledWingBoxWallMassKg: wallMassDelta,
        wakeInducedDragEstimateN: { ...wakeDragDelta, meaning: dragMeaning },
        profileDragEstimateN: profileDragDelta,
        combinedWingDragEstimateN: combinedDragDelta,
        tipDeflectionM: delta(candidate.metrics.tipDeflectionM, reference.metrics.tipDeflectionM),
        tipElasticTwistDeg: delta(candidate.metrics.tipElasticTwistDeg, reference.metrics.tipElasticTwistDeg),
        modeledYieldRatio: delta(candidate.metrics.minYieldMargin, reference.metrics.minYieldMargin),
      },
      candidateConstraints: candidate.constraints.map((constraint) => ({ key: constraint.key, state: constraint.state, actual: constraint.actual, limit: constraint.limit, unit: constraint.unit })),
      visualFocusApplied: true,
      summary: allConfiguredChecksPass && wallMassDelta.percent !== null && wallMassDelta.percent <= -state.constraints.minMassReductionPct && dragMeaning === 'neutral'
        ? CANONICAL_TRADE_OFF_SENTENCE
        : `Exact current analyses pinned. Wake-induced-drag change is classified as ${dragMeaning}; ${allConfiguredChecksPass ? 'all five configured checks pass.' : 'one or more configured checks fail or remain unavailable, and neutral display language does not override the strict no-worse check.'}`,
    },
  };
}

export interface AeroficiencyToolAnnotations {
  readOnlyHint: boolean;
  untrustedContentHint: boolean;
}

export interface AeroficiencyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: AeroficiencyToolAnnotations;
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>;
}

export const AEROFICIENCY_TOOLS: AeroficiencyToolDefinition[] = [
  {
    name: 'get_design_state',
    description: 'Read bounded Aeroficiency design summaries and one full compact design detail: the active design by default, or an explicit inspected design while retaining active identity; includes revisions, airfoil/polar metadata, target-lift case, checks, freshness, and recent activity.',
    inputSchema: objectSchema({ designId: idSchema('des') }), annotations: annotations(true),
    execute: (input, context) => parsed(designStateInput, input, ({ designId: requested }) => getDesignState(requested as DesignId | undefined), context?.signal),
  },
  {
    name: 'get_analysis_summary',
    description: 'Read bounded metrics, convergence, configured checks, critical stations, and complete compact model validity for one explicit immutable Aeroficiency analysis ID.',
    inputSchema: objectSchema({ analysisId: idSchema('ana') }, ['analysisId']), annotations: annotations(true),
    execute: (input, context) => parsed(analysisInput, input, ({ analysisId: id }) => getAnalysisSummary(id as AnalysisId), context?.signal),
  },
  {
    name: 'inspect_span_station',
    description: 'Focus visible page evidence on the nearest station of one current converged immutable analysis at eta 0–1; changes only transient presentation state, never engineering data or activity.',
    inputSchema: objectSchema({ analysisId: idSchema('ana'), eta: { type: 'number', minimum: 0, maximum: 1 } }, ['analysisId', 'eta']), annotations: annotations(false),
    execute: (input, context) => parsed(stationInput, input, ({ analysisId: id, eta }) => inspectStation(id as AnalysisId, eta), context?.signal),
  },
  {
    name: 'create_candidate_variant',
    description: 'Idempotently branch an editable candidate from an explicit Aeroficiency source design revision; at least one candidate is required for comparison.',
    inputSchema: objectSchema({ sourceDesignId: idSchema('des'), expectedProjectRevision: { type: 'integer', minimum: 1 }, expectedSourceDesignRevision: { type: 'integer', minimum: 1 }, candidateLabel: { type: 'string', minLength: 1, maxLength: 48, pattern: '^(?=.*\\S)[^\\u0000-\\u001F\\u007F]{1,48}$' }, idempotencyKey: uuidSchema }, ['sourceDesignId', 'expectedProjectRevision', 'expectedSourceDesignRevision', 'candidateLabel', 'idempotencyKey']), annotations: annotations(false),
    execute: (input, context) => parsed(createCandidateInput, input, (value) => {
      const result = useProjectStore.getState().createCandidate(value.sourceDesignId as DesignId, value.candidateLabel, 'agent', value.idempotencyKey, value.expectedSourceDesignRevision, value.expectedProjectRevision);
      if (!result.ok || !result.replayed) return result;
      return { ...result, data: { ...result.data, replayState: designReplayState(result.data.designId, result.data.revision) } };
    }, context?.signal),
  },
  {
    name: 'set_baseline_design',
    description: 'Idempotently make an explicit candidate the editable Baseline reference; the previous Baseline remains as a candidate and dependent comparisons become stale.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedProjectRevision: { type: 'integer', minimum: 1 }, expectedDesignRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema }, ['designId', 'expectedProjectRevision', 'expectedDesignRevision', 'idempotencyKey']), annotations: annotations(false),
    execute: (input, context) => parsed(setBaselineInput, input, (value) => {
      const result = useProjectStore.getState().setBaseline(value.designId as DesignId, 'agent', value.idempotencyKey, value.expectedDesignRevision, value.expectedProjectRevision);
      if (!result.ok || !result.replayed) return result;
      return { ...result, data: { ...result.data, replayState: designReplayState(result.data.baselineDesignId, result.data.baselineDesignRevision) } };
    }, context?.signal),
  },
  {
    name: 'update_wing_geometry',
    description: 'Idempotently apply absolute, bounded planform, multi-station airfoil, or section-polar values to any design at an explicit revision; Baseline edits stale dependent comparisons.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedDesignRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, patch: geometryPatchSchema }, ['designId', 'expectedDesignRevision', 'idempotencyKey', 'patch']), annotations: annotations(false),
    execute: (input, context) => parsed(updateGeometryInput, input, (value) => {
      const result = useProjectStore.getState().updateGeometry(value.designId as DesignId, value.patch, 'agent', value.idempotencyKey, value.expectedDesignRevision);
      if (!result.ok || !result.replayed) return result;
      return { ...result, data: { ...result.data, replayState: designReplayState(result.data.designId, result.data.newDesignRevision) } };
    }, context?.signal),
  },
  {
    name: 'update_wing_structure',
    description: 'Idempotently apply absolute, bounded wing-box gauges or elastic-axis location to any design at an explicit revision; Baseline edits stale dependent comparisons.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedDesignRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, patch: { ...objectSchema({ skinThicknessMm: { type: 'number', minimum: 1.2, maximum: 6 }, frontWebThicknessMm: { type: 'number', minimum: 1.5, maximum: 8 }, rearWebThicknessMm: { type: 'number', minimum: 1.5, maximum: 8 }, elasticAxisXOverC: { type: 'number', exclusiveMinimum: 0.2, maximum: 0.55 } }), minProperties: 1 } }, ['designId', 'expectedDesignRevision', 'idempotencyKey', 'patch']), annotations: annotations(false),
    execute: (input, context) => parsed(updateStructureInput, input, (value) => {
      const result = useProjectStore.getState().updateStructure(value.designId as DesignId, value.patch, 'agent', value.idempotencyKey, value.expectedDesignRevision);
      if (!result.ok || !result.replayed) return result;
      return { ...result, data: { ...result.data, replayState: designReplayState(result.data.designId, result.data.newDesignRevision) } };
    }, context?.signal),
  },
  {
    name: 'run_aeroelastic_analysis',
    description: 'Run and visibly commit Aeroficiency low-order target-lift, torsion-coupled static analysis for one explicit current revision; this writes an immutable result and activity event.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedProjectRevision: { type: 'integer', minimum: 1 }, expectedDesignRevision: { type: 'integer', minimum: 1 }, expectedFlightCaseRevision: { type: 'integer', minimum: 1 }, expectedConstraintsRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, fidelity: { type: 'string', enum: ['fast', 'standard'] } }, ['designId', 'expectedProjectRevision', 'expectedDesignRevision', 'expectedFlightCaseRevision', 'expectedConstraintsRevision', 'idempotencyKey', 'fidelity']), annotations: annotations(false),
    execute: (input, context) => parsed(runInput, input, async (value, signal) => {
      const result = await useProjectStore.getState().runAnalysis({ ...value, designId: value.designId as DesignId }, 'agent', signal);
      if (!result.ok) return result;
      const currentProject = useProjectStore.getState().project;
      const snapshotRetained = Boolean(currentProject.analyses[result.data.analysisId]);
      const snapshotCurrent = snapshotRetained && analysisIsCurrent(currentProject, result.data.analysisId);
      const owner = currentProject.designs[result.data.designId];
      const currentReplacementAnalysisId = owner?.latestAnalysisId && analysisIsCurrent(currentProject, owner.latestAnalysisId)
        ? owner.latestAnalysisId
        : null;
      const { metrics, warnings, allConstraintsSatisfied, checkSummary, ...data } = result.data;
      void warnings;
      void allConstraintsSatisfied;
      return {
        ...result,
        data: {
          ...data,
          metrics: publicMetrics(metrics),
          checkSummary,
          snapshotRetention: {
            retained: snapshotRetained,
            inspectable: snapshotRetained,
            current: snapshotCurrent,
            currentReplacementAnalysisId: snapshotCurrent ? null : currentReplacementAnalysisId,
          },
          modelValidity: compactModelValidity(),
        },
      };
    }, context?.signal),
  },
  {
    name: 'compare_designs',
    description: 'Compare and visibly pin an exact current Baseline/candidate analysis pair without launching a solver; changes only transient presentation state and rejects stale or incompatible results.',
    inputSchema: objectSchema({ referenceAnalysisId: idSchema('ana'), candidateAnalysisId: idSchema('ana') }, ['referenceAnalysisId', 'candidateAnalysisId']), annotations: annotations(false),
    execute: (input, context) => parsed(compareInput, input, ({ referenceAnalysisId, candidateAnalysisId }) => compareAnalyses(referenceAnalysisId as AnalysisId, candidateAnalysisId as AnalysisId), context?.signal),
  },
];
