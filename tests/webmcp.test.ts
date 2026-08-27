import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitAnalysisSnapshot } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { useProjectStore } from '@/store/projectStore';
import { registerAerociencySiteTools } from '@/webmcp/registerSiteTools';
import { AEROCIENCY_TOOLS } from '@/webmcp/tools';

describe('bounded Aerociency Site Tools surface', () => {
  beforeEach(() => useProjectStore.setState({ project: createDefaultProject(), analysisRun: { status: 'idle' }, mutationHighlight: null, commandNotice: null }));
  afterEach(() => vi.unstubAllGlobals());

  it('registers exactly the intended eight distinctive tools', () => {
    expect(AEROCIENCY_TOOLS.map((tool) => tool.name)).toEqual([
      'get_design_state', 'get_analysis_summary', 'inspect_span_station', 'create_candidate_variant',
      'update_wing_geometry', 'update_wing_structure', 'run_aeroelastic_analysis', 'compare_designs',
    ]);
    expect(AEROCIENCY_TOOLS.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(new Set(AEROCIENCY_TOOLS.map((tool) => tool.description)).size).toBe(8);
  });

  it('exposes explicit revisions and rejects unknown write fields', async () => {
    const stateTool = AEROCIENCY_TOOLS[0];
    const stateResult = await stateTool.execute({}) as { ok: true; data: { designs: Array<{ revision: number }> } };
    expect(stateResult.ok).toBe(true);
    expect(stateResult.data.designs[0].revision).toBe(1);
    const updateTool = AEROCIENCY_TOOLS.find((tool) => tool.name === 'update_wing_geometry')!;
    const invalid = await updateTool.execute({ designId: 'des_00000000000000000000000001', expectedDesignRevision: 1, idempotencyKey: crypto.randomUUID(), patch: { evil: 1 } }) as DomainResult;
    expect(invalid.ok).toBe(false);
  });

  it('rejects invalid enums, nonfinite numbers, out-of-range values, and baseline writes', async () => {
    const state = useProjectStore.getState().project;
    const baseline = state.designs[state.activeDesignId];
    const runTool = AEROCIENCY_TOOLS.find((tool) => tool.name === 'run_aeroelastic_analysis')!;
    const invalidFidelity = await runTool.execute({
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      expectedFlightCaseRevision: state.flightCase.revision,
      expectedConstraintsRevision: state.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'ultra',
    }) as DomainFailureResult;
    expect(invalidFidelity.ok).toBe(false);
    expect(invalidFidelity.error.code).toBe('VALIDATION_ERROR');

    const geometryTool = AEROCIENCY_TOOLS.find((tool) => tool.name === 'update_wing_geometry')!;
    for (const patch of [{ spanM: Number.NaN }, { spanM: 100 }, { tipTwistDeg: Number.POSITIVE_INFINITY }]) {
      const invalid = await geometryTool.execute({ designId: baseline.designId, expectedDesignRevision: 1, idempotencyKey: createIdempotencyKey(), patch }) as DomainFailureResult;
      expect(invalid.ok).toBe(false);
      expect(invalid.error.code).toBe('VALIDATION_ERROR');
    }
    const protectedWrite = await geometryTool.execute({
      designId: baseline.designId,
      expectedDesignRevision: baseline.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { tipTwistDeg: -1.5 },
    }) as DomainFailureResult;
    expect(protectedWrite.ok).toBe(false);
    expect(protectedWrite.error.code).toBe('BASELINE_PROTECTED');
    expect(useProjectStore.getState().project).toEqual(state);
  });

  it('keeps read results within bounded context budgets', async () => {
    const initial = useProjectStore.getState().project;
    const design = initial.designs[initial.activeDesignId];
    const snapshot = buildAnalysisSnapshot(initial, design, 'standard');
    const transition = commitAnalysisSnapshot(initial, {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: initial.flightCase.revision,
      expectedConstraintsRevision: initial.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, snapshot, 'solver');
    expect(transition.result.ok).toBe(true);
    useProjectStore.setState({ project: transition.state });

    const stateResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({});
    const summaryResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: snapshot.analysisId });
    const stationResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: snapshot.analysisId, eta: 0.5 });
    expect(JSON.stringify(stateResult).length).toBeLessThan(20_000);
    expect(JSON.stringify(summaryResult).length).toBeLessThan(20_000);
    expect(JSON.stringify(stationResult).length).toBeLessThan(10_000);
  });

  it('isolates every nested read result from live project state', async () => {
    const initial = useProjectStore.getState().project;
    const design = initial.designs[initial.activeDesignId];
    const snapshot = buildAnalysisSnapshot(initial, design, 'standard');
    const transition = commitAnalysisSnapshot(initial, {
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: initial.flightCase.revision,
      expectedConstraintsRevision: initial.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, snapshot, 'solver');
    expect(transition.result.ok).toBe(true);
    useProjectStore.setState({ project: transition.state });
    const authoritative = structuredClone(transition.state);

    const stateResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({}) as {
      data: {
        designs: Array<{ geometry: { spanM: number }; structure: { skinThicknessMm: number } }>;
        flightCase: { velocityMps: number };
        constraints: { minYieldMargin: number };
      };
    };
    stateResult.data.designs[0].geometry.spanM = -123;
    stateResult.data.designs[0].structure.skinThicknessMm = -1;
    stateResult.data.flightCase.velocityMps = -1;
    stateResult.data.constraints.minYieldMargin = -1;

    const summaryResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'get_analysis_summary')!.execute({ analysisId: snapshot.analysisId }) as {
      data: { convergence: { iterations: number } };
    };
    summaryResult.data.convergence.iterations = -1;

    const stationResult = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: snapshot.analysisId, eta: 0.5 }) as {
      data: { station: { deflectionM: number } };
    };
    stationResult.data.station.deflectionM = 999;

    expect(useProjectStore.getState().project).toEqual(authoritative);
    const reread = await AEROCIENCY_TOOLS.find((tool) => tool.name === 'get_design_state')!.execute({}) as {
      data: { designs: Array<{ geometry: { spanM: number } }>; flightCase: { velocityMps: number } };
    };
    expect(reread.data.designs[0].geometry.spanM).toBe(design.geometry.spanM);
    expect(reread.data.flightCase.velocityMps).toBe(initial.flightCase.velocityMps);
  });

  it('awaits registration, remains unique across remounts, and rolls back async failure', async () => {
    const registered = new Set<string>();
    const registeredCalls: string[] = [];
    const unregisteredCalls: string[] = [];
    const modelContext = {
      registerTool: async (value: unknown, options: { signal: AbortSignal }) => {
        const name = (value as { name: string }).name;
        if (registered.has(name)) throw new Error(`Duplicate ${name}`);
        registered.add(name);
        registeredCalls.push(name);
        options.signal.addEventListener('abort', () => {
          if (registered.delete(name)) unregisteredCalls.push(name);
        }, { once: true });
      },
    };
    vi.stubGlobal('document', { modelContext });
    const firstCleanup = registerAerociencySiteTools();
    expect(useProjectStore.getState().siteTools).toBe('checking');
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('ready'));
    expect([...registered]).toEqual(AEROCIENCY_TOOLS.map((tool) => tool.name));
    firstCleanup();
    await vi.waitFor(() => expect(registered.size).toBe(0));
    const secondCleanup = registerAerociencySiteTools();
    await vi.waitFor(() => expect(registered.size).toBe(8));
    secondCleanup();
    await vi.waitFor(() => expect(registered.size).toBe(0));
    expect(registeredCalls).toHaveLength(16);
    expect(unregisteredCalls).toHaveLength(16);

    let attempts = 0;
    const partial = new Set<string>();
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: async (value: unknown, options: { signal: AbortSignal }) => {
          attempts += 1;
          if (attempts === 4) throw new Error('Registration failed');
          const name = (value as { name: string }).name;
          partial.add(name);
          options.signal.addEventListener('abort', () => partial.delete(name), { once: true });
        },
      },
    });
    const failedCleanup = registerAerociencySiteTools();
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('error'));
    expect(partial.size).toBe(0);
    failedCleanup();
  });

  it('aborts a pending registration before a clean remount', async () => {
    const registered = new Set<string>();
    let firstSignal: AbortSignal | null = null;
    let pendingAbortObserved = false;
    vi.stubGlobal('document', {
      modelContext: {
        registerTool: (value: unknown, options: { signal: AbortSignal }) => {
          const name = (value as { name: string }).name;
          if (firstSignal === null) {
            firstSignal = options.signal;
            return new Promise<void>((_resolve, reject) => {
              options.signal.addEventListener('abort', () => {
                pendingAbortObserved = true;
                reject(new Error('Registration aborted.'));
              }, { once: true });
            });
          }
          if (registered.has(name)) throw new Error(`Duplicate ${name}`);
          registered.add(name);
          options.signal.addEventListener('abort', () => registered.delete(name), { once: true });
          return Promise.resolve();
        },
      },
    });

    const pendingCleanup = registerAerociencySiteTools();
    expect(useProjectStore.getState().siteTools).toBe('checking');
    pendingCleanup();
    expect(pendingAbortObserved).toBe(true);

    const remountCleanup = registerAerociencySiteTools();
    await vi.waitFor(() => expect(useProjectStore.getState().siteTools).toBe('ready'));
    expect(registered.size).toBe(8);
    remountCleanup();
    expect(registered.size).toBe(0);
  });
});

type DomainResult = { ok: boolean };
type DomainFailureResult = { ok: false; error: { code: string } };
