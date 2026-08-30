import { describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { AnalysisSnapshot, ProjectState, WingDesign } from '@/lib/domain/types';
import { CANONICAL_TRADE_OFF_SENTENCE } from '@/lib/presentation/copy';
import { configuredCheckSummary, immutableResultState, presentedConstraints, visibleRunOutcome } from '@/lib/presentation/status';
import { buildCandidateVerdict, classifyDragChange, currentSelectedCandidateAnalysis, DRAG_REPORTING_NEUTRAL_PCT } from '@/lib/presentation/verdict';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function commit(state: ProjectState, design: WingDesign) {
  const snapshot = buildAnalysisSnapshot(state, design, 'standard');
  const transition = commitAnalysisSnapshot(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedProjectRevision: state.projectRevision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  }, snapshot, 'solver');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return { state: transition.state, snapshot };
}

function update(state: ProjectState, design: WingDesign, patch: { skinThicknessMm: number; frontWebThicknessMm: number; rearWebThicknessMm: number }) {
  const transition = updateWingStructure(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    idempotencyKey: createIdempotencyKey(),
    patch,
  }, 'agent');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return transition.state;
}

function twoPassFixture() {
  let state = createDefaultProject();
  const pristineBaseline = structuredClone(state.designs[state.activeDesignId]);
  const baselineRun = commit(state, state.designs[state.activeDesignId]);
  state = baselineRun.state;
  const branch = createCandidateVariant(state, {
    sourceDesignId: pristineBaseline.designId,
    expectedProjectRevision: state.projectRevision,
    expectedSourceDesignRevision: pristineBaseline.revision,
    candidateLabel: 'Two-pass mass study',
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  state = branch.state;

  state = update(state, state.designs[branch.result.data.designId], {
    skinThicknessMm: 1.75,
    frontWebThicknessMm: 2.1,
    rearWebThicknessMm: 2.1,
  });
  const firstRun = commit(state, state.designs[branch.result.data.designId]);
  const firstState = firstRun.state;

  state = update(firstState, firstState.designs[branch.result.data.designId], {
    skinThicknessMm: 1.65,
    frontWebThicknessMm: 2,
    rearWebThicknessMm: 2,
  });
  const finalRun = commit(state, state.designs[branch.result.data.designId]);
  return { pristineBaseline, baseline: baselineRun.snapshot, first: firstRun.snapshot, firstState, final: finalRun.snapshot, finalState: finalRun.state };
}

describe('canonical two-pass trade study and truthful verdicts', () => {
  it('fails the first mass proposal, corrects it, and reproduces the final five-check fixture', async () => {
    const fixture = twoPassFixture();
    const firstVerdict = buildCandidateVerdict(fixture.firstState, fixture.baseline, fixture.first);
    expect(firstVerdict.status).toBe('failed');
    if (firstVerdict.status === 'unavailable') return;
    expect(firstVerdict.passedChecks).toBe(4);
    expect(firstVerdict.wallMass.deltaPct).toBeCloseTo(-3.146, 2);
    expect(firstVerdict.checks.find((check) => check.key === 'mass_reduction')?.state).toBe('fail');
    expect(firstVerdict.checks.filter((check) => check.key !== 'mass_reduction').every((check) => check.state === 'pass')).toBe(true);

    const finalVerdict = buildCandidateVerdict(fixture.finalState, fixture.baseline, fixture.final);
    expect(finalVerdict.status).toBe('ready');
    if (finalVerdict.status === 'unavailable') return;
    expect(finalVerdict.title).toBe('Ready for human review');
    expect(finalVerdict.passedChecks).toBe(5);
    expect(finalVerdict.wallMass.deltaPct).toBeCloseTo(-8.493188692216165, 10);
    expect(finalVerdict.yieldRatio).toBeCloseTo(3.4541592255035125, 12);
    expect(finalVerdict.tipDeflection.actualM).toBeCloseTo(0.11896830161683179, 12);
    expect(finalVerdict.wakeDrag.deltaPct).toBeCloseTo(-0.003271683370555275, 12);
    expect(finalVerdict.wakeDrag.meaning).toBe('neutral');
    expect(finalVerdict.tradeOffSentence).toBe(CANONICAL_TRADE_OFF_SENTENCE);

    const preserved = fixture.finalState.designs[fixture.pristineBaseline.designId];
    expect(preserved.geometry).toEqual(fixture.pristineBaseline.geometry);
    expect(preserved.structure).toEqual(fixture.pristineBaseline.structure);
    expect(preserved.revision).toBe(fixture.pristineBaseline.revision);

    useProjectStore.setState({ project: fixture.finalState, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    const inspect = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'inspect_span_station')!.execute({ analysisId: fixture.final.analysisId, eta: 0 }) as { ok: true; data: { resolvedEta: number } };
    expect(inspect.ok).toBe(true);
    expect(inspect.data.resolvedEta).toBe(0);
    const comparison = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({ referenceAnalysisId: fixture.baseline.analysisId, candidateAnalysisId: fixture.final.analysisId }) as { ok: true; data: { summary: string } };
    expect(comparison.ok).toBe(true);
    expect(comparison.data.summary).toBe(CANONICAL_TRADE_OFF_SENTENCE);
    expect(useProjectStore.getState().presentation.comparisonAnalysisIds).toEqual({ referenceAnalysisId: fixture.baseline.analysisId, candidateAnalysisId: fixture.final.analysisId });
  }, 20_000);

  it('keeps immutable analysis truth distinct and treats baseline comparison checks as not applicable', () => {
    const fixture = twoPassFixture();
    expect(immutableResultState(null, false)).toMatchObject({ label: 'AWAITING ANALYSIS', verdictAvailable: false });
    expect(immutableResultState(fixture.final, true)).toMatchObject({ label: 'CURRENT RESULT', verdictAvailable: true });
    expect(immutableResultState(fixture.first, false)).toMatchObject({ label: 'STALE RESULT', verdictAvailable: false });
    const diagnostic = structuredClone(fixture.final) as AnalysisSnapshot;
    diagnostic.status = 'not_converged';
    expect(immutableResultState(diagnostic, false)).toMatchObject({ label: 'NOT CONVERGED', verdictAvailable: false });
    expect(configuredCheckSummary('baseline', fixture.baseline, true)).toEqual({ label: '3 / 3 intrinsic checks pass · 2 comparison checks N/A', tone: 'current', passed: 3, applicable: 3 });
    expect(configuredCheckSummary('candidate', fixture.first, true).label).toBe('4 / 5 configured checks pass');
    const staleBaselineChecks = presentedConstraints(fixture.baseline, false);
    expect(staleBaselineChecks.filter((check) => ['mass_reduction', 'induced_drag'].includes(check.key)).every((check) => check.state === 'unavailable')).toBe(true);
    expect(staleBaselineChecks.filter((check) => !['mass_reduction', 'induced_drag'].includes(check.key)).every((check) => check.state === 'stale')).toBe(true);

    const candidateWithoutReference = structuredClone(fixture.final);
    candidateWithoutReference.constraints = candidateWithoutReference.constraints.map((check) => ['mass_reduction', 'induced_drag'].includes(check.key)
      ? { ...check, state: 'unavailable', actual: null }
      : check);
    const staleCandidateChecks = presentedConstraints(candidateWithoutReference, false);
    expect(staleCandidateChecks.filter((check) => ['mass_reduction', 'induced_drag'].includes(check.key)).every((check) => check.state === 'unavailable')).toBe(true);
    expect(staleCandidateChecks.filter((check) => !['mass_reduction', 'induced_drag'].includes(check.key)).every((check) => check.state === 'stale')).toBe(true);
  });

  it('suppresses a retained green verdict until the user explicitly selects the retained current analysis', () => {
    const fixture = twoPassFixture();
    const state = structuredClone(fixture.finalState);
    const diagnostic = structuredClone(fixture.final);
    diagnostic.analysisId = 'ana_DIAGNOSTIC' as AnalysisSnapshot['analysisId'];
    diagnostic.status = 'not_converged';
    diagnostic.constraints = diagnostic.constraints.map((check) => ({ ...check, state: 'unavailable', actual: null }));
    state.analyses[diagnostic.analysisId] = diagnostic;
    state.selectedAnalysisId = diagnostic.analysisId;
    const active = state.designs[state.activeDesignId];
    expect(active.latestAnalysisId).toBe(fixture.final.analysisId);
    expect(currentSelectedCandidateAnalysis(state, active.designId, diagnostic)).toBeNull();
    expect(buildCandidateVerdict(state, fixture.baseline, currentSelectedCandidateAnalysis(state, active.designId, diagnostic))).toMatchObject({
      status: 'unavailable',
    });
    expect(currentSelectedCandidateAnalysis(state, active.designId, fixture.final)?.analysisId).toBe(fixture.final.analysisId);
  });

  it('keeps late run outcomes visible for their design even after its revision advances', () => {
    const fixture = twoPassFixture();
    const active = fixture.finalState.designs[fixture.finalState.activeDesignId];
    const run = {
      status: 'conflicted',
      designId: active.designId,
      designRevision: active.revision - 1,
      runId: 'run',
      code: 'REVISION_CONFLICT',
      message: 'Inputs changed before commit.',
      hadCurrentAnalysis: true,
    } as const;
    expect(visibleRunOutcome(run)).toBe(run);
  });

  it('does not let neutral display language hide a strict positive wake-drag failure', async () => {
    const fixture = twoPassFixture();
    const state = structuredClone(fixture.finalState);
    const candidate = structuredClone(fixture.final);
    candidate.metrics.inducedDragN = fixture.baseline.metrics.inducedDragN * 1.00014;
    candidate.constraints = candidate.constraints.map((check) => check.key === 'induced_drag'
      ? { ...check, state: 'fail', actual: 0.014 }
      : check);
    state.analyses[candidate.analysisId] = candidate;
    const verdict = buildCandidateVerdict(state, fixture.baseline, candidate);
    expect(verdict.status).toBe('failed');
    if (verdict.status === 'unavailable') return;
    expect(verdict.wakeDrag.meaning).toBe('neutral');
    expect(verdict.tradeOffSentence).toBeNull();

    useProjectStore.setState({ project: state, presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' } });
    const comparison = await AEROFICIENCY_TOOLS.find((tool) => tool.name === 'compare_designs')!.execute({
      referenceAnalysisId: fixture.baseline.analysisId,
      candidateAnalysisId: candidate.analysisId,
    }) as { ok: true; data: { summary: string } };
    expect(comparison.ok).toBe(true);
    expect(comparison.data.summary).toContain('one or more configured checks fail');
    expect(comparison.data.summary).toContain('neutral display language does not override the strict no-worse check');
  });

  it('uses the drag-neutral threshold for language only, including exact boundaries', () => {
    expect(DRAG_REPORTING_NEUTRAL_PCT).toBe(0.05);
    expect(classifyDragChange(-0.051)).toBe('improvement');
    expect(classifyDragChange(-0.05)).toBe('neutral');
    expect(classifyDragChange(-0.0141987)).toBe('neutral');
    expect(classifyDragChange(0)).toBe('neutral');
    expect(classifyDragChange(0.014)).toBe('neutral');
    expect(classifyDragChange(0.05)).toBe('neutral');
    expect(classifyDragChange(0.051)).toBe('worse');
    const fixture = twoPassFixture();
    expect(fixture.final.constraints.find((check) => check.key === 'induced_drag')?.limit).toBe(0);
    expect(fixture.final.constraints.find((check) => check.key === 'induced_drag')?.state).toBe('pass');
  });
});
