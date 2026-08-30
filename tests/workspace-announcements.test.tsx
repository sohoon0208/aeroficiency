// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/SpanwiseCharts', () => ({ SpanwiseCharts: () => <div data-testid="charts" /> }));
vi.mock('@/components/design/Editors', () => ({
  CaseEditor: () => <div />,
  GeometryEditor: () => <div />,
  StructureEditor: () => <div />,
}));
vi.mock('@/components/viewport/WingViewport', () => ({ WingViewport: () => <div data-testid="viewport" /> }));
vi.mock('@/webmcp/registerSiteTools', () => ({ AEROFICIENCY_TOOL_COUNT: 10, registerAeroficiencySiteTools: vi.fn(() => undefined) }));

import { AeroficiencyWorkspace } from '@/components/workspace/AeroficiencyWorkspace';
import { commitAnalysisSnapshot, createCandidateVariant, updateWingStructure } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { AnalysisId } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';

function staleCandidateFixture() {
  let project = createDefaultProject();
  const baseline = project.designs[project.activeDesignId];
  const branch = createCandidateVariant(project, {
    sourceDesignId: baseline.designId,
    expectedProjectRevision: project.projectRevision,
    expectedSourceDesignRevision: baseline.revision,
    candidateLabel: 'Announcement candidate',
    idempotencyKey: createIdempotencyKey(),
  }, 'human');
  if (!branch.result.ok) throw new Error(branch.result.error.message);
  project = branch.state;
  const candidate = project.designs[branch.result.data.designId];
  const snapshot = buildAnalysisSnapshot(project, candidate, 'fast');
  const committed = commitAnalysisSnapshot(project, {
    designId: candidate.designId,
    expectedDesignRevision: candidate.revision,
    expectedProjectRevision: project.projectRevision,
    expectedFlightCaseRevision: project.flightCase.revision,
    expectedConstraintsRevision: project.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'fast',
  }, snapshot, 'solver');
  if (!committed.result.ok) throw new Error(committed.result.error.message);
  project = committed.state;
  const edited = updateWingStructure(project, {
    designId: candidate.designId,
    expectedDesignRevision: candidate.revision,
    idempotencyKey: createIdempotencyKey(),
    patch: { skinThicknessMm: 1.75 },
  }, 'human');
  if (!edited.result.ok) throw new Error(edited.result.error.message);
  return { project: edited.state, candidateId: candidate.designId, runRevision: candidate.revision };
}

beforeEach(() => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches: true,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  useProjectStore.setState({
    project: createDefaultProject(),
    analysisRun: { status: 'idle' },
    siteTools: 'ready',
    presentation: createEmptyPresentationFocus(),
    mutationHighlight: null,
    commandNotice: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('workspace announcement ownership', () => {
  it('uses one polite live-region owner for presentation focus', async () => {
    render(<AeroficiencyWorkspace />);
    const baselineId = useProjectStore.getState().project.activeDesignId;
    act(() => useProjectStore.getState().focusAnalysisStation('ana_FOCUS' as AnalysisId, baselineId, 0, 'agent'));
    await waitFor(() => expect(screen.getByText(/Agent focus applied/)).toBeVisible());
    const owners = screen.getAllByRole('status').filter((region) => region.textContent?.includes('Agent focused immutable analysis ana_FOCUS'));
    expect(owners).toHaveLength(1);
    expect(screen.queryAllByRole('alert')).toHaveLength(0);
  });

  it('merges a run conflict and command notice into one assertive alert and labels stale retained evidence truthfully', () => {
    const fixture = staleCandidateFixture();
    useProjectStore.setState({
      project: fixture.project,
      analysisRun: {
        status: 'conflicted',
        runId: 'run-conflict',
        designId: fixture.candidateId,
        designRevision: fixture.runRevision,
        code: 'REVISION_CONFLICT',
        message: 'Inputs changed before commit.',
        hadCurrentAnalysis: true,
      },
      presentation: createEmptyPresentationFocus(),
      commandNotice: {
        actor: 'agent',
        designId: fixture.candidateId,
        code: 'REVISION_CONFLICT',
        message: 'Inputs changed before commit.',
        safeNextAction: 'Read the current revision before retrying.',
        retryable: true,
      },
    });
    render(<AeroficiencyWorkspace />);
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent('Inputs changed before commit.');
    expect(alerts[0]).toHaveTextContent('Read the current revision before retrying.');
    expect(document.body.textContent?.match(/Inputs changed before commit\./g)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show retained prior analysis' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Show retained current analysis' })).not.toBeInTheDocument();
  });

  it('keeps the running live announcement coarse while visual solver progress changes', () => {
    const project = createDefaultProject();
    const design = project.designs[project.activeDesignId];
    useProjectStore.setState({
      project,
      analysisRun: {
        status: 'running',
        runId: 'run-live',
        designId: design.designId,
        designRevision: design.revision,
        progress: { phase: 'aerodynamics', iteration: 1, maxIterations: 40 },
      },
    });
    render(<AeroficiencyWorkspace />);
    const liveOwner = screen.getAllByRole('status').find((region) => region.textContent?.includes('Analysis running for Baseline revision 1.'));
    expect(liveOwner).toBeDefined();
    act(() => useProjectStore.setState({
      analysisRun: {
        status: 'running',
        runId: 'run-live',
        designId: design.designId,
        designRevision: design.revision,
        progress: { phase: 'structure', iteration: 2, maxIterations: 40 },
      },
    }));
    expect(liveOwner).toHaveTextContent('Analysis running for Baseline revision 1.');
    expect(liveOwner).not.toHaveTextContent('aerodynamics');
    expect(liveOwner).not.toHaveTextContent('structure');
  });

  it('stacks simultaneous focus and rejection feedback instead of covering either banner', () => {
    const project = createDefaultProject();
    const design = project.designs[project.activeDesignId];
    useProjectStore.setState({
      project,
      presentation: {
        focusedPanel: 'station',
        designId: design.designId,
        analysisId: 'ana_STACK' as AnalysisId,
        eta: 0,
        comparisonAnalysisIds: null,
        actor: 'agent',
        sequence: 1,
        message: 'Agent focused exact station evidence.',
      },
      commandNotice: {
        actor: 'agent',
        designId: design.designId,
        code: 'REVISION_CONFLICT',
        message: 'The selected design advanced before the edit.',
        safeNextAction: 'Read the current design revision and retry.',
        retryable: true,
      },
    });
    render(<AeroficiencyWorkspace />);
    const stack = document.querySelector('.notification-stack');
    expect(stack).toBeInTheDocument();
    expect(stack?.children).toHaveLength(2);
    expect(within(stack as HTMLElement).getByText('Agent focused exact station evidence.')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('The selected design advanced before the edit.');
  });

  it.each([
    ['VALIDATION_ERROR', 'Input needs correction'],
    ['ANALYSIS_NOT_FOUND', 'Analysis not found'],
    ['ANALYSIS_ALREADY_RUNNING', 'Analysis already running'],
    ['INVALID_COMPARISON', 'Comparison request invalid'],
    ['INCOMPATIBLE_ANALYSES', 'Analyses are incompatible'],
    ['DESIGN_LIMIT_REACHED', 'Design limit reached'],
    ['WORKSPACE_STATE_INVALID', 'Workspace state needs reset'],
  ])('labels %s with its actual user-facing reason', (code, heading) => {
    const project = createDefaultProject();
    const design = project.designs[project.activeDesignId];
    useProjectStore.setState({
      project,
      commandNotice: {
        kind: 'failure',
        actor: 'agent',
        designId: design.designId,
        code,
        message: 'Specific bounded failure message.',
        safeNextAction: 'Specific safe next action.',
        retryable: false,
      },
    });
    render(<AeroficiencyWorkspace />);
    expect(screen.getByRole('alert')).toHaveTextContent(heading);
    expect(screen.queryByText('Command rejected safely')).not.toBeInTheDocument();
  });

  it('shows rejected commands for a non-active candidate with an explicit target label and ID', () => {
    const initial = createDefaultProject();
    const baseline = initial.designs[initial.activeDesignId];
    const branch = createCandidateVariant(initial, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: initial.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Hidden target candidate',
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    const project = { ...branch.state, activeDesignId: baseline.designId, selectedAnalysisId: null };
    useProjectStore.setState({
      project,
      commandNotice: {
        actor: 'agent',
        designId: branch.result.data.designId,
        code: 'REVISION_CONFLICT',
        message: 'The candidate advanced before this write.',
        safeNextAction: 'Read the candidate by ID and retry with its current revision.',
        retryable: true,
      },
    });
    render(<AeroficiencyWorkspace />);
    expect(screen.getByText('Baseline', { selector: 'h1' })).toBeVisible();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Target Hidden target candidate (${branch.result.data.designId}).`);
    expect(alert).toHaveTextContent('The candidate advanced before this write.');
  });

  it('renders an actual idempotent replay as polite global causality with no duplicate engineering change', async () => {
    render(<AeroficiencyWorkspace />);
    const baseline = useProjectStore.getState().project.designs[useProjectStore.getState().project.activeDesignId];
    const initialProjectRevision = useProjectStore.getState().project.projectRevision;
    const key = createIdempotencyKey();
    let first: ReturnType<typeof useProjectStore.getState>['createCandidate'] extends (...args: never[]) => infer R ? R : never;
    act(() => {
      first = useProjectStore.getState().createCandidate(baseline.designId, 'Visible replay candidate', 'agent', key, baseline.revision, initialProjectRevision);
    });
    expect(first!.ok).toBe(true);
    const beforeReplay = structuredClone(useProjectStore.getState().project);
    act(() => {
      useProjectStore.getState().createCandidate(baseline.designId, 'Visible replay candidate', 'agent', key, baseline.revision, initialProjectRevision);
    });
    expect(useProjectStore.getState().project).toEqual(beforeReplay);
    expect(screen.getByText('Idempotent replay · no duplicate write')).toBeVisible();
    const stack = document.querySelector('.notification-stack');
    expect(stack).toBeInTheDocument();
    expect(within(stack as HTMLElement).getByText(/no duplicate design or activity was created/i)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').some((status) => /Original candidate creation replayed/i.test(status.textContent ?? ''))).toBe(true);
  });

  it('keeps a non-active run outcome globally visible with its explicit target', () => {
    const initial = createDefaultProject();
    const baseline = initial.designs[initial.activeDesignId];
    const branch = createCandidateVariant(initial, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: initial.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Background run target',
      idempotencyKey: createIdempotencyKey(),
    }, 'agent');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    const project = { ...branch.state, activeDesignId: baseline.designId, selectedAnalysisId: null };
    useProjectStore.setState({
      project,
      analysisRun: {
        status: 'aborted',
        runId: 'background-abort',
        designId: branch.result.data.designId,
        designRevision: 1,
        code: 'ABORTED',
        message: 'Analysis was aborted before commit.',
        hadCurrentAnalysis: false,
      },
    });
    render(<AeroficiencyWorkspace />);
    expect(screen.getByText('Baseline', { selector: 'h1' })).toBeVisible();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(`Target Background run target (${branch.result.data.designId}).`);
    expect(alert.closest('.notification-stack')).toBeInTheDocument();
  });

  it('announces a successful background commit politely with its exact target and analysis', () => {
    const initial = createDefaultProject();
    const baseline = initial.designs[initial.activeDesignId];
    const branch = createCandidateVariant(initial, {
      sourceDesignId: baseline.designId,
      expectedProjectRevision: initial.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Foreground selection',
      idempotencyKey: createIdempotencyKey(),
    }, 'human');
    if (!branch.result.ok) throw new Error(branch.result.error.message);
    const analysisId = 'ana_00000000000000000000000999' as AnalysisId;
    useProjectStore.setState({
      project: branch.state,
      analysisRun: { status: 'succeeded', runId: 'background-success', designId: baseline.designId, designRevision: baseline.revision, analysisId },
      commandNotice: {
        kind: 'success',
        actor: 'solver',
        designId: baseline.designId,
        code: 'ANALYSIS_COMMITTED',
        message: `Analysis ${analysisId} converged and committed for design revision 1; the newer human selection was preserved.`,
        safeNextAction: `Select design ${baseline.designId} to inspect its current immutable result.`,
        retryable: false,
      },
    });
    render(<AeroficiencyWorkspace />);
    expect(screen.getByText('Analysis committed · background target')).toBeVisible();
    expect(screen.getAllByText(new RegExp(analysisId)).some((element) => element.classList.contains('sr-only') === false)).toBe(true);
    expect(screen.getByText(new RegExp(`Target Baseline \\(${baseline.designId}\\)`))).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getAllByRole('status').some((status) => status.textContent?.includes(analysisId))).toBe(true);
  });

  it('shows a truthful starting phase before the first worker progress event', () => {
    const project = createDefaultProject();
    const design = project.designs[project.activeDesignId];
    useProjectStore.setState({
      project,
      analysisRun: {
        status: 'running',
        runId: 'starting-run',
        designId: design.designId,
        designRevision: design.revision,
        progress: null,
      },
    });
    render(<AeroficiencyWorkspace />);
    const strip = document.querySelector('.solver-strip');
    expect(strip).toHaveTextContent('SOLVER RUNNING');
    expect(strip).toHaveTextContent('Starting local analysis worker…');
    expect(strip).not.toHaveTextContent('Run the solver to evaluate this revision.');
  });

  it('keeps the awaiting solver strip concise', () => {
    render(<AeroficiencyWorkspace />);
    const strip = document.querySelector('.solver-strip');
    expect(strip).toHaveTextContent('AWAITING ANALYSIS');
    expect(strip).not.toHaveTextContent('Run the solver to evaluate this revision.');
  });
});
