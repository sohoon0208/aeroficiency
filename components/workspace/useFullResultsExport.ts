'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildFullResultsExport } from '@/lib/resultsExport/buildResultsFiles';
import { createResultsZip, triggerResultsDownload } from '@/lib/resultsExport/createResultsZip';
import type { ProjectState } from '@/lib/domain/types';

export type FullResultsExportPhase = 'idle' | 'preparing' | 'compressing' | 'downloading' | 'complete' | 'error';

export interface FullResultsExportState {
  phase: FullResultsExportPhase;
  message: string;
  filename: string | null;
}

const INITIAL_STATE: FullResultsExportState = { phase: 'idle', message: '', filename: null };

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message.slice(0, 240);
  return 'The results archive could not be created. Check the current workspace and try again.';
}

export function useFullResultsExport(project: ProjectState, blocked = false) {
  const [state, setState] = useState<FullResultsExportState>(INITIAL_STATE);
  const busyRef = useRef(false);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
  }, []);

  const startExport = useCallback(async () => {
    if (blocked || busyRef.current) return;
    busyRef.current = true;
    if (clearTimerRef.current !== null) window.clearTimeout(clearTimerRef.current);
    setState({ phase: 'preparing', message: 'Preparing the current workspace snapshot…', filename: null });
    try {
      const snapshot = structuredClone(project);
      const bundle = buildFullResultsExport(snapshot);
      setState({ phase: 'compressing', message: `Compressing ${bundle.files.length} result files…`, filename: bundle.filename });
      const bytes = await createResultsZip(bundle.files);
      setState({ phase: 'downloading', message: 'Downloading the Full Results ZIP…', filename: bundle.filename });
      triggerResultsDownload(bytes, bundle.filename);
      setState({ phase: 'complete', message: `Downloaded ${bundle.filename}.`, filename: bundle.filename });
      clearTimerRef.current = window.setTimeout(() => setState(INITIAL_STATE), 6000);
    } catch (error) {
      setState({ phase: 'error', message: errorMessage(error), filename: null });
      clearTimerRef.current = window.setTimeout(() => setState(INITIAL_STATE), 8000);
    } finally {
      busyRef.current = false;
    }
  }, [blocked, project]);

  return { ...state, busy: state.phase === 'preparing' || state.phase === 'compressing' || state.phase === 'downloading', startExport };
}
