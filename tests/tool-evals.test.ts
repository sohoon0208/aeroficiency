import { beforeEach, describe, expect, it, vi } from 'vitest';

const workerMock = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/services/analysisController', () => ({ executeAnalysisWorker: workerMock.execute }));

import { createIdempotencyKey } from '@/lib/domain/ids';
import type { ProjectState, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { useProjectStore } from '@/store/projectStore';
import { AEROCIENCY_TOOLS } from '@/webmcp/tools';

interface ToolEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { message: string };
}

async function callTool<T>(name: string, input: unknown) {
  const tool = AEROCIENCY_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`Missing Site Tool: ${name}`);
  const result = await tool.execute(input) as ToolEnvelope<T>;
  if (!result.ok || result.data === undefined) throw new Error(result.error?.message ?? `${name} failed.`);
  return result.data;
}

async function runCanonicalToolTrace() {
  useProjectStore.getState().resetDemo();
  const initial = structuredClone(useProjectStore.getState().project);
  const initialBaseline = initial.designs[initial.activeDesignId];
  const state = await callTool<{
    designs: Array<{ designId: string; kind: string; revision: number }>;
    flightCase: { revision: number };
    constraints: { revision: number };
  }>('get_design_state', {});
  const baseline = state.designs.find((design) => design.kind === 'baseline');
  if (!baseline) throw new Error('Baseline is missing from the tool state.');

  const baselineRun = await callTool<{
    analysisId: string;
    metrics: { structuralMassKg: number; inducedDragN: number };
  }>('run_aeroelastic_analysis', {
    designId: baseline.designId,
    expectedDesignRevision: baseline.revision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  });

  const branch = await callTool<{ designId: string; revision: number }>('create_candidate_variant', {
    sourceDesignId: baseline.designId,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Agent mass study',
    idempotencyKey: createIdempotencyKey(),
  });
  const updated = await callTool<{ newDesignRevision: number }>('update_wing_structure', {
    designId: branch.designId,
    expectedDesignRevision: branch.revision,
    idempotencyKey: createIdempotencyKey(),
    patch: { skinThicknessMm: 1.65, frontWebThicknessMm: 2, rearWebThicknessMm: 2 },
  });
  const candidateRun = await callTool<{
    analysisId: string;
    allConstraintsSatisfied: boolean;
    metrics: {
      structuralMassKg: number;
      inducedDragN: number;
      tipDeflectionM: number;
      minYieldMargin: number;
    };
  }>('run_aeroelastic_analysis', {
    designId: branch.designId,
    expectedDesignRevision: updated.newDesignRevision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  });
  const comparison = await callTool<{
    deltas: {
      structuralMassKg: { percent: number | null };
      inducedDragN: { percent: number | null };
    };
    candidateConstraints: Array<{ state: string }>;
  }>('compare_designs', {
    referenceAnalysisId: baselineRun.analysisId,
    candidateAnalysisId: candidateRun.analysisId,
  });

  const final = useProjectStore.getState().project;
  const finalBaseline = final.designs[initialBaseline.designId];
  expect(finalBaseline.geometry).toEqual(initialBaseline.geometry);
  expect(finalBaseline.structure).toEqual(initialBaseline.structure);
  expect(finalBaseline.revision).toBe(initialBaseline.revision);
  expect(finalBaseline.updatedAt).toBe(initialBaseline.updatedAt);
  expect(finalBaseline.latestAnalysisId).toBe(baselineRun.analysisId);
  expect(candidateRun.allConstraintsSatisfied).toBe(true);
  expect(comparison.candidateConstraints.every((constraint) => constraint.state === 'pass')).toBe(true);
  expect(comparison.deltas.structuralMassKg.percent).toBeLessThanOrEqual(-5);
  expect(comparison.deltas.inducedDragN.percent).toBeLessThanOrEqual(0);
  expect(final.activities.filter((event) => event.actor === 'agent' && event.targetDesignId === branch.designId).length).toBeGreaterThanOrEqual(3);

  return {
    baselineMassKg: baselineRun.metrics.structuralMassKg,
    baselineDragN: baselineRun.metrics.inducedDragN,
    candidateMassKg: candidateRun.metrics.structuralMassKg,
    candidateDragN: candidateRun.metrics.inducedDragN,
    candidateDeflectionM: candidateRun.metrics.tipDeflectionM,
    candidateYieldMargin: candidateRun.metrics.minYieldMargin,
    massDeltaPct: comparison.deltas.structuralMassKg.percent,
    dragDeltaPct: comparison.deltas.inducedDragN.percent,
  };
}

describe('canonical Site Tools evaluation trace', () => {
  beforeEach(() => {
    workerMock.execute.mockReset();
    workerMock.execute.mockImplementation((state: ProjectState, design: WingDesign, fidelity: SolverFidelity) => (
      Promise.resolve(buildAnalysisSnapshot(state, design, fidelity))
    ));
  });

  it('passes all tool, store, comparison, activity, and baseline invariants ten out of ten times', async () => {
    const runs = [];
    for (let index = 0; index < 10; index += 1) runs.push(await runCanonicalToolTrace());
    expect(new Set(runs.map((run) => JSON.stringify(run))).size).toBe(1);
    expect(workerMock.execute).toHaveBeenCalledTimes(20);
  });

  it('rejects comparison after a candidate edit without launching another solve', async () => {
    useProjectStore.getState().resetDemo();
    const project = useProjectStore.getState().project;
    const baseline = project.designs[project.activeDesignId];
    const baselineRun = await callTool<{ analysisId: string }>('run_aeroelastic_analysis', {
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      expectedFlightCaseRevision: project.flightCase.revision,
      expectedConstraintsRevision: project.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    });
    const branch = await callTool<{ designId: string; revision: number }>('create_candidate_variant', {
      sourceDesignId: baseline.designId,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Stale comparison candidate',
      idempotencyKey: createIdempotencyKey(),
    });
    const candidateRun = await callTool<{ analysisId: string }>('run_aeroelastic_analysis', {
      designId: branch.designId,
      expectedDesignRevision: branch.revision,
      expectedFlightCaseRevision: project.flightCase.revision,
      expectedConstraintsRevision: project.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    });
    await callTool('update_wing_structure', {
      designId: branch.designId,
      expectedDesignRevision: branch.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { skinThicknessMm: 1.7 },
    });
    const beforeComparison = structuredClone(useProjectStore.getState().project);
    const compareTool = AEROCIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!;
    const comparison = await compareTool.execute({
      referenceAnalysisId: baselineRun.analysisId,
      candidateAnalysisId: candidateRun.analysisId,
    }) as { ok: false; error: { code: string } };

    expect(comparison.ok).toBe(false);
    expect(comparison.error.code).toBe('STALE_ANALYSIS');
    expect(useProjectStore.getState().project).toEqual(beforeComparison);
    expect(workerMock.execute).toHaveBeenCalledTimes(2);
  });
});
