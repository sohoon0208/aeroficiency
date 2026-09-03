import type { AnalysisSnapshot, ProjectState, WingDesign } from '@/lib/domain/types';

export type ExportDesignClassification =
  | 'current_converged'
  | 'diagnostic_not_converged'
  | 'stale'
  | 'unanalysed'
  | 'snapshot_missing';

export type ExportAnalysisFreshness = 'current' | 'diagnostic' | 'stale' | 'unavailable';

export interface ClassifiedDesign {
  code: string;
  folder: string;
  design: WingDesign;
  classification: ExportDesignClassification;
  analysisFreshness: ExportAnalysisFreshness;
  analysis: AnalysisSnapshot | null;
  latestAnalysis: AnalysisSnapshot | null;
  reason: string;
}

export interface ExportCounts {
  totalDesigns: number;
  currentConverged: number;
  diagnosticNotConverged: number;
  stale: number;
  unanalysed: number;
  snapshotMissing: number;
  detailedAnalyses: number;
}

export interface ResultsExportFile {
  path: string;
  content: string;
  contentType: 'text/plain' | 'text/csv' | 'application/json';
  sizeBytes: number;
}

export interface ResultsManifestFile {
  path: string;
  size_bytes: number;
  sha256: string | null;
}

export interface ResultsManifest {
  schema_version: string;
  exported_at_utc: string;
  application: {
    name: string;
    version: string;
    solver_version: string;
    tool_schema_version: string;
    build_commit: string;
  };
  source: 'local_client_snapshot';
  project: {
    project_id: string;
    project_revision: number;
    flight_case: Omit<ProjectState['flightCase'], 'revision'> & { revision: number };
    constraints: ProjectState['constraints'];
  };
  counts: ExportCounts;
  designs: Array<{
    candidate_code: string;
    design_id: string;
    design_label: string;
    design_role: string;
    folder: string;
    classification: ExportDesignClassification;
    analysis_id: string | null;
    reason: string;
  }>;
  files: ResultsManifestFile[];
  omissions: readonly string[];
}

export interface ResultsExportBundle {
  filename: string;
  generatedAt: string;
  files: ResultsExportFile[];
  classifications: ClassifiedDesign[];
  counts: ExportCounts;
  manifest: ResultsManifest;
}
