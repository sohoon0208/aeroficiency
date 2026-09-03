import { analysisIsCurrent } from '@/lib/domain/commands';
import { designInputFingerprint } from '@/lib/domain/validation';
import type { AnalysisSnapshot, ProjectState, WingDesign } from '@/lib/domain/types';
import type { ClassifiedDesign, ExportCounts } from './types';

function designOrder(left: WingDesign, right: WingDesign) {
  if (left.kind !== right.kind) return left.kind === 'baseline' ? -1 : 1;
  const created = left.createdAt.localeCompare(right.createdAt);
  return created || left.designId.localeCompare(right.designId);
}

function shortId(designId: string) {
  const normalized = designId.replace(/[^a-z0-9]/giu, '').toLowerCase();
  return (normalized.slice(-8) || 'unknown').padStart(8, '0');
}

function folderName(kind: WingDesign['kind'], index: number, designId: string, used: Set<string>) {
  const prefix = kind === 'baseline' ? 'baseline' : 'candidate';
  const base = `${prefix}-${String(index).padStart(2, '0')}-${shortId(designId)}`;
  let folder = base;
  let suffix = 2;
  while (used.has(folder)) folder = `${base}-${suffix++}`;
  used.add(folder);
  return folder;
}

function matchingInputFingerprint(state: ProjectState, design: WingDesign, analysis: AnalysisSnapshot) {
  try {
    return designInputFingerprint(state, design, analysis.fidelity) === analysis.inputFingerprint;
  } catch {
    return false;
  }
}

/**
 * Matches the same immutable inputs used by the solver trust boundary without
 * relaxing the stronger `analysisIsCurrent` rule used for current results.
 */
export function analysisMatchesCapturedInputs(state: ProjectState, design: WingDesign, analysis: AnalysisSnapshot) {
  return analysis.designId === design.designId
    && analysis.designKind === design.kind
    && analysis.designRevision === design.revision
    && analysis.flightCaseRevision === state.flightCase.revision
    && analysis.constraintsRevision === state.constraints.revision
    && analysis.solverVersion === state.solverVersion
    && matchingInputFingerprint(state, design, analysis);
}

function newestMatchingDiagnostic(state: ProjectState, design: WingDesign) {
  return Object.values(state.analyses)
    .filter((analysis) => analysis.status !== 'converged' && analysisMatchesCapturedInputs(state, design, analysis))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.analysisId.localeCompare(left.analysisId))[0] ?? null;
}

function classifyDesign(state: ProjectState, design: WingDesign, index: number, usedFolders: Set<string>): ClassifiedDesign {
  const latestAnalysis = design.latestAnalysisId ? state.analyses[design.latestAnalysisId] ?? null : null;
  if (design.latestAnalysisId && latestAnalysis?.status === 'converged' && analysisMatchesCapturedInputs(state, design, latestAnalysis) && analysisIsCurrent(state, design.latestAnalysisId)) {
    return {
      code: design.kind === 'baseline' ? 'BASELINE' : `C${String(index).padStart(3, '0')}`,
      folder: folderName(design.kind, design.kind === 'baseline' ? 1 : index, design.designId, usedFolders),
      design,
      classification: 'current_converged',
      analysisFreshness: 'current',
      analysis: latestAnalysis,
      latestAnalysis,
      reason: 'The latest retained analysis is converged and matches the current design, flight case, constraints, solver, and input fingerprint.',
    };
  }

  const diagnostic = newestMatchingDiagnostic(state, design);
  if (diagnostic) {
    return {
      code: design.kind === 'baseline' ? 'BASELINE' : `C${String(index).padStart(3, '0')}`,
      folder: folderName(design.kind, design.kind === 'baseline' ? 1 : index, design.designId, usedFolders),
      design,
      classification: 'diagnostic_not_converged',
      analysisFreshness: 'diagnostic',
      analysis: diagnostic,
      latestAnalysis,
      reason: 'A retained non-converged or failed analysis matches the current inputs; only diagnostics are exported.',
    };
  }

  const classification = !design.latestAnalysisId
    ? 'unanalysed'
    : latestAnalysis
      ? 'stale'
      : 'snapshot_missing';
  const reason = classification === 'unanalysed'
    ? 'No analysis has been run for this design revision.'
    : classification === 'snapshot_missing'
      ? 'The design references a retained analysis that is no longer available.'
      : 'The latest retained analysis does not match the current design inputs or shared settings.';
  return {
    code: design.kind === 'baseline' ? 'BASELINE' : `C${String(index).padStart(3, '0')}`,
    folder: folderName(design.kind, design.kind === 'baseline' ? 1 : index, design.designId, usedFolders),
    design,
    classification,
    analysisFreshness: classification === 'stale' ? 'stale' : 'unavailable',
    analysis: null,
    latestAnalysis,
    reason,
  };
}

export function classifyDesigns(state: ProjectState): ClassifiedDesign[] {
  const designs = Object.values(state.designs).sort(designOrder);
  const usedFolders = new Set<string>();
  let candidateIndex = 0;
  return designs.map((design) => {
    if (design.kind === 'candidate') candidateIndex += 1;
    return classifyDesign(state, design, design.kind === 'baseline' ? 0 : candidateIndex, usedFolders);
  });
}

export function summarizeExportCounts(classifications: readonly ClassifiedDesign[]): ExportCounts {
  return classifications.reduce<ExportCounts>((counts, item) => {
    counts.totalDesigns += 1;
    if (item.classification === 'current_converged') { counts.currentConverged += 1; counts.detailedAnalyses += 1; }
    if (item.classification === 'diagnostic_not_converged') counts.diagnosticNotConverged += 1;
    if (item.classification === 'stale') counts.stale += 1;
    if (item.classification === 'unanalysed') counts.unanalysed += 1;
    if (item.classification === 'snapshot_missing') counts.snapshotMissing += 1;
    return counts;
  }, {
    totalDesigns: 0,
    currentConverged: 0,
    diagnosticNotConverged: 0,
    stale: 0,
    unanalysed: 0,
    snapshotMissing: 0,
    detailedAnalyses: 0,
  });
}

export function compatibleAnalyses(reference: AnalysisSnapshot, candidate: AnalysisSnapshot) {
  return reference.flightCaseRevision === candidate.flightCaseRevision
    && reference.constraintsRevision === candidate.constraintsRevision
    && reference.fidelity === candidate.fidelity
    && reference.solverVersion === candidate.solverVersion;
}
