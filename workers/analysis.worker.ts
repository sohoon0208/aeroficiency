/// <reference lib="webworker" />

import type { ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { normalizeAnalysisException } from '@/lib/domain/publicErrors';
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
    const normalized = normalizeAnalysisException(error);
    worker.postMessage({
      type: 'error',
      error: {
        name: 'AnalysisWorkerError',
        code: normalized.category,
        message: normalized.message,
      },
    });
  }
};

export {};
