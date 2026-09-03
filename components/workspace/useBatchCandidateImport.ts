'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';
import { createIdempotencyKey, stableStringify } from '@/lib/domain/ids';
import { useProjectStore } from '@/store/projectStore';
import { normalizeCandidateCsv } from '@/lib/batchImport/normalizeCandidateRows';
import { parseCandidateCsv } from '@/lib/batchImport/parseCsv';
import { preflightBatchCandidates } from '@/lib/batchImport/preflightBatchCandidates';
import { executeBatchCandidatePlan } from '@/services/batchCandidateImportController';
import type { BatchCandidateExecutionResult, BatchCommandPort, BatchImportPlan, BatchIssue, BatchProgressEvent } from '@/lib/batchImport/types';
import type { DesignId } from '@/lib/domain/types';
import { BATCH_IMPORT_LIMITS } from '@/lib/batchImport/constants';

export type BatchImportPhase = 'empty' | 'parsing' | 'invalid' | 'ready' | 'running' | 'complete' | 'cancelled' | 'stopped';

export interface BatchImportUiState {
  phase: BatchImportPhase;
  fileName: string | null;
  plan: BatchImportPlan | null;
  issues: BatchIssue[];
  progress: BatchProgressEvent | null;
  results: BatchCandidateExecutionResult[];
  message: string | null;
  cancelRequested: boolean;
}

const initialState: BatchImportUiState = {
  phase: 'empty',
  fileName: null,
  plan: null,
  issues: [],
  progress: null,
  results: [],
  message: null,
  cancelRequested: false,
};

type Action =
  | { type: 'parse-start'; fileName: string }
  | { type: 'invalid'; issues: BatchIssue[]; message?: string }
  | { type: 'ready'; fileName: string; plan: BatchImportPlan; message?: string }
  | { type: 'progress'; event: BatchProgressEvent }
  | { type: 'running' }
  | { type: 'cancel-requested' }
  | { type: 'finished'; result: Awaited<ReturnType<typeof executeBatchCandidatePlan>> }
  | { type: 'reset' };

function reducer(state: BatchImportUiState, action: Action): BatchImportUiState {
  switch (action.type) {
    case 'parse-start': return { ...initialState, phase: 'parsing', fileName: action.fileName };
    case 'invalid': return { ...state, phase: 'invalid', plan: null, issues: action.issues, message: action.message ?? 'Review the highlighted import issues.' };
    case 'ready': return { ...state, phase: 'ready', fileName: action.fileName, plan: action.plan, issues: [], results: [], progress: null, cancelRequested: false, message: action.message ?? null };
    case 'running': return { ...state, phase: 'running', issues: [], results: [], progress: null, cancelRequested: false, message: 'Import is running sequentially. Created candidates and completed analyses remain if you cancel.' };
    case 'progress': return { ...state, progress: action.event };
    case 'cancel-requested': return { ...state, cancelRequested: true, message: 'Cancellation requested. Finishing the current safe step…' };
    case 'finished': return { ...state, phase: action.result.status === 'cancelled' ? 'cancelled' : action.result.status === 'conflicted' ? 'stopped' : 'complete', results: action.result.results, message: action.result.message, cancelRequested: false };
    case 'reset': return initialState;
  }
}

function storePort(): BatchCommandPort {
  const get = useProjectStore.getState;
  return {
    getProjectSnapshot: () => get().project,
    hasActiveAnalysis: () => get().analysisRun.status === 'running',
    createCandidate: (...args) => get().createCandidate(...args),
    updateGeometry: (...args) => get().updateGeometry(...args),
    updateStructure: (...args) => get().updateStructure(...args),
    runAnalysis: (...args) => get().runAnalysis(...args),
  };
}

export function useBatchCandidateImport(baselineDesignId: DesignId) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const parseToken = useRef(0);
  const abortController = useRef<AbortController | null>(null);
  const executionLock = useRef(false);
  const mounted = useRef(true);

  const reset = useCallback(() => {
    parseToken.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    executionLock.current = false;
    dispatch({ type: 'reset' });
  }, []);

  useEffect(() => {
    // React Strict Mode intentionally replays effects in development. Mark the
    // hook mounted on every setup so the replayed instance can still publish
    // its async parse/execute result.
    mounted.current = true;
    return () => {
      mounted.current = false;
      parseToken.current += 1;
      abortController.current?.abort();
      abortController.current = null;
      executionLock.current = false;
    };
  }, []);

  const loadFile = useCallback(async (file: File | null) => {
    if (!file || state.phase === 'running' || executionLock.current) return;
    if (!/\.csv$/i.test(file.name)) {
      dispatch({ type: 'invalid', issues: [{ severity: 'error', message: 'Choose a file whose name ends in .csv.' }] });
      return;
    }
    if (file.size > BATCH_IMPORT_LIMITS.maxFileBytes) {
      dispatch({ type: 'invalid', issues: [{ severity: 'error', message: 'CSV files must be ' + Math.round(BATCH_IMPORT_LIMITS.maxFileBytes / 1024) + ' KiB or smaller.' }] });
      return;
    }
    const token = parseToken.current + 1;
    parseToken.current = token;
    dispatch({ type: 'parse-start', fileName: file.name });
    try {
      const bytes = await file.arrayBuffer();
      if (!mounted.current || parseToken.current !== token) return;
      const parsed = parseCandidateCsv(bytes);
      if (!parsed.ok) {
        if (mounted.current) dispatch({ type: 'invalid', issues: parsed.issues });
        return;
      }
      const normalized = normalizeCandidateCsv(parsed.data);
      if (!normalized.ok) {
        if (mounted.current) dispatch({ type: 'invalid', issues: normalized.issues });
        return;
      }
      const project = useProjectStore.getState().project;
      const preflight = preflightBatchCandidates({ project, baselineDesignId, candidates: normalized.candidates, sessionId: createIdempotencyKey() });
      if (!preflight.ok) {
        if (mounted.current) dispatch({ type: 'invalid', issues: preflight.issues });
        return;
      }
      if (mounted.current) dispatch({ type: 'ready', fileName: file.name, plan: preflight.plan });
    } catch {
      if (mounted.current && parseToken.current === token) dispatch({ type: 'invalid', issues: [{ severity: 'error', message: 'The file could not be read as a local CSV.' }] });
    }
  }, [baselineDesignId, state.phase]);

  const execute = useCallback(async () => {
    const plan = state.plan;
    if (!plan || state.phase !== 'ready' || executionLock.current) return;
    executionLock.current = true;
    const current = useProjectStore.getState().project;
    const confirmed = preflightBatchCandidates({ project: current, baselineDesignId, candidates: plan.candidates, sessionId: plan.sessionId });
    if (!confirmed.ok) {
      executionLock.current = false;
      if (mounted.current) dispatch({ type: 'invalid', issues: confirmed.issues, message: 'The workspace changed; review the import issues again.' });
      return;
    }
    const previewSignature = (value: BatchImportPlan) => stableStringify({
      availableSlots: value.availableSlots,
      fingerprint: value.fingerprint,
      candidates: value.candidates,
      previews: value.previews,
    });
    if (previewSignature(confirmed.plan) !== previewSignature(plan)) {
      executionLock.current = false;
      if (mounted.current) dispatch({
        type: 'ready',
        fileName: state.fileName ?? 'candidate import.csv',
        plan: confirmed.plan,
        message: 'The workspace changed after preview. Review the refreshed inherited values and press Create and analyze again.',
      });
      return;
    }
    dispatch({ type: 'running' });
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const result = await executeBatchCandidatePlan({
        plan,
        port: storePort(),
        signal: controller.signal,
        onProgress: (event) => { if (mounted.current) dispatch({ type: 'progress', event }); },
      });
      if (mounted.current) dispatch({ type: 'finished', result });
    } catch {
      if (mounted.current) dispatch({
        type: 'finished',
        result: {
          status: 'conflicted',
          results: [],
          message: 'Batch stopped because the import could not be completed safely. Review the current workspace and try again.',
        },
      });
    } finally {
      if (abortController.current === controller) abortController.current = null;
      executionLock.current = false;
    }
  }, [baselineDesignId, state.fileName, state.phase, state.plan]);

  const cancel = useCallback(() => {
    if (state.phase === 'running' && !state.cancelRequested && abortController.current) {
      dispatch({ type: 'cancel-requested' });
      abortController.current.abort();
    }
  }, [state.cancelRequested, state.phase]);

  return { state, loadFile, execute, cancel, reset };
}
