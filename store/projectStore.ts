'use client';

import { create } from 'zustand';
import {
  commitAnalysisSnapshot,
  createCandidateVariant,
  analysisIsCurrent,
  preflightAnalysisRun,
  selectAnalysis,
  selectDesign,
  selectEta,
  setBaselineDesign,
  updateWingGeometry,
  updateWingStructure,
  type RunAnalysisRequest,
  type RunAnalysisResult,
} from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { boundedPublicText, MAX_PUBLIC_SAFE_ACTION_CHARS, normalizeAnalysisException, trustDomainFailure } from '@/lib/domain/publicErrors';
import type { Actor, AnalysisId, DesignId, DomainFailure, DomainResult, ProjectState, WingGeometry, WingStructure } from '@/lib/domain/types';
import type { CouplingProgress } from '@/lib/solver/coupling';
import { executeAnalysisWorker } from '@/services/analysisController';

export type AnalysisRunState =
  | { status: 'idle' }
  | { status: 'running'; runId: string; designId: DesignId; designRevision: number; progress: CouplingProgress | null }
  | { status: 'succeeded'; runId: string; designId: DesignId; designRevision: number; analysisId: AnalysisId }
  | { status: 'not_converged'; runId: string; designId: DesignId; designRevision: number; analysisId: AnalysisId; message: string; hadCurrentAnalysis: boolean }
  | { status: 'failed' | 'conflicted' | 'aborted'; runId: string; designId: DesignId; designRevision: number; code: string; message: string; hadCurrentAnalysis: boolean };

export interface MutationHighlight {
  actor: Actor;
  designId: DesignId;
  paths: string[];
  activityId: string | null;
  revision: number;
}

export interface CommandNotice {
  kind?: 'failure' | 'replay' | 'success';
  actor: Actor;
  designId: DesignId | null;
  code: string;
  message: string;
  safeNextAction: string;
  retryable: boolean;
}

export type SiteToolsState = 'checking' | 'ready' | 'unavailable' | 'error';

export type PresentationPanel = 'none' | 'station' | 'comparison';

export interface PresentationFocusState {
  focusedPanel: PresentationPanel;
  designId: DesignId | null;
  analysisId: AnalysisId | null;
  eta: number | null;
  comparisonAnalysisIds: { referenceAnalysisId: AnalysisId; candidateAnalysisId: AnalysisId } | null;
  actor: 'human' | 'agent' | null;
  sequence: number;
  message: string | null;
}

export function createEmptyPresentationFocus(sequence = 0): PresentationFocusState {
  return {
    focusedPanel: 'none',
    designId: null,
    analysisId: null,
    eta: null,
    comparisonAnalysisIds: null,
    actor: null,
    sequence,
    message: null,
  };
}

export interface ProjectStore {
  project: ProjectState;
  analysisRun: AnalysisRunState;
  siteTools: SiteToolsState;
  presentation: PresentationFocusState;
  mutationHighlight: MutationHighlight | null;
  commandNotice: CommandNotice | null;
  setSiteTools: (state: SiteToolsState) => void;
  clearMutationHighlight: () => void;
  clearCommandNotice: () => void;
  clearAnalysisRunOutcome: () => void;
  clearPresentationFocus: () => void;
  focusAnalysisStation: (analysisId: AnalysisId, designId: DesignId, eta: number, actor: 'human' | 'agent') => void;
  focusComparison: (referenceAnalysisId: AnalysisId, candidateAnalysisId: AnalysisId, candidateDesignId: DesignId, actor: 'human' | 'agent') => void;
  resetDemo: () => void;
  cancelAnalysis: () => void;
  selectDesign: (designId: DesignId) => void;
  selectEta: (eta: number) => void;
  createCandidate: (sourceDesignId: DesignId, label: string, actor: Actor, idempotencyKey?: string, expectedRevision?: number, expectedProjectRevision?: number) => ReturnType<typeof createCandidateVariant>['result'];
  setBaseline: (designId: DesignId, actor: Actor, idempotencyKey?: string, expectedRevision?: number, expectedProjectRevision?: number) => ReturnType<typeof setBaselineDesign>['result'];
  updateGeometry: (designId: DesignId, patch: Partial<WingGeometry>, actor: Actor, idempotencyKey?: string, expectedRevision?: number) => ReturnType<typeof updateWingGeometry>['result'];
  updateStructure: (designId: DesignId, patch: Partial<WingStructure>, actor: Actor, idempotencyKey?: string, expectedRevision?: number) => ReturnType<typeof updateWingStructure>['result'];
  runAnalysis: (request: RunAnalysisRequest, actor: Actor, signal?: AbortSignal) => Promise<DomainResult<RunAnalysisResult>>;
}

function failure(
  code: DomainFailure['error']['code'],
  message: string,
  safeNextAction = 'Read the current state and retry safely.',
  retryable = code === 'REVISION_CONFLICT',
  category?: string,
): DomainFailure {
  return trustDomainFailure({
    ok: false,
    error: {
      code,
      message: boundedPublicText(message, 'The operation failed safely.'),
      retryable,
      safeNextAction: boundedPublicText(safeNextAction, 'Read the current state before continuing.', MAX_PUBLIC_SAFE_ACTION_CHARS),
      ...(category ? { category: boundedPublicText(category, 'UNCLASSIFIED_FAILURE', 64) } : {}),
    },
  });
}

let activeRun: { runId: string; controller: AbortController } | null = null;

function notice(result: DomainFailure, actor: Actor, designId: DesignId | null): CommandNotice {
  return {
    kind: 'failure',
    actor,
    designId,
    code: result.error.code,
    message: boundedPublicText(result.error.message, 'The command was rejected safely.'),
    safeNextAction: boundedPublicText(result.error.safeNextAction, 'Read the current state before continuing.', MAX_PUBLIC_SAFE_ACTION_CHARS),
    retryable: result.error.retryable,
  };
}

function replayNotice(actor: Actor, designId: DesignId, message: string, safeNextAction: string): CommandNotice {
  return {
    kind: 'replay',
    actor,
    designId,
    code: 'IDEMPOTENT_REPLAY',
    message: boundedPublicText(message, 'The original result was replayed without a duplicate write.'),
    safeNextAction: boundedPublicText(safeNextAction, 'Continue from the existing result.', MAX_PUBLIC_SAFE_ACTION_CHARS),
    retryable: false,
  };
}

function successNotice(actor: Actor, designId: DesignId, message: string, safeNextAction: string): CommandNotice {
  return {
    kind: 'success',
    actor,
    designId,
    code: 'ANALYSIS_COMMITTED',
    message: boundedPublicText(message, 'Analysis committed for a background target.'),
    safeNextAction: boundedPublicText(safeNextAction, 'Select the target design to inspect its current result.', MAX_PUBLIC_SAFE_ACTION_CHARS),
    retryable: false,
  };
}

function replayedDesignNextAction(state: ProjectState, designId: DesignId, returnedRevision: number) {
  const current = state.designs[designId];
  if (!current) return `The original design ${designId} is no longer retained. Read current state and create a new candidate with a new UUID only if it is still needed.`;
  if (current.revision === returnedRevision) return `Continue from current design revision ${current.revision}.`;
  return `Read design ${designId}; the replay returned historical revision ${returnedRevision}, while its current revision is ${current.revision}. Continue only from revision ${current.revision}.`;
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  project: createDefaultProject(),
  analysisRun: { status: 'idle' },
  siteTools: 'checking',
  presentation: createEmptyPresentationFocus(),
  mutationHighlight: null,
  commandNotice: null,
  setSiteTools: (siteTools) => set({ siteTools }),
  clearMutationHighlight: () => set({ mutationHighlight: null }),
  clearCommandNotice: () => set({ commandNotice: null }),
  clearAnalysisRunOutcome: () => set((state) => state.analysisRun.status === 'running' ? {} : { analysisRun: { status: 'idle' } }),
  clearPresentationFocus: () => set((state) => ({ presentation: createEmptyPresentationFocus(state.presentation.sequence + 1) })),
  focusAnalysisStation: (analysisId, designId, eta, actor) => set((state) => ({
    presentation: {
      focusedPanel: 'station',
      designId,
      analysisId,
      eta: Math.max(0, Math.min(1, eta)),
      comparisonAnalysisIds: null,
      actor,
      sequence: state.presentation.sequence + 1,
      message: `${actor === 'agent' ? 'Agent' : 'Human'} focused immutable analysis ${analysisId} at solver station η=${eta.toFixed(3)}.`,
    },
  })),
  focusComparison: (referenceAnalysisId, candidateAnalysisId, candidateDesignId, actor) => set((state) => ({
    presentation: {
      focusedPanel: 'comparison',
      designId: candidateDesignId,
      analysisId: candidateAnalysisId,
      eta: null,
      comparisonAnalysisIds: { referenceAnalysisId, candidateAnalysisId },
      actor,
      sequence: state.presentation.sequence + 1,
      message: `${actor === 'agent' ? 'Agent' : 'Human'} pinned exact immutable analyses ${referenceAnalysisId} and ${candidateAnalysisId}.`,
    },
  })),
  resetDemo: () => {
    activeRun?.controller.abort();
    activeRun = null;
    set((state) => ({ project: createDefaultProject(), analysisRun: { status: 'idle' }, presentation: createEmptyPresentationFocus(state.presentation.sequence + 1), mutationHighlight: null, commandNotice: null }));
  },
  cancelAnalysis: () => activeRun?.controller.abort(),
  selectDesign: (designId) => set((state) => ({ project: selectDesign(state.project, designId), presentation: createEmptyPresentationFocus(state.presentation.sequence + 1) })),
  selectEta: (eta) => set((state) => {
    const focusedDesignId = state.presentation.designId;
    const selectedProject = focusedDesignId && state.project.designs[focusedDesignId]
      ? selectDesign(state.project, focusedDesignId)
      : state.project;
    return { project: selectEta(selectedProject, eta), presentation: createEmptyPresentationFocus(state.presentation.sequence + 1) };
  }),
  createCandidate: (sourceDesignId, label, actor, idempotencyKey = createIdempotencyKey(), expectedRevision, expectedProjectRevision) => {
    const state = get().project;
    const source = state.designs[sourceDesignId];
    const transition = createCandidateVariant(state, {
      sourceDesignId,
      expectedProjectRevision: expectedProjectRevision ?? state.projectRevision,
      expectedSourceDesignRevision: expectedRevision ?? source?.revision ?? -1,
      candidateLabel: label,
      idempotencyKey,
    }, actor);
    if (transition.state !== state) set((current) => ({ project: transition.state, presentation: createEmptyPresentationFocus(current.presentation.sequence + 1), mutationHighlight: null, commandNotice: null }));
    else if (!transition.result.ok) set({ commandNotice: notice(transition.result, actor, sourceDesignId) });
    else if (transition.result.replayed) set({
      commandNotice: replayNotice(
        actor,
        transition.result.data.designId,
        `Original candidate creation replayed for design ${transition.result.data.designId}; no duplicate design or activity was created.`,
        replayedDesignNextAction(state, transition.result.data.designId, transition.result.data.revision),
      ),
    });
    return transition.result;
  },
  setBaseline: (designId, actor, idempotencyKey = createIdempotencyKey(), expectedRevision, expectedProjectRevision) => {
    const state = get().project;
    const design = state.designs[designId];
    const transition = setBaselineDesign(state, {
      designId,
      expectedProjectRevision: expectedProjectRevision ?? state.projectRevision,
      expectedDesignRevision: expectedRevision ?? design?.revision ?? -1,
      idempotencyKey,
    }, actor);
    if (transition.result.ok && transition.result.data.outcome === 'unchanged') {
      set(transition.state !== state
        ? { project: transition.state, commandNotice: null }
        : { commandNotice: null });
    } else if (transition.state !== state && transition.result.ok) {
      const nextBaseline = transition.state.designs[transition.result.data.baselineDesignId];
      const previousBaseline = transition.state.designs[transition.result.data.previousBaselineDesignId];
      set((current) => ({
        project: transition.state,
        presentation: createEmptyPresentationFocus(current.presentation.sequence + 1),
        mutationHighlight: null,
        commandNotice: {
          kind: 'success',
          actor,
          designId: nextBaseline.designId,
          code: 'BASELINE_CHANGED',
          message: `${nextBaseline.label} is now the Baseline reference; ${previousBaseline.label} remains available as a candidate.`,
          safeNextAction: 'Run current Baseline and candidate analyses before comparing them.',
          retryable: false,
        },
      }));
    } else if (!transition.result.ok) {
      set({ commandNotice: notice(transition.result, actor, designId) });
    } else if (transition.result.replayed) {
      set({
        commandNotice: replayNotice(
          actor,
          transition.result.data.baselineDesignId,
          `Original Baseline-role change replayed for design ${transition.result.data.baselineDesignId}; no duplicate revision or activity was created.`,
          replayedDesignNextAction(state, transition.result.data.baselineDesignId, transition.result.data.baselineDesignRevision),
        ),
      });
    }
    return transition.result;
  },
  updateGeometry: (designId, patch, actor, idempotencyKey = createIdempotencyKey(), expectedRevision) => {
    const state = get().project;
    const transition = updateWingGeometry(state, {
      designId,
      expectedDesignRevision: expectedRevision ?? state.designs[designId]?.revision ?? -1,
      idempotencyKey,
      patch,
    }, actor);
    if (transition.result.ok && transition.result.data.outcome === 'unchanged') {
      set(transition.state !== state
        ? { project: transition.state, commandNotice: null }
        : { commandNotice: null });
    } else if (transition.state !== state) {
      const fields = transition.result.ok ? Object.keys(transition.result.data.changedFields) : [];
      set({
        project: transition.state,
        presentation: createEmptyPresentationFocus(get().presentation.sequence + 1),
        mutationHighlight: transition.result.ok && fields.length ? {
          actor,
          designId,
          paths: fields,
          activityId: transition.result.data.activityId,
          revision: transition.result.data.newDesignRevision,
        } : null,
        commandNotice: null,
      });
    } else if (!transition.result.ok) {
      set({ commandNotice: notice(transition.result, actor, designId) });
    } else if (transition.result.replayed) {
      set({
        commandNotice: replayNotice(
          actor,
          designId,
          `Original geometry update replayed for design ${designId}; no duplicate revision or activity was created.`,
          replayedDesignNextAction(state, designId, transition.result.data.newDesignRevision),
        ),
      });
    }
    return transition.result;
  },
  updateStructure: (designId, patch, actor, idempotencyKey = createIdempotencyKey(), expectedRevision) => {
    const state = get().project;
    const transition = updateWingStructure(state, {
      designId,
      expectedDesignRevision: expectedRevision ?? state.designs[designId]?.revision ?? -1,
      idempotencyKey,
      patch,
    }, actor);
    if (transition.result.ok && transition.result.data.outcome === 'unchanged') {
      set(transition.state !== state
        ? { project: transition.state, commandNotice: null }
        : { commandNotice: null });
    } else if (transition.state !== state) {
      const fields = transition.result.ok ? Object.keys(transition.result.data.changedFields) : [];
      set({
        project: transition.state,
        presentation: createEmptyPresentationFocus(get().presentation.sequence + 1),
        mutationHighlight: transition.result.ok && fields.length ? {
          actor,
          designId,
          paths: fields,
          activityId: transition.result.data.activityId,
          revision: transition.result.data.newDesignRevision,
        } : null,
        commandNotice: null,
      });
    } else if (!transition.result.ok) {
      set({ commandNotice: notice(transition.result, actor, designId) });
    } else if (transition.result.replayed) {
      set({
        commandNotice: replayNotice(
          actor,
          designId,
          `Original structure update replayed for design ${designId}; no duplicate revision or activity was created.`,
          replayedDesignNextAction(state, designId, transition.result.data.newDesignRevision),
        ),
      });
    }
    return transition.result;
  },
  runAnalysis: async (request, actor, signal) => {
    const starting = get().project;
    const preflight = preflightAnalysisRun(starting, request);
    if (!preflight.ok) {
      if (preflight.error.code === 'ANALYSIS_DID_NOT_CONVERGE'
        && preflight.error.committed
        && preflight.error.analysisId) {
        const design = starting.designs[request.designId];
        const hadCurrentAnalysis = Boolean(design?.latestAnalysisId && analysisIsCurrent(starting, design.latestAnalysisId));
        const diagnosticAnalysisId = preflight.error.analysisId;
        const diagnosticMessage = preflight.error.message;
        if (!activeRun) {
          set((state) => ({
            project: selectAnalysis(selectDesign(state.project, request.designId), diagnosticAnalysisId),
            analysisRun: {
              status: 'not_converged',
              runId: request.idempotencyKey,
              designId: request.designId,
              designRevision: request.expectedDesignRevision,
              analysisId: diagnosticAnalysisId,
              message: diagnosticMessage,
              hadCurrentAnalysis,
            },
            presentation: createEmptyPresentationFocus(state.presentation.sequence + 1),
            commandNotice: null,
          }));
        } else {
          set({ commandNotice: notice(preflight, actor, request.designId) });
        }
      } else {
        set({ commandNotice: notice(preflight, actor, request.designId) });
      }
      return preflight;
    }
    if (preflight.data.kind === 'replay') {
      const replayResult = preflight.data.result;
      const replaySnapshotRetained = Boolean(starting.analyses[replayResult.analysisId]);
      const replaySnapshotCurrent = replaySnapshotRetained && analysisIsCurrent(starting, replayResult.analysisId);
      const replayOwner = starting.designs[request.designId];
      const currentReplacementId = replayOwner?.latestAnalysisId && analysisIsCurrent(starting, replayOwner.latestAnalysisId)
        ? replayOwner.latestAnalysisId
        : null;
      if (!activeRun) {
        set((state) => ({
          project: selectDesign(state.project, request.designId),
          analysisRun: {
            status: 'succeeded',
            runId: request.idempotencyKey,
            designId: request.designId,
            designRevision: request.expectedDesignRevision,
            analysisId: replayResult.analysisId,
          },
          presentation: createEmptyPresentationFocus(state.presentation.sequence + 1),
          commandNotice: replayNotice(
            actor,
            request.designId,
            replaySnapshotRetained
              ? `Original analysis result ${replayResult.analysisId} replayed; no duplicate solve, snapshot, or activity was created.`
              : `Original analysis identity ${replayResult.analysisId} replayed from the bounded ledger; its snapshot was already pruned and no duplicate solve or activity was created.`,
            replaySnapshotCurrent
              ? `Continue from current immutable analysis ${replayResult.analysisId} for design revision ${replayResult.designRevision}.`
              : currentReplacementId
                ? `Use retained current analysis ${currentReplacementId}; replayed analysis ${replayResult.analysisId} remains summary-readable historical evidence but is stale.`
                : replaySnapshotRetained
                  ? `Analysis ${replayResult.analysisId} remains summary-readable historical evidence but is stale. Run the current design revision with a new UUID before station inspection or comparison.`
                  : 'Run the current design with a new UUID only if a new inspectable snapshot is required.',
          ),
        }));
      } else {
        set({
          commandNotice: replayNotice(
            actor,
            request.designId,
            replaySnapshotRetained
              ? `Original analysis result ${replayResult.analysisId} replayed during the active project run; no duplicate solve, snapshot, or activity was created.`
              : `Original analysis identity ${replayResult.analysisId} replayed during the active project run; its snapshot was already pruned and no duplicate solve or activity was created.`,
            replaySnapshotCurrent
              ? `Continue from current immutable analysis ${replayResult.analysisId}; the unrelated active run was not changed.`
              : currentReplacementId
                ? `Use retained current analysis ${currentReplacementId}; the unrelated active run was not changed.`
                : replaySnapshotRetained
                  ? `Analysis ${replayResult.analysisId} is retained but stale; the unrelated active run was not changed.`
                  : 'Let the active run finish before creating any new inspectable snapshot.',
          ),
        });
      }
      return { ok: true, replayed: true, data: replayResult };
    }
    if (activeRun) {
      const result = failure('ANALYSIS_ALREADY_RUNNING', 'Another analysis is already running for this project.', 'Wait for it to finish or cancel it before starting a new run.', true);
      set({ commandNotice: notice(result, actor, request.designId) });
      return result;
    }
    const design = starting.designs[request.designId];
    const runId = createIdempotencyKey();
    const controller = new AbortController();
    const hadCurrentAnalysis = Boolean(design.latestAnalysisId && analysisIsCurrent(starting, design.latestAnalysisId));
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    activeRun = { runId, controller };
    set((state) => ({
      project: selectDesign(state.project, design.designId),
      analysisRun: { status: 'running', runId, designId: design.designId, designRevision: design.revision, progress: null },
      presentation: createEmptyPresentationFocus(state.presentation.sequence + 1),
      commandNotice: null,
    }));
    try {
      const snapshot = await executeAnalysisWorker(
        structuredClone(starting),
        structuredClone(design),
        request.fidelity,
        controller.signal,
        (progress) => {
          if (activeRun?.runId === runId) set({ analysisRun: { status: 'running', runId, designId: design.designId, designRevision: design.revision, progress } });
        },
      );
      if (activeRun?.runId !== runId) return failure('ABORTED', 'Analysis was superseded before commit.', 'Read the current project state before running again.');
      const current = get().project;
      const transition = commitAnalysisSnapshot(current, request, snapshot, actor);
      activeRun = null;
      if (transition.state !== current) set((state) => ({ project: transition.state, presentation: createEmptyPresentationFocus(state.presentation.sequence + 1) }));
      if (transition.result.ok) {
        const completedInBackground = current.activeDesignId !== design.designId;
        set({
          analysisRun: { status: 'succeeded', runId, designId: design.designId, designRevision: design.revision, analysisId: transition.result.data.analysisId },
          commandNotice: completedInBackground
            ? successNotice(
              actor,
              design.designId,
              `Analysis ${transition.result.data.analysisId} converged and committed for design revision ${design.revision}; the newer human selection was preserved.`,
              `Select design ${design.designId} to inspect its current immutable result.`,
            )
            : null,
        });
      }
      else if (transition.result.error.code === 'ANALYSIS_DID_NOT_CONVERGE' && transition.result.error.committed && transition.result.error.analysisId) set({
        analysisRun: {
          status: 'not_converged',
          runId,
          designId: design.designId,
          designRevision: design.revision,
          analysisId: transition.result.error.analysisId,
          message: transition.result.error.message,
          hadCurrentAnalysis,
        },
        commandNotice: null,
      });
      else set({
          analysisRun: {
            status: transition.result.error.code === 'REVISION_CONFLICT' ? 'conflicted' : 'failed',
            runId,
            designId: design.designId,
            designRevision: design.revision,
            code: transition.result.error.code,
            message: transition.result.error.message,
            hadCurrentAnalysis,
          },
          commandNotice: notice(transition.result, actor, design.designId),
        });
      return transition.result;
    } catch (error) {
      const normalized = normalizeAnalysisException(error);
      const result = failure(
        normalized.domainCode,
        normalized.message,
        normalized.safeNextAction,
        normalized.retryable,
        normalized.category,
      );
      if (activeRun?.runId === runId) {
        activeRun = null;
        set({
          analysisRun: {
            status: normalized.runStatus,
            runId,
            designId: design.designId,
            designRevision: design.revision,
            code: normalized.category,
            message: normalized.message,
            hadCurrentAnalysis,
          },
          commandNotice: normalized.domainCode === 'ABORTED' ? null : notice(result, actor, design.designId),
        });
      }
      return result;
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  },
}));
