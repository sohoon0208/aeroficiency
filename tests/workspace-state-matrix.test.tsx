// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/SpanwiseCharts', () => ({ SpanwiseCharts: () => <div data-testid="charts" /> }));
vi.mock('@/components/design/Editors', () => ({
  AirfoilEditor: () => <div />,
  CaseEditor: () => <div />,
  GeometryEditor: () => <div />,
  StructureEditor: () => <div />,
}));
vi.mock('@/components/viewport/WingViewport', () => ({ WingViewport: ({ analysis }: { analysis: unknown }) => <div data-testid="viewport" data-has-analysis={analysis ? 'true' : 'false'} /> }));
vi.mock('@/webmcp/registerSiteTools', () => ({ AEROFICIENCY_TOOL_COUNT: 10, registerAeroficiencySiteTools: vi.fn(() => undefined) }));

import { AeroficiencyWorkspace } from '@/components/workspace/AeroficiencyWorkspace';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { evaluateDesignConstraints } from '@/lib/domain/constraints';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { CANONICAL_TRADE_OFF_SENTENCE } from '@/lib/presentation/copy';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import type { ProjectState, WingDesign } from '@/lib/domain/types';
import { createEmptyPresentationFocus, type AnalysisRunState, type CommandNotice, useProjectStore } from '@/store/projectStore';

function commit(state: ProjectState, design: WingDesign, fidelity: 'fast' | 'standard' = 'standard') {
  const snapshot = buildAnalysisSnapshot(state, design, fidelity);
  const transition = commitAnalysisSnapshot(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    expectedProjectRevision: state.projectRevision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity,
  }, snapshot, 'solver');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return { state: transition.state, snapshot };
}

function update(state: ProjectState, design: WingDesign, patch: { skinThicknessMm: number; frontWebThicknessMm?: number; rearWebThicknessMm?: number }) {
  const transition = updateWingStructure(state, {
    designId: design.designId,
    expectedDesignRevision: design.revision,
    idempotencyKey: createIdempotencyKey(),
    patch,
  }, 'agent');
  if (!transition.result.ok) throw new Error(transition.result.error.message);
  return transition.state;
}

interface RenderScenario {
  project: ProjectState;
  analysisRun: AnalysisRunState;
  commandNotice: CommandNotice | null;
}

interface MatrixFixtures {
  freshBaseline: RenderScenario;
  currentBaseline: RenderScenario;
  freshCandidate: RenderScenario;
  failingCandidate: RenderScenario;
  passingCandidate: RenderScenario;
  staleCandidate: RenderScenario;
  nonConvergedWithPrior: RenderScenario;
  abortedWithPrior: RenderScenario;
  conflictAfterAdvance: RenderScenario;
}

let cachedFixtures: MatrixFixtures | null = null;

function matrixFixtures(): MatrixFixtures {
  if (cachedFixtures) return cachedFixtures;
  const idle: AnalysisRunState = { status: 'idle' };
  const fresh = createDefaultProject();
  const baseline = fresh.designs[fresh.activeDesignId];
  const baselineRun = commit(fresh, baseline);
  const branch = createCandidateVariant(baselineRun.state, {
    sourceDesignId: baseline.designId,
    expectedProjectRevision: baselineRun.state.projectRevision,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Rendered matrix candidate',
    idempotencyKey: createIdempotencyKey(),
  }, 'agent');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  const freshCandidateState = branch.state;
  const candidateId = branch.result.data.designId;

  const firstEdited = update(freshCandidateState, freshCandidateState.designs[candidateId], {
    skinThicknessMm: 1.75,
    frontWebThicknessMm: 2.1,
    rearWebThicknessMm: 2.1,
  });
  const firstRun = commit(firstEdited, firstEdited.designs[candidateId]);
  const finalEdited = update(firstRun.state, firstRun.state.designs[candidateId], {
    skinThicknessMm: 1.65,
    frontWebThicknessMm: 2,
    rearWebThicknessMm: 2,
  });
  const finalRun = commit(finalEdited, finalEdited.designs[candidateId]);
  const staleState = update(finalRun.state, finalRun.state.designs[candidateId], { skinThicknessMm: 1.7 });

  const diagnostic = buildAnalysisSnapshot(finalRun.state, finalRun.state.designs[candidateId], 'standard');
  diagnostic.status = 'not_converged';
  diagnostic.convergence.iterations = 40;
  diagnostic.convergence.equilibriumResidual = 0.01;
  diagnostic.convergence.twistChangeDeg = 0.1;
  diagnostic.convergence.relativeLoadChange = 0.01;
  diagnostic.constraints = evaluateDesignConstraints(
    finalRun.state,
    finalRun.state.designs[candidateId],
    diagnostic.fidelity,
    diagnostic.status,
    diagnostic.metrics.structuralMassKg,
    diagnostic.metrics.inducedDragN,
    diagnostic.metrics.minYieldMargin,
    diagnostic.metrics.tipDeflectionM,
  );
  const diagnosticCommit = commitAnalysisSnapshot(finalRun.state, {
    designId: candidateId,
    expectedDesignRevision: finalRun.state.designs[candidateId].revision,
    expectedProjectRevision: finalRun.state.projectRevision,
    expectedFlightCaseRevision: finalRun.state.flightCase.revision,
    expectedConstraintsRevision: finalRun.state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  }, diagnostic, 'solver');
  if (diagnosticCommit.result.ok || !diagnosticCommit.result.error.committed) throw new Error('Expected retained non-converged diagnostic fixture.');

  const passingRevision = finalRun.state.designs[candidateId].revision;
  const nonConvergedRun: AnalysisRunState = {
    status: 'not_converged',
    runId: 'matrix-not-converged',
    designId: candidateId,
    designRevision: passingRevision,
    analysisId: diagnostic.analysisId,
    message: 'The latest diagnostic did not converge.',
    hadCurrentAnalysis: true,
  };
  const abortedRun: AnalysisRunState = {
    status: 'aborted',
    runId: 'matrix-aborted',
    designId: candidateId,
    designRevision: passingRevision,
    code: 'ABORTED',
    message: 'Analysis was aborted before commit.',
    hadCurrentAnalysis: true,
  };
  const conflictRun: AnalysisRunState = {
    status: 'conflicted',
    runId: 'matrix-conflict',
    designId: candidateId,
    designRevision: passingRevision,
    code: 'REVISION_CONFLICT',
    message: 'Inputs changed before commit.',
    hadCurrentAnalysis: true,
  };
  const conflictNotice: CommandNotice = {
    kind: 'failure',
    actor: 'agent',
    designId: candidateId,
    code: 'REVISION_CONFLICT',
    message: 'Inputs changed before commit.',
    safeNextAction: 'Read candidate revision 4 and preserve the human change before retrying.',
    retryable: true,
  };

  cachedFixtures = {
    freshBaseline: { project: fresh, analysisRun: idle, commandNotice: null },
    currentBaseline: { project: baselineRun.state, analysisRun: idle, commandNotice: null },
    freshCandidate: { project: freshCandidateState, analysisRun: idle, commandNotice: null },
    failingCandidate: { project: firstRun.state, analysisRun: idle, commandNotice: null },
    passingCandidate: { project: finalRun.state, analysisRun: idle, commandNotice: null },
    staleCandidate: { project: staleState, analysisRun: idle, commandNotice: null },
    nonConvergedWithPrior: { project: diagnosticCommit.state, analysisRun: nonConvergedRun, commandNotice: null },
    abortedWithPrior: { project: finalRun.state, analysisRun: abortedRun, commandNotice: null },
    conflictAfterAdvance: { project: staleState, analysisRun: conflictRun, commandNotice: conflictNotice },
  };
  return cachedFixtures;
}

function loadScenario(scenario: RenderScenario) {
  useProjectStore.setState({
    project: structuredClone(scenario.project),
    analysisRun: structuredClone(scenario.analysisRun),
    siteTools: 'ready',
    presentation: createEmptyPresentationFocus(),
    mutationHighlight: null,
    commandNotice: structuredClone(scenario.commandNotice),
  });
}

function assertStatusSurfaces(label: string) {
  expect(document.querySelector('.analysis-chip')).toHaveTextContent(label);
  expect(document.querySelector('.solver-strip > span:first-child')).toHaveTextContent(label);
  expect(document.querySelector('.result-pill')).toHaveTextContent(label);
}

function checkSection() {
  fireEvent.click(screen.getByRole('tab', { name: 'Checks' }));
  const heading = screen.getByRole('heading', { name: 'Configured trade-study checks' });
  const section = heading.closest('section');
  if (!section) throw new Error('Missing rendered check section.');
  return section;
}

const matrix = [
  { key: 'freshBaseline', name: 'fresh baseline', status: 'AWAITING ANALYSIS', summary: 'Awaiting analysis', pass: 0, fail: 0, unavailable: 5, stale: 0, verdict: 'none' },
  { key: 'currentBaseline', name: 'current analyzed baseline', status: 'CURRENT RESULT', summary: '3 / 3 intrinsic checks pass · 2 comparison checks N/A', pass: 3, fail: 0, unavailable: 2, stale: 0, verdict: 'none' },
  { key: 'freshCandidate', name: 'fresh candidate', status: 'AWAITING ANALYSIS', summary: 'Awaiting analysis', pass: 0, fail: 0, unavailable: 5, stale: 0, verdict: 'unavailable' },
  { key: 'failingCandidate', name: 'current failing candidate', status: 'CURRENT RESULT', summary: '4 / 5 configured checks pass', pass: 4, fail: 1, unavailable: 0, stale: 0, verdict: 'failed' },
  { key: 'passingCandidate', name: 'current passing candidate', status: 'CURRENT RESULT', summary: '5 / 5 configured checks pass', pass: 5, fail: 0, unavailable: 0, stale: 0, verdict: 'ready' },
  { key: 'staleCandidate', name: 'stale candidate', status: 'STALE RESULT', summary: 'Verdict unavailable · stale', pass: 0, fail: 0, unavailable: 0, stale: 5, verdict: 'unavailable' },
  { key: 'nonConvergedWithPrior', name: 'non-converged diagnostic with retained current result', status: 'NOT CONVERGED', summary: 'Verdict unavailable · not converged', pass: 0, fail: 0, unavailable: 5, stale: 0, verdict: 'withheld' },
  { key: 'abortedWithPrior', name: 'aborted attempt with retained current result', status: 'CURRENT RESULT', summary: '5 / 5 configured checks pass', pass: 5, fail: 0, unavailable: 0, stale: 0, verdict: 'withheld' },
  { key: 'conflictAfterAdvance', name: 'revision conflict after design advance', status: 'STALE RESULT', summary: 'Verdict unavailable · stale', pass: 0, fail: 0, unavailable: 0, stale: 5, verdict: 'unavailable' },
] as const;

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('rendered presentation-state truth matrix', () => {
  it.each(matrix)('$name keeps status, checks, and verdict mutually consistent', ({ key, status, summary, pass, fail, unavailable, stale, verdict }) => {
    loadScenario(matrixFixtures()[key]);
    render(<AeroficiencyWorkspace />);
    assertStatusSurfaces(status);
    const checks = checkSection();
    expect(within(checks).getByText(summary)).toBeVisible();
    expect(checks.querySelectorAll('.constraint-list > div')).toHaveLength(5);
    expect(checks.querySelectorAll('.constraint-list b.pass')).toHaveLength(pass);
    expect(checks.querySelectorAll('.constraint-list b.fail')).toHaveLength(fail);
    expect(checks.querySelectorAll('.constraint-list b.unavailable')).toHaveLength(unavailable);
    expect(checks.querySelectorAll('.constraint-list b.stale')).toHaveLength(stale);
    expect(within(checks).getAllByText(/Check state:/)).toHaveLength(5);

    const verdictHeading = screen.queryByRole('heading', { name: 'Candidate verdict' });
    if (verdict === 'none') {
      expect(verdictHeading).not.toBeInTheDocument();
    } else {
      const verdictSection = verdictHeading?.closest('section');
      if (!verdictSection) throw new Error('Missing rendered candidate verdict section.');
      if (verdict === 'ready') {
        expect(within(verdictSection).getByText('Ready for human review')).toBeVisible();
        expect(within(verdictSection).getByText(CANONICAL_TRADE_OFF_SENTENCE)).toBeVisible();
      } else if (verdict === 'failed') {
        expect(within(verdictSection).getByText('Configured checks not met')).toBeVisible();
        expect(within(verdictSection).getByText('4 / 5')).toBeVisible();
      } else if (verdict === 'withheld') {
        expect(within(verdictSection).getByText(/current candidate result is retained/i)).toBeVisible();
        fireEvent.click(screen.getByRole('tab', { name: 'Compare' }));
        expect(screen.getByText('Comparison withheld')).toBeVisible();
      } else {
        expect(within(verdictSection).getByText('Unavailable')).toBeVisible();
      }
    }

    if (verdict !== 'ready') {
      expect(screen.queryByText('Ready for human review')).not.toBeInTheDocument();
      expect(screen.queryByText(CANONICAL_TRADE_OFF_SENTENCE)).not.toBeInTheDocument();
    }
  }, 20_000);

  it.each([
    ['nonConvergedWithPrior', 'Show retained current analysis'],
    ['abortedWithPrior', 'Show retained current analysis'],
  ] as const)('%s restores the green verdict only after explicit retained-result acknowledgement', (key, actionName) => {
    loadScenario(matrixFixtures()[key]);
    render(<AeroficiencyWorkspace />);
    expect(screen.queryByText('Ready for human review')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: actionName }));
    assertStatusSurfaces('CURRENT RESULT');
    fireEvent.click(screen.getByRole('tab', { name: 'Checks' }));
    expect(screen.getByText('Ready for human review')).toBeVisible();
    expect(screen.getByText(CANONICAL_TRADE_OFF_SENTENCE)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('keeps a conflicted retained result stale after explicitly showing it', () => {
    loadScenario(matrixFixtures().conflictAfterAdvance);
    render(<AeroficiencyWorkspace />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Attempted design r3; current design r4.');
    expect(alerts[0]).toHaveTextContent('Read candidate revision 4 and preserve the human change before retrying.');
    expect(alerts[0]).toHaveTextContent('A retained prior analysis is now stale.');
    fireEvent.click(screen.getByRole('button', { name: 'Show retained prior analysis' }));
    assertStatusSurfaces('STALE RESULT');
    expect(screen.queryByText('Ready for human review')).not.toBeInTheDocument();
  });

  it('gives every editor tab a persistent controlled panel relationship', () => {
    loadScenario(matrixFixtures().freshBaseline);
    render(<AeroficiencyWorkspace />);
    const tablist = screen.getByRole('tablist', { name: 'Design editors' });
    for (const name of ['Planform', 'Airfoils', 'Structure', 'Case']) {
      const tab = within(tablist).getByRole('tab', { name, selected: name === 'Planform' });
      const controlledId = tab.getAttribute('aria-controls');
      expect(controlledId).toBeTruthy();
      expect(document.getElementById(controlledId!)).toHaveAttribute('role', 'tabpanel');
    }
  });

  it('exposes five keyboard-navigable visualization modes through one controlled panel', () => {
    loadScenario(matrixFixtures().currentBaseline);
    render(<AeroficiencyWorkspace />);
    const tablist = screen.getByRole('tablist', { name: 'Visualization mode' });
    const names = ['Geometry', 'Aero loads', '2D Section', 'Efficiency', 'Structure'];
    for (const name of names) {
      const tab = within(tablist).getByRole('tab', { name });
      expect(tab).toHaveAttribute('aria-controls', 'model-view-panel');
    }
    expect(within(tablist).queryByRole('tab', { name: '3D Flow' })).not.toBeInTheDocument();
    const geometry = within(tablist).getByRole('tab', { name: 'Geometry' });
    fireEvent.keyDown(geometry, { key: 'ArrowRight' });
    expect(within(tablist).getByRole('tab', { name: 'Aero loads' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(tablist).getByRole('tab', { name: '2D Section' }));
    expect(document.getElementById('model-view-panel')).toHaveAttribute('aria-labelledby', 'view-tab-section');
    expect(screen.getByRole('region', { name: 'Two-dimensional section flow laboratory' })).toBeVisible();
  });

  it('keeps the span-station scrubber in the selected-station evidence row', () => {
    loadScenario(matrixFixtures().freshBaseline);
    render(<AeroficiencyWorkspace />);
    const evidence = document.getElementById('selected-station-evidence');
    if (!evidence) throw new Error('Missing selected-station evidence row.');
    const scrubber = within(evidence).getByRole('slider', { name: 'Selected span station' });
    fireEvent.change(scrubber, { target: { value: '0.322' } });
    expect(within(evidence).getByText('η 0.322')).toBeVisible();
    expect(useProjectStore.getState().project.selectedEta).toBe(0.322);
  });

  it('withholds full-wing evidence when the retained engineering analysis is stale', () => {
    loadScenario(matrixFixtures().staleCandidate);
    render(<AeroficiencyWorkspace />);
    const tablist = screen.getByRole('tablist', { name: 'Visualization mode' });
    fireEvent.click(within(tablist).getByRole('tab', { name: '2D Section' }));
    expect(screen.getByText('A current converged wing analysis is required.')).toBeVisible();
    fireEvent.click(within(tablist).getByRole('tab', { name: 'Aero loads' }));
    expect(screen.getByTestId('viewport')).toHaveAttribute('data-has-analysis', 'false');
  });

  it('does not promise no-rerun recovery for a stale pinned pair whose current replacements use mixed fidelity', () => {
    let state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const oldBaseline = commit(state, baseline, 'standard');
    state = oldBaseline.state;
    const branch = createCandidateVariant(state, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: state.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Pinned fidelity candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    state = branch.state;
    const candidate = state.designs[branch.result.data.designId];
    const oldCandidate = commit(state, candidate, 'standard');
    state = oldCandidate.state;
    const newBaseline = commit(state, state.designs[baseline.designId], 'fast');
    state = newBaseline.state;
    const newCandidate = commit(state, state.designs[candidate.designId], 'standard');
    state = newCandidate.state;
    useProjectStore.setState({
      project: state,
      analysisRun: { status: 'idle' },
      siteTools: 'ready',
      mutationHighlight: null,
      commandNotice: null,
      presentation: {
        focusedPanel: 'comparison',
        designId: candidate.designId,
        analysisId: oldCandidate.snapshot.analysisId,
        eta: null,
        comparisonAnalysisIds: {
          referenceAnalysisId: oldBaseline.snapshot.analysisId,
          candidateAnalysisId: oldCandidate.snapshot.analysisId,
        },
        actor: 'agent',
        sequence: 1,
        message: null,
      },
    });
    render(<AeroficiencyWorkspace />);
    const recovery = document.querySelector('.comparison-stale');
    expect(recovery).toHaveTextContent('Pinned values are historical.');
    expect(recovery).toHaveTextContent(`Run candidate design ${candidate.designId} at fast fidelity`);
    expect(recovery).not.toHaveTextContent('no rerun is required');
    expect(recovery).toHaveTextContent(newBaseline.snapshot.analysisId);
    expect(recovery).toHaveTextContent(newCandidate.snapshot.analysisId);
  });
});
