/// <reference lib="webworker" />

import type { ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';

interface AnalysisWorkerRequest {
  type: 'run';
  state: ProjectState;
  design: WingDesign;
  fidelity: SolverFidelity;
}

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<AnalysisWorkerRequest>) => {
  if (event.data.type !== 'run') return;
  try {
    const snapshot = buildAnalysisSnapshot(
      event.data.state,
      event.data.design,
      event.data.fidelity,
      undefined,
      (progress) => worker.postMessage({ type: 'progress', progress }),
    );
    worker.postMessage({ type: 'complete', snapshot });
  } catch (error) {
    worker.postMessage({
      type: 'error',
      error: {
        name: error instanceof Error ? error.name : 'Error',
        code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'ANALYSIS_FAILED',
        message: error instanceof Error ? error.message : 'Analysis worker failed.',
      },
    });
  }
};

export {};
