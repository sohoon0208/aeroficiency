import { z, type ZodType } from 'zod';
import { analysisIsCurrent } from '@/lib/domain/commands';
import { designAnalysisFreshness } from '@/lib/domain/validation';
import type { AnalysisId, DesignId, DomainFailure, DomainIssue, DomainResult } from '@/lib/domain/types';
import { useProjectStore } from '@/store/projectStore';

const designId = z.string().regex(/^des_[0-9A-Z]+$/);
const analysisId = z.string().regex(/^ana_[0-9A-Z]+$/);
const idempotencyKey = z.string().uuid();
const emptyInput = z.object({}).strict();
const analysisInput = z.object({ analysisId }).strict();
const stationInput = z.object({ analysisId, eta: z.number().finite().min(0).max(1) }).strict();
const createCandidateInput = z.object({
  sourceDesignId: designId,
  expectedSourceDesignRevision: z.number().int().positive(),
  candidateLabel: z.string().trim().min(1).max(48),
  idempotencyKey,
}).strict();
const geometryPatch = z.object({
  spanM: z.number().finite().min(4).max(16).optional(),
  rootChordM: z.number().finite().min(0.8).max(4).optional(),
  tipChordM: z.number().finite().min(0.3).max(3).optional(),
  tipTwistDeg: z.number().finite().min(-6).max(3).optional(),
  nacaCode: z.string().regex(/^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/).optional(),
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
  expectedDesignRevision: z.number().int().positive(),
  expectedFlightCaseRevision: z.number().int().positive(),
  expectedConstraintsRevision: z.number().int().positive(),
  idempotencyKey,
  fidelity: z.enum(['fast', 'standard']),
}).strict();
const compareInput = z.object({ referenceAnalysisId: analysisId, candidateAnalysisId: analysisId }).strict();

function fail(code: DomainFailure['error']['code'], message: string, safeNextAction: string, options: Partial<DomainFailure['error']> = {}): DomainFailure {
  return { ok: false, error: { code, message, retryable: false, safeNextAction, ...options } };
}

function validationFailure(error: z.ZodError): DomainFailure {
  const issues: DomainIssue[] = error.issues.slice(0, 6).map((issue) => ({ path: issue.path.join('.') || 'input', reason: issue.message }));
  return fail('VALIDATION_ERROR', 'Tool input did not match the bounded Aerociency contract.', 'Correct the listed fields and retry.', { issues });
}

async function parsed<T>(schema: ZodType<T>, input: unknown, execute: (value: T, signal?: AbortSignal) => unknown | Promise<unknown>, signal?: AbortSignal) {
  const result = schema.safeParse(input);
  if (!result.success) return validationFailure(result.error);
  try {
    return structuredClone(await execute(result.data, signal));
  } catch (error) {
    return fail('ANALYSIS_FAILED', error instanceof Error ? error.message : 'The tool failed safely.', 'Read the current design state before retrying.');
  }
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
const idSchema = (prefix: 'des' | 'ana') => ({ type: 'string', pattern: `^${prefix}_[0-9A-Z]+$` });
const uuidSchema = { type: 'string', format: 'uuid' };
const annotations = (readOnly: boolean) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: true });

function getDesignState(): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  return {
    ok: true,
    replayed: false,
    data: {
      projectId: state.projectId,
      projectRevision: state.projectRevision,
      activeDesignId: state.activeDesignId,
      selectedAnalysisId: state.selectedAnalysisId,
      designs: Object.values(state.designs).map((design) => ({
        designId: design.designId,
        label: design.label,
        kind: design.kind,
        revision: design.revision,
        sourceDesignId: design.sourceDesignId,
        sourceDesignRevision: design.sourceDesignRevision,
        geometry: design.geometry,
        structure: design.structure,
        latestAnalysisId: design.latestAnalysisId,
        analysisFreshness: designAnalysisFreshness(state, design),
      })),
      flightCase: state.flightCase,
      constraints: state.constraints,
      solverVersion: state.solverVersion,
      recentActivity: state.activities.slice(0, 3).map((event) => ({ actor: event.actor, operation: event.operation, targetDesignId: event.targetDesignId, fromRevision: event.fromRevision, toRevision: event.toRevision, summary: event.summary, analysisId: event.analysisId })),
      summary: 'Read explicit revisions before any write; the baseline is protected.',
    },
  };
}

function criticalStations(stations: ReturnType<typeof useProjectStore.getState>['project']['analyses'][AnalysisId]['stations']) {
  const root = stations[0];
  const tip = stations[stations.length - 1];
  const minimumMargin = stations.filter((station) => station.yieldMargin !== null).reduce((minimum, station) => (
    !minimum || (station.yieldMargin ?? Number.POSITIVE_INFINITY) < (minimum.yieldMargin ?? Number.POSITIVE_INFINITY) ? station : minimum
  ), null as typeof stations[number] | null);
  return [root, minimumMargin, tip].filter((station, index, list) => station && list.findIndex((candidate) => candidate?.eta === station.eta) === index).map((station) => ({
    eta: station!.eta,
    yM: station!.yM,
    liftPerSpanNpm: station!.liftPerSpanNpm,
    deflectionM: station!.deflectionM,
    elasticTwistDeg: station!.elasticTwistDeg,
    yieldMargin: station!.yieldMargin,
  }));
}

function getAnalysisSummary(id: AnalysisId): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  const analysis = state.analyses[id];
  if (!analysis) return fail('ANALYSIS_REQUIRED', 'The requested immutable analysis does not exist.', 'Run an analysis or read the current design state for available analysis IDs.');
  return {
    ok: true,
    replayed: false,
    data: {
      analysisId: analysis.analysisId,
      designId: analysis.designId,
      designRevision: analysis.designRevision,
      flightCaseRevision: analysis.flightCaseRevision,
      constraintsRevision: analysis.constraintsRevision,
      status: analysis.status,
      current: analysisIsCurrent(state, id),
      fidelity: analysis.fidelity,
      solverVersion: analysis.solverVersion,
      inputFingerprint: analysis.inputFingerprint,
      convergence: analysis.convergence,
      metrics: {
        structuralMassKg: analysis.metrics.structuralMassKg,
        liftN: analysis.metrics.liftN,
        liftCoefficient: analysis.metrics.liftCoefficient,
        inducedDragN: analysis.metrics.inducedDragN,
        inducedDragCoefficientEstimate: analysis.metrics.inducedDragCoefficientEstimate,
        trimmedAlphaDeg: analysis.metrics.trimmedAlphaDeg,
        tipDeflectionM: analysis.metrics.tipDeflectionM,
        tipElasticTwistDeg: analysis.metrics.tipElasticTwistDeg,
        minYieldMargin: analysis.metrics.minYieldMargin,
      },
      constraints: analysis.constraints.map((constraint) => ({ key: constraint.key, state: constraint.state, actual: constraint.actual, limit: constraint.limit, unit: constraint.unit })),
      criticalStations: criticalStations(analysis.stations),
      warnings: analysis.warnings.slice(0, 4),
      summary: analysis.status === 'converged' ? 'Coupled result converged; verify current before making a comparison.' : 'Result did not converge; constraints are unavailable.',
    },
  };
}

function inspectStation(id: AnalysisId, eta: number): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  const analysis = state.analyses[id];
  if (!analysis) return fail('ANALYSIS_REQUIRED', 'The requested immutable analysis does not exist.', 'Run an analysis or use get_design_state to find an analysis ID.');
  const station = analysis.stations.reduce((nearest, candidate) => Math.abs(candidate.eta - eta) < Math.abs(nearest.eta - eta) ? candidate : nearest);
  return { ok: true, replayed: false, data: { analysisId: id, designId: analysis.designId, requestedEta: eta, resolvedEta: station.eta, current: analysisIsCurrent(state, id), station, warnings: analysis.warnings.slice(0, 2), summary: `Resolved η=${eta.toFixed(3)} to solver station η=${station.eta.toFixed(3)}.` } };
}

function compareAnalyses(referenceId: AnalysisId, candidateId: AnalysisId): DomainResult<unknown> {
  const state = useProjectStore.getState().project;
  if (referenceId === candidateId) return fail('VALIDATION_ERROR', 'Reference and candidate analysis IDs must differ.', 'Choose two different immutable analyses.');
  const reference = state.analyses[referenceId];
  const candidate = state.analyses[candidateId];
  if (!reference || !candidate) return fail('ANALYSIS_REQUIRED', 'One or both immutable analyses do not exist.', 'Run the missing analysis and retry with explicit IDs.');
  if (!analysisIsCurrent(state, referenceId) || !analysisIsCurrent(state, candidateId)) return fail('STALE_ANALYSIS', 'Comparison requires two current converged analyses.', 'Run current analyses for both revisions; compare_designs never launches the solver.');
  if (reference.flightCaseRevision !== candidate.flightCaseRevision || reference.fidelity !== candidate.fidelity || reference.solverVersion !== candidate.solverVersion) return fail('VALIDATION_ERROR', 'Analyses use incompatible flight cases, fidelity, or solver versions.', 'Run both designs with identical settings before comparing.');
  const delta = (candidateValue: number, referenceValue: number) => ({ absolute: candidateValue - referenceValue, percent: referenceValue === 0 ? null : 100 * (candidateValue - referenceValue) / referenceValue });
  return {
    ok: true,
    replayed: false,
    data: {
      reference: { analysisId: referenceId, designId: reference.designId, designRevision: reference.designRevision },
      candidate: { analysisId: candidateId, designId: candidate.designId, designRevision: candidate.designRevision },
      deltas: {
        structuralMassKg: delta(candidate.metrics.structuralMassKg, reference.metrics.structuralMassKg),
        inducedDragN: delta(candidate.metrics.inducedDragN, reference.metrics.inducedDragN),
        tipDeflectionM: delta(candidate.metrics.tipDeflectionM, reference.metrics.tipDeflectionM),
        tipElasticTwistDeg: delta(candidate.metrics.tipElasticTwistDeg, reference.metrics.tipElasticTwistDeg),
        minYieldMargin: delta(candidate.metrics.minYieldMargin, reference.metrics.minYieldMargin),
      },
      candidateConstraints: candidate.constraints.map((constraint) => ({ key: constraint.key, state: constraint.state, actual: constraint.actual, limit: constraint.limit, unit: constraint.unit })),
      summary: 'Negative mass and induced-drag deltas are improvements; verify every candidate constraint before adoption.',
    },
  };
}

export interface AerociencyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: Record<string, boolean>;
  execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>;
}

export const AEROCIENCY_TOOLS: AerociencyToolDefinition[] = [
  {
    name: 'get_design_state',
    description: 'Read Aerociency designs, explicit revisions, target-lift case, constraints, freshness, and recent visible activity before planning a trade study.',
    inputSchema: objectSchema({}), annotations: annotations(true),
    execute: (input, context) => parsed(emptyInput, input, () => getDesignState(), context?.signal),
  },
  {
    name: 'get_analysis_summary',
    description: 'Read bounded metrics, convergence, constraints, critical stations, and warnings for one explicit immutable Aerociency analysis ID.',
    inputSchema: objectSchema({ analysisId: idSchema('ana') }, ['analysisId']), annotations: annotations(true),
    execute: (input, context) => parsed(analysisInput, input, ({ analysisId: id }) => getAnalysisSummary(id as AnalysisId), context?.signal),
  },
  {
    name: 'inspect_span_station',
    description: 'Inspect the nearest right-semispan solver station for one immutable analysis at normalized eta from root 0 to tip 1.',
    inputSchema: objectSchema({ analysisId: idSchema('ana'), eta: { type: 'number', minimum: 0, maximum: 1 } }, ['analysisId', 'eta']), annotations: annotations(true),
    execute: (input, context) => parsed(stationInput, input, ({ analysisId: id, eta }) => inspectStation(id as AnalysisId, eta), context?.signal),
  },
  {
    name: 'create_candidate_variant',
    description: 'Idempotently branch an editable candidate from an explicit Aerociency source design revision; the protected baseline is never modified.',
    inputSchema: objectSchema({ sourceDesignId: idSchema('des'), expectedSourceDesignRevision: { type: 'integer', minimum: 1 }, candidateLabel: { type: 'string', minLength: 1, maxLength: 48 }, idempotencyKey: uuidSchema }, ['sourceDesignId', 'expectedSourceDesignRevision', 'candidateLabel', 'idempotencyKey']), annotations: annotations(false),
    execute: (input, context) => parsed(createCandidateInput, input, (value) => useProjectStore.getState().createCandidate(value.sourceDesignId as DesignId, value.candidateLabel, 'agent', value.idempotencyKey, value.expectedSourceDesignRevision), context?.signal),
  },
  {
    name: 'update_wing_geometry',
    description: 'Idempotently apply absolute, bounded planform or NACA values to one editable candidate at an explicit revision.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedDesignRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, patch: objectSchema({ spanM: { type: 'number', minimum: 4, maximum: 16 }, rootChordM: { type: 'number', minimum: 0.8, maximum: 4 }, tipChordM: { type: 'number', minimum: 0.3, maximum: 3 }, tipTwistDeg: { type: 'number', minimum: -6, maximum: 3 }, nacaCode: { type: 'string', pattern: '^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$' } }) }, ['designId', 'expectedDesignRevision', 'idempotencyKey', 'patch']), annotations: annotations(false),
    execute: (input, context) => parsed(updateGeometryInput, input, (value) => useProjectStore.getState().updateGeometry(value.designId as DesignId, value.patch, 'agent', value.idempotencyKey, value.expectedDesignRevision), context?.signal),
  },
  {
    name: 'update_wing_structure',
    description: 'Idempotently apply absolute, bounded wing-box gauges or elastic-axis location to one editable candidate at an explicit revision.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedDesignRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, patch: objectSchema({ skinThicknessMm: { type: 'number', minimum: 1.2, maximum: 6 }, frontWebThicknessMm: { type: 'number', minimum: 1.5, maximum: 8 }, rearWebThicknessMm: { type: 'number', minimum: 1.5, maximum: 8 }, elasticAxisXOverC: { type: 'number', exclusiveMinimum: 0.2, maximum: 0.55 } }) }, ['designId', 'expectedDesignRevision', 'idempotencyKey', 'patch']), annotations: annotations(false),
    execute: (input, context) => parsed(updateStructureInput, input, (value) => useProjectStore.getState().updateStructure(value.designId as DesignId, value.patch, 'agent', value.idempotencyKey, value.expectedDesignRevision), context?.signal),
  },
  {
    name: 'run_aeroelastic_analysis',
    description: 'Run and visibly commit Aerociency target-lift torsional aeroelastic analysis for one explicit current revision; this writes an immutable result and activity event.',
    inputSchema: objectSchema({ designId: idSchema('des'), expectedDesignRevision: { type: 'integer', minimum: 1 }, expectedFlightCaseRevision: { type: 'integer', minimum: 1 }, expectedConstraintsRevision: { type: 'integer', minimum: 1 }, idempotencyKey: uuidSchema, fidelity: { type: 'string', enum: ['fast', 'standard'] } }, ['designId', 'expectedDesignRevision', 'expectedFlightCaseRevision', 'expectedConstraintsRevision', 'idempotencyKey', 'fidelity']), annotations: annotations(false),
    execute: (input, context) => parsed(runInput, input, (value, signal) => useProjectStore.getState().runAnalysis({ ...value, designId: value.designId as DesignId }, 'agent', signal), context?.signal),
  },
  {
    name: 'compare_designs',
    description: 'Compare two explicit immutable current analyses without launching a solver; rejects stale or incompatible results.',
    inputSchema: objectSchema({ referenceAnalysisId: idSchema('ana'), candidateAnalysisId: idSchema('ana') }, ['referenceAnalysisId', 'candidateAnalysisId']), annotations: annotations(true),
    execute: (input, context) => parsed(compareInput, input, ({ referenceAnalysisId, candidateAnalysisId }) => compareAnalyses(referenceAnalysisId as AnalysisId, candidateAnalysisId as AnalysisId), context?.signal),
  },
];
