import type { AnalysisSnapshot, ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import type { CouplingProgress } from '@/lib/solver/coupling';
import AnalysisWorker from '@/workers/analysis.worker.ts?worker';

interface WorkerProgressMessage { type: 'progress'; progress: CouplingProgress }
interface WorkerCompleteMessage { type: 'complete'; snapshot: AnalysisSnapshot }
interface WorkerErrorMessage { type: 'error'; error: { name: string; code: string; message: string } }
type WorkerMessage = WorkerProgressMessage | WorkerCompleteMessage | WorkerErrorMessage;

export class AnalysisControllerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AnalysisControllerError';
  }
}

export function executeAnalysisWorker(
  state: ProjectState,
  design: WingDesign,
  fidelity: SolverFidelity,
  signal?: AbortSignal,
  onProgress?: (progress: CouplingProgress) => void,
) {
  return new Promise<AnalysisSnapshot>((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new AnalysisControllerError('TOOL_UNAVAILABLE', 'This browser cannot start the local analysis worker.'));
      return;
    }
    const worker = new AnalysisWorker({ name: 'aerociency-analysis' });
    const cleanUp = () => {
      signal?.removeEventListener('abort', abort);
      worker.terminate();
    };
    const abort = () => {
      cleanUp();
      reject(new AnalysisControllerError('ABORTED', 'Analysis was aborted before commit.'));
    };
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = (event) => {
      cleanUp();
      reject(new AnalysisControllerError('ANALYSIS_FAILED', event.message || 'Analysis worker failed.'));
    };
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      if (event.data.type === 'progress') { onProgress?.(event.data.progress); return; }
      cleanUp();
      if (event.data.type === 'complete') resolve(event.data.snapshot);
      else reject(new AnalysisControllerError(event.data.error.code, event.data.error.message));
    };
    try {
      worker.postMessage({ type: 'run', state, design, fidelity });
    } catch (error) {
      cleanUp();
      reject(new AnalysisControllerError('ANALYSIS_FAILED', error instanceof Error ? error.message : 'Analysis worker could not receive the request.'));
    }
  });
}
