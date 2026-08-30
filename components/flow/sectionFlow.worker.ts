import type { CanonicalAirfoil } from '../../lib/solver/airfoilSections';
import {
  sampleSectionVelocityVectors,
  solveAirfoilSectionPotentialFlow,
  traceSectionStreamlines,
  type SectionPotentialFlowSolution,
  type SectionStreamline,
  type SectionVelocityVector,
  type StreamlineTraceOptions,
} from '../../lib/solver/panel2d';

interface SectionFlowWorkerRequest {
  requestId: number;
  scopeKey: string;
  section: CanonicalAirfoil;
  incidenceDeg: number;
  freeStreamMps: number;
  panelCount: number;
  streamlineCount: number;
  traceOptions?: StreamlineTraceOptions;
}

interface SectionFlowWorkerResponse {
  requestId: number;
  scopeKey: string;
  solution?: SectionPotentialFlowSolution;
  lines?: SectionStreamline[];
  vectors?: SectionVelocityVector[];
  error?: string;
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<SectionFlowWorkerRequest>) => void) | null;
  postMessage: (message: SectionFlowWorkerResponse) => void;
};

workerScope.onmessage = ({ data }) => {
  try {
    const solution = solveAirfoilSectionPotentialFlow(data.section, data.incidenceDeg, data.freeStreamMps, data.panelCount);
    workerScope.postMessage({
      requestId: data.requestId,
      scopeKey: data.scopeKey,
      solution,
      lines: traceSectionStreamlines(solution, data.streamlineCount, data.traceOptions),
      vectors: sampleSectionVelocityVectors(solution),
    });
  } catch (error) {
    workerScope.postMessage({
      requestId: data.requestId,
      scopeKey: data.scopeKey,
      error: error instanceof Error ? error.message : 'Section flow worker failed.',
    });
  }
};

export {};
