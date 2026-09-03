import type { RunAnalysisRequest, RunAnalysisResult, UpdateDesignResult, CreateCandidateResult } from '@/lib/domain/commands';
import type { AnalysisId, DesignId, DomainResult, ProjectState, WingGeometry, WingStructure } from '@/lib/domain/types';

export type BatchIssueSeverity = 'error' | 'warning';

export interface BatchIssue {
  severity: BatchIssueSeverity;
  message: string;
  rowNumber?: number;
  column?: string;
  candidateCode?: string;
}

export interface CsvRow {
  rowNumber: number;
  values: string[];
}

export interface CsvDocument {
  headers: string[];
  rows: CsvRow[];
}

export type CsvParseResult =
  | { ok: true; data: CsvDocument }
  | { ok: false; issues: BatchIssue[] };

export interface NormalizedCandidateInput {
  candidateCode: string;
  candidateLabel: string;
  sourceRows: number[];
  geometryPatch: Partial<WingGeometry>;
  structurePatch: Partial<WingStructure>;
  stationMode: 'inherit' | 'replace';
  stations: NonNullable<Partial<WingGeometry>['airfoilStations']> | null;
  warnings: BatchIssue[];
}

export interface CandidatePreview {
  candidateCode: string;
  candidateLabel: string;
  sourceRows: number[];
  stationMode: NormalizedCandidateInput['stationMode'];
  stationCount: number;
  overriddenFields: string[];
  inheritedFields: string[];
  warnings: BatchIssue[];
}

export interface BatchRevisionFingerprint {
  projectRevision: number;
  baselineDesignId: DesignId;
  baselineDesignRevision: number;
  baselineLatestAnalysisIdAtPreview: AnalysisId | null;
  reusableStandardBaselineAnalysisId: AnalysisId | null;
  flightCaseRevision: number;
  constraintsRevision: number;
  solverVersion: string;
}

export interface BatchImportPlan {
  sessionId: string;
  baselineDesignId: DesignId;
  baselineAnalysisRequired: boolean;
  availableSlots: number;
  fingerprint: BatchRevisionFingerprint;
  candidates: NormalizedCandidateInput[];
  previews: CandidatePreview[];
}

export type BatchPreflightResult =
  | { ok: true; plan: BatchImportPlan }
  | { ok: false; issues: BatchIssue[] };

export interface BatchCommandPort {
  getProjectSnapshot: () => ProjectState;
  /** Optional live guard used by the UI-backed port to avoid partial work when another solve is active. */
  hasActiveAnalysis?: () => boolean;
  createCandidate: ProjectStoreCreateCandidate;
  updateGeometry: ProjectStoreUpdateGeometry;
  updateStructure: ProjectStoreUpdateStructure;
  runAnalysis: ProjectStoreRunAnalysis;
}

export type ProjectStoreCreateCandidate = (
  sourceDesignId: DesignId,
  label: string,
  actor: 'human' | 'agent' | 'solver' | 'system',
  idempotencyKey?: string,
  expectedRevision?: number,
  expectedProjectRevision?: number,
) => DomainResult<CreateCandidateResult>;

export type ProjectStoreUpdateGeometry = (
  designId: DesignId,
  patch: Partial<WingGeometry>,
  actor: 'human' | 'agent' | 'solver' | 'system',
  idempotencyKey?: string,
  expectedRevision?: number,
) => DomainResult<UpdateDesignResult>;

export type ProjectStoreUpdateStructure = (
  designId: DesignId,
  patch: Partial<WingStructure>,
  actor: 'human' | 'agent' | 'solver' | 'system',
  idempotencyKey?: string,
  expectedRevision?: number,
) => DomainResult<UpdateDesignResult>;

export type ProjectStoreRunAnalysis = (
  request: RunAnalysisRequest,
  actor: 'human' | 'agent' | 'solver' | 'system',
  signal?: AbortSignal,
) => Promise<DomainResult<RunAnalysisResult>>;

export interface BatchProgressEvent {
  candidateCode: string;
  candidateIndex: number;
  candidateCount: number;
  phase: 'preparing-baseline' | 'creating' | 'configuring' | 'analyzing' | 'succeeded' | 'failed' | 'skipped';
  designId?: DesignId;
  analysisId?: AnalysisId;
  message?: string;
}

export interface BatchCandidateExecutionResult {
  candidateCode: string;
  candidateLabel: string;
  status: 'succeeded' | 'failed' | 'skipped';
  designId?: DesignId;
  analysisId?: AnalysisId;
  message: string;
}

export interface BatchExecutionResult {
  status: 'complete' | 'cancelled' | 'conflicted';
  results: BatchCandidateExecutionResult[];
  message: string;
}
