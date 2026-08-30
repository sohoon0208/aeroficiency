// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/SpanwiseCharts', () => ({ SpanwiseCharts: () => <div data-testid="charts" /> }));
vi.mock('@/components/viewport/WingViewport', () => ({ WingViewport: () => <div data-testid="viewport" /> }));
vi.mock('@/webmcp/registerSiteTools', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/webmcp/registerSiteTools')>();
  return { ...original, registerAeroficiencySiteTools: vi.fn(() => undefined) };
});

import { AeroficiencyWorkspace } from '@/components/workspace/AeroficiencyWorkspace';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';

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

describe('editable Baseline workflow', () => {
  it('edits the initial Baseline, requires one candidate for comparison, and promotes that candidate without deleting either design', async () => {
    render(<AeroficiencyWorkspace />);
    const initial = useProjectStore.getState().project;
    const originalBaselineId = initial.activeDesignId;

    expect(screen.getByText('CREATE 1 CANDIDATE TO COMPARE')).toBeInTheDocument();
    const span = screen.getByRole('spinbutton', { name: 'Projected span in m' });
    expect(span).toBeEnabled();
    fireEvent.change(span, { target: { value: '11.8' } });
    fireEvent.blur(span);

    await waitFor(() => expect(useProjectStore.getState().project.designs[originalBaselineId]).toMatchObject({
      kind: 'baseline',
      revision: 2,
      geometry: { spanM: 11.8 },
    }));

    fireEvent.click(screen.getByRole('button', { name: '＋ Create candidate variant' }));
    await waitFor(() => expect(Object.keys(useProjectStore.getState().project.designs)).toHaveLength(2));
    let project = useProjectStore.getState().project;
    const candidate = Object.values(project.designs).find((design) => design.kind === 'candidate');
    if (!candidate) throw new Error('Candidate was not created.');
    expect(screen.getByText('1 CANDIDATE AVAILABLE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '◆ Set active design as Baseline' })).toBeEnabled();

    act(() => fireEvent.click(screen.getByRole('button', { name: '◆ Set active design as Baseline' })));
    await waitFor(() => expect(useProjectStore.getState().project.designs[candidate.designId].kind).toBe('baseline'));
    project = useProjectStore.getState().project;
    expect(project.activeDesignId).toBe(candidate.designId);
    expect(project.designs[originalBaselineId].kind).toBe('candidate');
    expect(Object.keys(project.designs)).toHaveLength(2);
    expect(Object.values(project.designs).filter((design) => design.kind === 'baseline')).toHaveLength(1);
    expect(screen.getByText('Baseline reference changed')).toBeVisible();
    expect(screen.getByRole('spinbutton', { name: 'Projected span in m' })).toBeEnabled();
  });
});
