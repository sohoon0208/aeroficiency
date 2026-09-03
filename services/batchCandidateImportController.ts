import { analysisIsCurrent, type RunAnalysisRequest } from '@/lib/domain/commands';
import type { AnalysisId, DesignId, ProjectState } from '@/lib/domain/types';
import type {
  BatchCandidateExecutionResult,
  BatchCommandPort,
  BatchExecutionResult,
  BatchImportPlan,
  BatchProgressEvent,
  NormalizedCandidateInput,
} from '@/lib/batchImport/types';

interface BatchCursor {
  projectRevision: number;
  baselineDesignRevision: number;
  flightCaseRevision: number;
  constraintsRevision: number;
}

function emit(onProgress: (event: BatchProgressEvent) => void, event: BatchProgressEvent) {
  onProgress(event);
}

/**
 * Shared inputs are immutable for the whole batch. Project revision is exact,
 * rather than a lower bound: an unrelated write must never be absorbed into
 * the batch cursor.
 */
function sharedStateMatches(plan: BatchImportPlan, project: ProjectState, expectedBaselineAnalysisId: AnalysisId | null, expectedProjectRevision: number) {
  const baseline = project.designs[plan.baselineDesignId];
  return Boolean(
    baseline
    && baseline.kind === 'baseline'
    && baseline.revision === plan.fingerprint.baselineDesignRevision
    && baseline.latestAnalysisId === expectedBaselineAnalysisId
    && (!expectedBaselineAnalysisId || analysisIsCurrent(project, expectedBaselineAnalysisId))
    && project.projectRevision === expectedProjectRevision
    && project.flightCase.revision === plan.fingerprint.flightCaseRevision
    && project.constraints.revision === plan.fingerprint.constraintsRevision
    && project.solverVersion === plan.fingerprint.solverVersion,
  );
}

function skipResults(
  candidates: readonly NormalizedCandidateInput[],
  start: number,
  message: string,
  results: BatchCandidateExecutionResult[],
  candidateCount: number,
  onProgress: (event: BatchProgressEvent) => void,
) {
  for (let index = start; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'skipped', message });
    emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'skipped', message });
  }
}

function failureMessage(result: { ok: false; error: { message: string } }) {
  return result.error.message;
}

function resultProjectDelta(replayed: boolean, outcome?: 'changed' | 'unchanged') {
  return replayed || outcome === 'unchanged' ? 0 : 1;
}

function candidateSnapshotMatches(
  project: ProjectState,
  request: RunAnalysisRequest,
  analysisId: AnalysisId,
  status: 'converged' | 'not_converged' | 'failed',
  fidelity: RunAnalysisRequest['fidelity'],
) {
  const snapshot = project.analyses[analysisId];
  return Boolean(
    snapshot
    && snapshot.analysisId === analysisId
    && snapshot.designId === request.designId
    && snapshot.status === status
    && snapshot.designRevision === request.expectedDesignRevision
    && snapshot.flightCaseRevision === request.expectedFlightCaseRevision
    && snapshot.constraintsRevision === request.expectedConstraintsRevision
    && snapshot.fidelity === fidelity
    && snapshot.solverVersion === project.solverVersion,
  );
}

function diagnosticSnapshotMatches(
  project: ProjectState,
  request: RunAnalysisRequest,
  analysisId: AnalysisId,
) {
  const snapshot = project.analyses[analysisId];
  return Boolean(
    snapshot
    && snapshot.analysisId === analysisId
    && snapshot.designId === request.designId
    && (snapshot.status === 'not_converged' || snapshot.status === 'failed')
    && snapshot.designRevision === request.expectedDesignRevision
    && snapshot.flightCaseRevision === request.expectedFlightCaseRevision
    && snapshot.constraintsRevision === request.expectedConstraintsRevision
    && snapshot.fidelity === request.fidelity
    && snapshot.solverVersion === project.solverVersion,
  );
}

function committedDiagnosticIsSafe(
  plan: BatchImportPlan,
  before: ProjectState,
  after: ProjectState,
  expectedBaselineAnalysisId: AnalysisId | null,
  request: RunAnalysisRequest,
  analysisId: AnalysisId,
) {
  return (
    after.projectRevision === before.projectRevision + 1
    && sharedStateMatches(plan, after, expectedBaselineAnalysisId, after.projectRevision)
    && after.designs[request.designId]?.revision === request.expectedDesignRevision
    && diagnosticSnapshotMatches(after, request, analysisId)
  );
}

function committedAnalysisIsSafe(
  plan: BatchImportPlan,
  after: ProjectState,
  expectedBaselineAnalysisId: AnalysisId | null,
  beforeProjectRevision: number,
  request: RunAnalysisRequest,
  analysisId: AnalysisId,
  status: 'converged' | 'not_converged' | 'failed',
  replayed: boolean,
) {
  const expectedProjectRevision = request.expectedProjectRevision + (replayed ? 0 : 1);
  const design = after.designs[request.designId];
  return (
    after.projectRevision === expectedProjectRevision
    && sharedStateMatches(plan, after, expectedBaselineAnalysisId, expectedProjectRevision)
    && beforeProjectRevision === request.expectedProjectRevision
    && design?.revision === request.expectedDesignRevision
    && candidateSnapshotMatches(after, request, analysisId, status, request.fidelity)
  );
}

function uncommittedAnalysisIsSafe(plan: BatchImportPlan, before: ProjectState, after: ProjectState, expectedBaselineAnalysisId: AnalysisId | null, request: RunAnalysisRequest) {
  return (
    after.projectRevision === before.projectRevision
    && sharedStateMatches(plan, after, expectedBaselineAnalysisId, before.projectRevision)
    && after.designs[request.designId]?.revision === request.expectedDesignRevision
  );
}

function committedMutationIsSafe(
  plan: BatchImportPlan,
  before: ProjectState,
  after: ProjectState,
  expectedBaselineAnalysisId: AnalysisId | null,
  designId: DesignId,
  designRevision: number,
  projectRevision: number,
  replayed: boolean,
  outcome?: 'changed' | 'unchanged',
) {
  const expectedProjectRevision = before.projectRevision + resultProjectDelta(replayed, outcome);
  return (
    projectRevision === expectedProjectRevision
    && after.projectRevision === expectedProjectRevision
    && sharedStateMatches(plan, after, expectedBaselineAnalysisId, expectedProjectRevision)
    && after.designs[designId]?.revision === designRevision
  );
}

function sharedBaselineAnalysisId(plan: BatchImportPlan) {
  return plan.baselineAnalysisRequired
    ? plan.fingerprint.baselineLatestAnalysisIdAtPreview
    : plan.fingerprint.reusableStandardBaselineAnalysisId;
}

/** Execute one already-confirmed plan through the normal revision-checked store actions. */
export async function executeBatchCandidatePlan(input: {
  plan: BatchImportPlan;
  port: BatchCommandPort;
  signal: AbortSignal;
  onProgress?: (event: BatchProgressEvent) => void;
}): Promise<BatchExecutionResult> {
  const { plan, port, signal } = input;
  const onProgress = input.onProgress ?? (() => undefined);
  const results: BatchCandidateExecutionResult[] = [];
  const candidateCount = plan.candidates.length;
  const cursor: BatchCursor = {
    projectRevision: plan.fingerprint.projectRevision,
    baselineDesignRevision: plan.fingerprint.baselineDesignRevision,
    flightCaseRevision: plan.fingerprint.flightCaseRevision,
    constraintsRevision: plan.fingerprint.constraintsRevision,
  };
  let baselineAnalysisId = sharedBaselineAnalysisId(plan);

  let initial = port.getProjectSnapshot();
  if (!sharedStateMatches(plan, initial, baselineAnalysisId, cursor.projectRevision)) {
    skipResults(plan.candidates, 0, 'The workspace changed after preview; review the import again.', results, candidateCount, onProgress);
    return { status: 'conflicted', results, message: 'The workspace changed after preview; no candidate was created.' };
  }
  if (port.hasActiveAnalysis?.()) {
    skipResults(plan.candidates, 0, 'Skipped because another analysis is already running.', results, candidateCount, onProgress);
    return { status: 'conflicted', results, message: 'Batch stopped because another analysis is already running; no candidate was created.' };
  }

  if (plan.baselineAnalysisRequired) {
    if (signal.aborted) {
      skipResults(plan.candidates, 0, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
      return { status: 'cancelled', results, message: 'Batch cancelled before Baseline preparation; no candidate was created.' };
    }
    const baseline = initial.designs[plan.baselineDesignId];
    if (!baseline) {
      skipResults(plan.candidates, 0, 'Skipped because the Baseline is unavailable.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped because the Baseline is unavailable.' };
    }
    emit(onProgress, { candidateCode: 'BASELINE', candidateIndex: -1, candidateCount, phase: 'preparing-baseline', message: 'Preparing the current standard-fidelity Baseline analysis before creating candidates.' });
    const baselineRequest: RunAnalysisRequest = {
      designId: baseline.designId,
      expectedProjectRevision: cursor.projectRevision,
      expectedDesignRevision: baseline.revision,
      expectedFlightCaseRevision: cursor.flightCaseRevision,
      expectedConstraintsRevision: cursor.constraintsRevision,
      idempotencyKey: plan.sessionId + ':baseline:analysis',
      fidelity: 'standard',
    };
    const baselineRun = await port.runAnalysis(baselineRequest, 'human', signal);
    const afterBaseline = port.getProjectSnapshot();
    const baselineCommittedId = baselineRun.ok
      ? baselineRun.data.analysisId
      : baselineRun.error.committed && baselineRun.error.analysisId
        ? baselineRun.error.analysisId
        : null;
    const baselineCommittedStatus = baselineRun.ok ? baselineRun.data.status : null;
    const baselineCommitted = Boolean(
      baselineCommittedId
      && baselineCommittedStatus
      && committedAnalysisIsSafe(plan, afterBaseline, baselineCommittedId, initial.projectRevision, baselineRequest, baselineCommittedId, baselineCommittedStatus, baselineRun.ok && baselineRun.replayed),
    );
    const baselineDiagnosticCommitted = Boolean(
      baselineCommittedId
      && ((!baselineRun.ok && baselineRun.error.committed)
        || (baselineRun.ok && baselineRun.data.status !== 'converged'))
      && committedDiagnosticIsSafe(plan, initial, afterBaseline, plan.fingerprint.baselineLatestAnalysisIdAtPreview, baselineRequest, baselineCommittedId),
      );
    const baselineUncommittedSafe = sharedStateMatches(
      plan,
      afterBaseline,
      plan.fingerprint.baselineLatestAnalysisIdAtPreview,
      initial.projectRevision,
    );
    if (baselineCommitted || baselineDiagnosticCommitted) cursor.projectRevision = afterBaseline.projectRevision;
    if (!baselineCommitted && !baselineDiagnosticCommitted && !baselineUncommittedSafe) {
      skipResults(plan.candidates, 0, 'Skipped because shared workspace state changed during Baseline preparation.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped because shared workspace state changed during Baseline preparation.' };
    }
    if (signal.aborted || (!baselineRun.ok && baselineRun.error.code === 'ABORTED')) {
      skipResults(plan.candidates, 0, 'Skipped because Baseline preparation was cancelled.', results, candidateCount, onProgress);
      return { status: 'cancelled', results, message: 'Batch cancelled during Baseline preparation; no candidate was created.' };
    }
    if (!baselineRun.ok || baselineRun.data.status !== 'converged') {
      skipResults(plan.candidates, 0, 'Skipped because the Baseline did not produce a converged standard analysis.', results, candidateCount, onProgress);
      const detail = baselineRun.ok ? 'the result did not converge.' : baselineRun.error.message;
      return { status: 'conflicted', results, message: 'Batch stopped during Baseline preparation: ' + detail };
    }
    if (!baselineCommitted) {
      skipResults(plan.candidates, 0, 'Skipped because Baseline preparation could not be verified safely.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped because the Baseline analysis commit could not be verified against the live workspace.' };
    }
    baselineAnalysisId = baselineRun.data.analysisId;
    initial = afterBaseline;
  }

  for (let index = 0; index < plan.candidates.length; index += 1) {
    const candidate = plan.candidates[index];
    if (signal.aborted) {
      skipResults(plan.candidates, index, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
      return { status: 'cancelled', results, message: 'Batch cancelled. Created candidates and completed analyses remain available.' };
    }
    const before = port.getProjectSnapshot();
    const baseline = before.designs[plan.baselineDesignId];
    if (!sharedStateMatches(plan, before, baselineAnalysisId, cursor.projectRevision)
      || before.projectRevision !== cursor.projectRevision
      || baseline?.revision !== cursor.baselineDesignRevision
      || before.flightCase.revision !== cursor.flightCaseRevision
      || before.constraints.revision !== cursor.constraintsRevision) {
      skipResults(plan.candidates, index, 'Skipped because a shared workspace revision changed.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'The workspace changed during import; completed work was preserved and remaining candidates were skipped.' };
    }
    if (port.hasActiveAnalysis?.()) {
      skipResults(plan.candidates, index, 'Skipped because another analysis is already running.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped because another analysis started; completed work was preserved and remaining candidates were skipped.' };
    }

    emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'creating', message: 'Creating ' + candidate.candidateLabel + '.' });
    const created = port.createCandidate(
      plan.baselineDesignId,
      candidate.candidateLabel,
      'human',
      plan.sessionId + ':' + candidate.candidateCode + ':create',
      cursor.baselineDesignRevision,
      cursor.projectRevision,
    );
    const afterCreate = port.getProjectSnapshot();
    if (!created.ok) {
      if (!sharedStateMatches(plan, afterCreate, baselineAnalysisId, cursor.projectRevision)) {
        skipResults(plan.candidates, index, 'Skipped because candidate creation changed shared workspace state.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped while creating ' + candidate.candidateLabel + '; the workspace changed.' };
      }
      results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', message: failureMessage(created) });
      skipResults(plan.candidates, index + 1, 'Skipped because candidate creation failed.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped while creating ' + candidate.candidateLabel + '.' };
    }
    const designId = created.data.designId;
    const createdDesign = afterCreate.designs[designId];
    if (!createdDesign
      || createdDesign.kind !== 'candidate'
      || createdDesign.revision !== created.data.revision
      || created.data.sourceDesignRevision !== cursor.baselineDesignRevision
      || !committedMutationIsSafe(plan, before, afterCreate, baselineAnalysisId, designId, created.data.revision, created.data.projectRevision, created.replayed)) {
      skipResults(plan.candidates, index, 'Skipped because candidate creation could not be verified safely.', results, candidateCount, onProgress);
      return { status: 'conflicted', results, message: 'Batch stopped because candidate creation returned an unverifiable workspace revision.' };
    }
    cursor.projectRevision = afterCreate.projectRevision;
    let designRevision: number = createdDesign.revision;

    emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'configuring', designId, message: 'Applying ' + candidate.candidateLabel + ' overrides.' });
    if (Object.keys(candidate.geometryPatch).length) {
      const beforeGeometry = port.getProjectSnapshot();
      const geometry = port.updateGeometry(designId, candidate.geometryPatch, 'human', plan.sessionId + ':' + candidate.candidateCode + ':geometry', designRevision);
      const afterGeometry = port.getProjectSnapshot();
      if (!geometry.ok) {
        results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, message: failureMessage(geometry) });
        skipResults(plan.candidates, index + 1, 'Skipped because candidate geometry configuration failed.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped while configuring ' + candidate.candidateLabel + '.' };
      }
      const nextRevision = geometry.data.newDesignRevision;
      if (!committedMutationIsSafe(plan, beforeGeometry, afterGeometry, baselineAnalysisId, designId, nextRevision, geometry.data.projectRevision, geometry.replayed, geometry.data.outcome)) {
        skipResults(plan.candidates, index, 'Skipped because candidate geometry configuration could not be verified safely.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped because candidate geometry configuration returned an unverifiable workspace revision.' };
      }
      cursor.projectRevision = afterGeometry.projectRevision;
      designRevision = afterGeometry.designs[designId].revision;
    }
    if (Object.keys(candidate.structurePatch).length) {
      const beforeStructure = port.getProjectSnapshot();
      const structure = port.updateStructure(designId, candidate.structurePatch, 'human', plan.sessionId + ':' + candidate.candidateCode + ':structure', designRevision);
      const afterStructure = port.getProjectSnapshot();
      if (!structure.ok) {
        results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, message: failureMessage(structure) });
        skipResults(plan.candidates, index + 1, 'Skipped because candidate structure configuration failed.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped while configuring ' + candidate.candidateLabel + '.' };
      }
      const nextRevision = structure.data.newDesignRevision;
      if (!committedMutationIsSafe(plan, beforeStructure, afterStructure, baselineAnalysisId, designId, nextRevision, structure.data.projectRevision, structure.replayed, structure.data.outcome)) {
        skipResults(plan.candidates, index, 'Skipped because candidate structure configuration could not be verified safely.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped because candidate structure configuration returned an unverifiable workspace revision.' };
      }
      cursor.projectRevision = afterStructure.projectRevision;
      designRevision = afterStructure.designs[designId].revision;
    }

    if (signal.aborted) {
      results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, message: 'Analysis was cancelled; the configured candidate remains available.' });
      skipResults(plan.candidates, index + 1, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
      return { status: 'cancelled', results, message: 'Batch cancelled during analysis. Configured candidates and completed analyses remain available.' };
    }
    const request: RunAnalysisRequest = {
      designId,
      expectedProjectRevision: cursor.projectRevision,
      expectedDesignRevision: designRevision,
      expectedFlightCaseRevision: cursor.flightCaseRevision,
      expectedConstraintsRevision: cursor.constraintsRevision,
      idempotencyKey: plan.sessionId + ':' + candidate.candidateCode + ':analysis',
      fidelity: 'standard',
    };
    emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'analyzing', designId, message: 'Running standard analysis for ' + candidate.candidateLabel + '.' });
    const beforeAnalysis = port.getProjectSnapshot();
    const analysis = await port.runAnalysis(request, 'human', signal);
    const afterAnalysis = port.getProjectSnapshot();
    const committedId = analysis.ok
      ? analysis.data.analysisId
      : analysis.error.committed && analysis.error.analysisId
        ? analysis.error.analysisId
        : null;
    const committedStatus = analysis.ok ? analysis.data.status : null;
    const committed = Boolean(
      committedId
      && committedStatus
      && committedAnalysisIsSafe(plan, afterAnalysis, baselineAnalysisId, beforeAnalysis.projectRevision, request, committedId, committedStatus, analysis.ok && analysis.replayed),
    );
    const diagnosticCommitted = Boolean(
      committedId
      && !analysis.ok
      && analysis.error.committed
      && committedDiagnosticIsSafe(plan, beforeAnalysis, afterAnalysis, baselineAnalysisId, request, committedId),
    );
    if (committed || diagnosticCommitted) cursor.projectRevision = afterAnalysis.projectRevision;
    const cancellationRequested = signal.aborted || (!analysis.ok && analysis.error.code === 'ABORTED');

    if (committed) {
      if (analysis.ok && analysis.data.status === 'converged') {
        results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'succeeded', designId, analysisId: analysis.data.analysisId, message: 'Analysis ' + analysis.data.analysisId + ' converged.' });
        emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'succeeded', designId, analysisId: analysis.data.analysisId, message: 'Analysis converged for ' + candidate.candidateLabel + '.' });
      } else {
        const failedAnalysisId = committedId ?? undefined;
        results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, analysisId: failedAnalysisId, message: 'Analysis did not converge; the diagnostic result was retained.' });
        emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'failed', designId, analysisId: failedAnalysisId, message: 'Analysis did not converge for ' + candidate.candidateLabel + '.' });
      }
      if (cancellationRequested) {
        skipResults(plan.candidates, index + 1, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
        return { status: 'cancelled', results, message: 'Batch cancelled after the current analysis committed. Configured candidates and completed analyses remain available.' };
      }
      continue;
    }
    if (diagnosticCommitted) {
      const diagnosticMessage = analysis.ok ? 'Analysis did not converge; the diagnostic result was retained.' : failureMessage(analysis);
      results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, analysisId: committedId ?? undefined, message: diagnosticMessage });
      emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'failed', designId, analysisId: committedId ?? undefined, message: diagnosticMessage });
      if (cancellationRequested) {
        skipResults(plan.candidates, index + 1, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
        return { status: 'cancelled', results, message: 'Batch cancelled after the current diagnostic result committed. Configured candidates and completed analyses remain available.' };
      }
      continue;
    }

    if (cancellationRequested) {
      results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, analysisId: !analysis.ok ? analysis.error.analysisId : undefined, message: 'Analysis was cancelled; the configured candidate remains available.' });
      emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'failed', designId, analysisId: !analysis.ok ? analysis.error.analysisId : undefined, message: 'Analysis was cancelled.' });
      skipResults(plan.candidates, index + 1, 'Skipped because the batch was cancelled.', results, candidateCount, onProgress);
      return { status: 'cancelled', results, message: 'Batch cancelled during analysis. Configured candidates and completed analyses remain available.' };
    }

    if (!analysis.ok) {
      if (!uncommittedAnalysisIsSafe(plan, beforeAnalysis, afterAnalysis, baselineAnalysisId, request)) {
        skipResults(plan.candidates, index + 1, 'Skipped because shared workspace state is no longer compatible.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped after shared state changed during analysis.' };
      }
      results.push({ candidateCode: candidate.candidateCode, candidateLabel: candidate.candidateLabel, status: 'failed', designId, analysisId: analysis.error.analysisId, message: failureMessage(analysis) });
      emit(onProgress, { candidateCode: candidate.candidateCode, candidateIndex: index, candidateCount, phase: 'failed', designId, analysisId: analysis.error.analysisId, message: failureMessage(analysis) });
      if (analysis.error.code === 'REVISION_CONFLICT' || analysis.error.code === 'ANALYSIS_ALREADY_RUNNING') {
        skipResults(plan.candidates, index + 1, 'Skipped because the analysis could not use the shared workspace revision.', results, candidateCount, onProgress);
        return { status: 'conflicted', results, message: 'Batch stopped after a shared analysis conflict for ' + candidate.candidateLabel + '.' };
      }
      continue;
    }

    // A successful domain result must always have a verified committed snapshot.
    skipResults(plan.candidates, index + 1, 'Skipped because the analysis commit could not be verified safely.', results, candidateCount, onProgress);
    return { status: 'conflicted', results, message: 'Batch stopped because the analysis returned an unverifiable workspace revision.' };
  }

  const succeeded = results.filter((result) => result.status === 'succeeded').length;
  return { status: 'complete', results, message: 'Batch complete. ' + succeeded + ' candidate' + (succeeded === 1 ? '' : 's') + ' analyzed; no automatic rollback was performed.' };
}
