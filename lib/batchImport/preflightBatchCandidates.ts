import {
  analysisIsCurrent,
  createCandidateVariant,
  preflightAnalysisRun,
  updateWingGeometry,
  updateWingStructure,
  type RunAnalysisRequest,
} from '@/lib/domain/commands';
import { MAX_DESIGNS } from '@/lib/domain/limits';
import type { AnalysisSnapshot, DesignId, ProjectState } from '@/lib/domain/types';
import type { BatchIssue, BatchRevisionFingerprint, CandidatePreview, NormalizedCandidateInput, BatchPreflightResult } from './types';

function error(message: string, candidateCode?: string): BatchIssue {
  return { severity: 'error', message, ...(candidateCode ? { candidateCode } : {}) };
}

function commandIssues(result: { ok: false; error: { message: string; issues?: Array<{ path: string; reason: string }> } }, candidateCode: string): BatchIssue[] {
  const issues = result.error.issues?.map((item) => ({
    severity: 'error' as const,
    message: item.reason,
    column: item.path,
    candidateCode,
  })) ?? [];
  return issues.length ? issues : [error(result.error.message, candidateCode)];
}

function buildPreview(candidate: NormalizedCandidateInput, project: ProjectState, designId: string): CandidatePreview {
  const design = project.designs[designId as keyof ProjectState['designs']];
  const allGeometry = ['spanM', 'rootChordM', 'tipChordM', 'tipTwistDeg', 'airfoilStations', 'nacaCode', 'polarModel'];
  const allStructure = ['skinThicknessMm', 'frontWebThicknessMm', 'rearWebThicknessMm', 'elasticAxisXOverC'];
  const overriddenFields = [
    ...Object.keys(candidate.geometryPatch).map((field) => `geometry.${field}`),
    ...Object.keys(candidate.structurePatch).map((field) => `structure.${field}`),
  ];
  const inheritedFields = [...allGeometry.filter((field) => !Object.hasOwn(candidate.geometryPatch, field)).map((field) => `geometry.${field}`), ...allStructure.filter((field) => !Object.hasOwn(candidate.structurePatch, field)).map((field) => `structure.${field}`)];
  return {
    candidateCode: candidate.candidateCode,
    candidateLabel: candidate.candidateLabel,
    sourceRows: candidate.sourceRows,
    stationMode: candidate.stationMode,
    stationCount: design?.geometry.airfoilStations.length ?? candidate.stations?.length ?? 0,
    overriddenFields,
    inheritedFields,
    warnings: candidate.warnings,
  };
}

function currentBaselineAnalysis(project: ProjectState, baselineId: DesignId): AnalysisSnapshot | null {
  const baseline = project.designs[baselineId];
  if (!baseline?.latestAnalysisId) return null;
  const analysis = project.analyses[baseline.latestAnalysisId];
  return analysis && analysis.fidelity === 'standard' && analysisIsCurrent(project, analysis.analysisId) ? analysis : null;
}

/**
 * Validate the complete import before any live Zustand command runs. The
 * existing domain commands validate a cloned state so the preview follows the
 * same revision, capacity, geometry, and analysis rules as normal editing.
 */
export function preflightBatchCandidates(input: {
  project: ProjectState;
  baselineDesignId: string;
  candidates: NormalizedCandidateInput[];
  sessionId: string;
}): BatchPreflightResult {
  const { project, baselineDesignId, candidates, sessionId } = input;
  const baseline = project.designs[baselineDesignId as keyof ProjectState['designs']];
  const issues: BatchIssue[] = [];
  if (!baseline || baseline.kind !== 'baseline') issues.push(error('Choose a valid Baseline design before importing candidates.'));
  if (candidates.length === 0) issues.push(error('The import must contain at least one candidate.'));
  const available = Math.max(0, MAX_DESIGNS - Object.keys(project.designs).length);
  if (candidates.length > available) issues.push(error(`This workspace has room for ${available} more candidate${available === 1 ? '' : 's'}; the file contains ${candidates.length}.`));
  const baselineAnalysis = baseline ? currentBaselineAnalysis(project, baseline.designId) : null;
  if (issues.length) return { ok: false, issues };

  const fingerprint: BatchRevisionFingerprint = {
    projectRevision: project.projectRevision,
    baselineDesignId: baseline!.designId,
    baselineDesignRevision: baseline!.revision,
    baselineLatestAnalysisIdAtPreview: baseline!.latestAnalysisId,
    reusableStandardBaselineAnalysisId: baselineAnalysis?.analysisId ?? null,
    flightCaseRevision: project.flightCase.revision,
    constraintsRevision: project.constraints.revision,
    solverVersion: project.solverVersion,
  };

  let simulated = structuredClone(project);
  const previews: CandidatePreview[] = [];
  const executableCandidates: NormalizedCandidateInput[] = [];
  for (const candidate of candidates) {
    const createKey = `${sessionId}:${candidate.candidateCode}:create`;
    const created = createCandidateVariant(simulated, {
      sourceDesignId: baseline!.designId,
      expectedProjectRevision: simulated.projectRevision,
      expectedSourceDesignRevision: baseline!.revision,
      candidateLabel: candidate.candidateLabel,
      idempotencyKey: createKey,
    }, 'human');
    if (!created.result.ok) {
      issues.push(...commandIssues(created.result, candidate.candidateCode));
      continue;
    }
    simulated = created.state;
    const designId = created.result.data.designId;
    let designRevision = simulated.designs[designId].revision;
    if (Object.keys(candidate.geometryPatch).length) {
      const updated = updateWingGeometry(simulated, {
        designId,
        expectedDesignRevision: designRevision,
        idempotencyKey: `${sessionId}:${candidate.candidateCode}:geometry`,
        patch: candidate.geometryPatch,
      }, 'human');
      if (!updated.result.ok) {
        issues.push(...commandIssues(updated.result, candidate.candidateCode));
        continue;
      }
      simulated = updated.state;
      designRevision = updated.result.data.newDesignRevision;
    }
    if (Object.keys(candidate.structurePatch).length) {
      const updated = updateWingStructure(simulated, {
        designId,
        expectedDesignRevision: designRevision,
        idempotencyKey: `${sessionId}:${candidate.candidateCode}:structure`,
        patch: candidate.structurePatch,
      }, 'human');
      if (!updated.result.ok) {
        issues.push(...commandIssues(updated.result, candidate.candidateCode));
        continue;
      }
      simulated = updated.state;
      designRevision = updated.result.data.newDesignRevision;
    }
    const request: RunAnalysisRequest = {
      designId,
      expectedProjectRevision: simulated.projectRevision,
      expectedDesignRevision: designRevision,
      expectedFlightCaseRevision: simulated.flightCase.revision,
      expectedConstraintsRevision: simulated.constraints.revision,
      idempotencyKey: `${sessionId}:${candidate.candidateCode}:analysis`,
      fidelity: 'standard',
    };
    const ready = preflightAnalysisRun(simulated, request);
    if (!ready.ok) {
      issues.push(...commandIssues(ready, candidate.candidateCode));
      continue;
    }
    previews.push(buildPreview(candidate, simulated, designId));
    executableCandidates.push(structuredClone(candidate));
  }

  if (issues.length) return { ok: false, issues: issues.slice(0, 50) };
  return {
    ok: true,
    plan: {
      sessionId,
      baselineDesignId: baseline!.designId,
      baselineAnalysisRequired: !baselineAnalysis,
      availableSlots: available,
      fingerprint,
      candidates: executableCandidates,
      previews,
    },
  };
}
