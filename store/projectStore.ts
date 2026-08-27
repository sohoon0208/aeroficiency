'use client';

import { create } from 'zustand';
import {
  commitAnalysisSnapshot,
  createCandidateVariant,
  analysisIsCurrent,
  preflightAnalysisRun,
  selectDesign,
  selectEta,
  updateWingGeometry,
  updateWingStructure,
  type RunAnalysisRequest,
  type RunAnalysisResult,
} from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
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
  actor: Actor;
  designId: DesignId | null;
  code: string;
  message: string;
  safeNextAction: string;
  retryable: boolean;
}

export type SiteToolsState = 'checking' | 'ready' | 'unavailable' | 'error';

interface ProjectStore {
  project: ProjectState;
  analysisRun: AnalysisRunState;
  siteTools: SiteToolsState;
  mutationHighlight: MutationHighlight | null;
  commandNotice: CommandNotice | null;
  setSiteTools: (state: SiteToolsState) => void;
  clearMutationHighlight: () => void;
  clearCommandNotice: () => void;
  resetDemo: () => void;
  cancelAnalysis: () => void;
  selectDesign: (designId: DesignId) => void;
  selectEta: (eta: number) => void;
  createCandidate: (sourceDesignId: DesignId, label: string, actor: Actor, idempotencyKey?: string, expectedRevision?: number) => ReturnType<typeof createCandidateVariant>['result'];
  updateGeometry: (designId: DesignId, patch: Partial<WingGeometry>, actor: Actor, idempotencyKey?: string, expectedRevision?: number) => ReturnType<typeof updateWingGeometry>['result'];
  updateStructure: (designId: DesignId, patch: Partial<WingStructure>, actor: Actor, idempotencyKey?: string, expectedRevision?: number) => ReturnType<typeof updateWingStructure>['result'];
  runAnalysis: (request: RunAnalysisRequest, actor: Actor, signal?: AbortSignal) => Promise<DomainResult<RunAnalysisResult>>;
}

function failure(code: DomainFailure['error']['code'], message: string, safeNextAction = 'Read the current state and retry safely.'): DomainFailure {
  return { ok: false, error: { code, message, retryable: code === 'REVISION_CONFLICT', safeNextAction } };
}

let activeRun: { runId: string; controller: AbortController } | null = null;

function notice(result: DomainFailure, actor: Actor, designId: DesignId | null): CommandNotice {
  return {
    actor,
    designId,
    code: result.error.code,
    message: result.error.message,
    safeNextAction: result.error.safeNextAction,
    retryable: result.error.retryable,
  };
}

export const useProjectStore = create<ProjectStore>()((set, get) => ({
  project: createDefaultProject(),
  analysisRun: { status: 'idle' },
  siteTools: 'checking',
  mutationHighlight: null,
  commandNotice: null,
  setSiteTools: (siteTools) => set({ siteTools }),
  clearMutationHighlight: () => set({ mutationHighlight: null }),
  clearCommandNotice: () => set({ commandNotice: null }),
  resetDemo: () => {
    activeRun?.controller.abort();
    activeRun = null;
    set({ project: createDefaultProject(), analysisRun: { status: 'idle' }, mutationHighlight: null, commandNotice: null });
  },
  cancelAnalysis: () => activeRun?.controller.abort(),
  selectDesign: (designId) => set((state) => ({ project: selectDesign(state.project, designId) })),
  selectEta: (eta) => set((state) => ({ project: selectEta(state.project, eta) })),
  createCandidate: (sourceDesignId, label, actor, idempotencyKey = createIdempotencyKey(), expectedRevision) => {
    const state = get().project;
    const source = state.designs[sourceDesignId];
    const transition = createCandidateVariant(state, {
      sourceDesignId,
      expectedSourceDesignRevision: expectedRevision ?? source?.revision ?? -1,
      candidateLabel: label,
      idempotencyKey,
    }, actor);
    if (transition.state !== state) set({ project: transition.state, mutationHighlight: null, commandNotice: null });
    else if (!transition.result.ok) set({ commandNotice: notice(transition.result, actor, sourceDesignId) });
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
    if (transition.state !== state) {
      const fields = transition.result.ok ? Object.keys(transition.result.data.changedFields) : [];
      set({
        project: transition.state,
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
    if (transition.state !== state) {
      const fields = transition.result.ok ? Object.keys(transition.result.data.changedFields) : [];
      set({
        project: transition.state,
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
    }
    return transition.result;
  },
  runAnalysis: async (request, actor, signal) => {
    if (activeRun) {
      const result = failure('ANALYSIS_FAILED', 'Another analysis is already running for this project.', 'Wait for it to finish or cancel it before starting a new run.');
      set({ commandNotice: notice(result, actor, request.designId) });
      return result;
    }
    const starting = get().project;
    const preflight = preflightAnalysisRun(starting, request);
    if (!preflight.ok) {
      if (preflight.error.code === 'ANALYSIS_DID_NOT_CONVERGE'
        && preflight.error.committed
        && preflight.error.analysisId) {
        const design = starting.designs[request.designId];
        const hadCurrentAnalysis = Boolean(design?.latestAnalysisId && analysisIsCurrent(starting, design.latestAnalysisId));
        set({
          analysisRun: {
            status: 'not_converged',
            runId: request.idempotencyKey,
            designId: request.designId,
            designRevision: request.expectedDesignRevision,
            analysisId: preflight.error.analysisId,
            message: preflight.error.message,
            hadCurrentAnalysis,
          },
          commandNotice: null,
        });
      } else {
        set({ commandNotice: notice(preflight, actor, request.designId) });
      }
      return preflight;
    }
    if (preflight.data.kind === 'replay') return { ok: true, replayed: true, data: preflight.data.result };
    const design = starting.designs[request.designId];
    const runId = createIdempotencyKey();
    const controller = new AbortController();
    const hadCurrentAnalysis = Boolean(design.latestAnalysisId && analysisIsCurrent(starting, design.latestAnalysisId));
    const abortFromCaller = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', abortFromCaller, { once: true });
    activeRun = { runId, controller };
    set({
      analysisRun: { status: 'running', runId, designId: design.designId, designRevision: design.revision, progress: null },
      commandNotice: null,
    });
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
      if (transition.state !== current) set({ project: transition.state });
      if (transition.result.ok) set({
        analysisRun: { status: 'succeeded', runId, designId: design.designId, designRevision: design.revision, analysisId: transition.result.data.analysisId },
        commandNotice: null,
      });
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
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ANALYSIS_FAILED';
      const message = error instanceof Error ? error.message : 'Analysis failed safely.';
      const domainCode = code === 'ABORTED' ? 'ABORTED' : code === 'TOOL_UNAVAILABLE' ? 'TOOL_UNAVAILABLE' : 'ANALYSIS_FAILED';
      const result = failure(domainCode, message);
      if (activeRun?.runId === runId) {
        activeRun = null;
        set({
          analysisRun: {
            status: code === 'ABORTED' ? 'aborted' : 'failed',
            runId,
            designId: design.designId,
            designRevision: design.revision,
            code,
            message,
            hadCurrentAnalysis,
          },
          commandNotice: code === 'ABORTED' ? null : notice(result, actor, design.designId),
        });
      }
      return result;
    } finally {
      signal?.removeEventListener('abort', abortFromCaller);
    }
  },
}));
