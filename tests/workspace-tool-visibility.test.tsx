// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/SpanwiseCharts', () => ({ SpanwiseCharts: () => <div data-testid="charts" /> }));
vi.mock('@/components/viewport/WingViewport', () => ({ WingViewport: () => <div data-testid="viewport" /> }));
vi.mock('@/webmcp/registerSiteTools', () => ({ AEROFICIENCY_TOOL_COUNT: 10, registerAeroficiencySiteTools: vi.fn(() => undefined) }));

import { AeroficiencyWorkspace } from '@/components/workspace/AeroficiencyWorkspace';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { BATCH_CSV_HEADERS } from '@/lib/batchImport/constants';

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

describe('visible Site Tool mutation causality', () => {
  it('opens the affected editor and mobile Design view without moving keyboard focus', async () => {
    render(<AeroficiencyWorkspace />);
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    let candidateId = baseline.designId;
    act(() => {
      const created = useProjectStore.getState().createCandidate(baseline.designId, 'Visible structure target', 'agent');
      if (!created.ok) throw new Error(created.error.message);
      candidateId = created.data.designId;
      useProjectStore.getState().selectDesign(baseline.designId);
    });
    const mobileNavigation = screen.getByRole('navigation', { name: 'Workspace views' });
    fireEvent.click(within(mobileNavigation).getByRole('button', { name: 'Summary' }));
    const focusOwner = within(mobileNavigation).getByRole('button', { name: 'Summary' });
    focusOwner.focus();

    act(() => {
      const state = useProjectStore.getState().project;
      const result = useProjectStore.getState().updateStructure(
        candidateId,
        { skinThicknessMm: 1.7 },
        'agent',
        createIdempotencyKey(),
        state.designs[candidateId].revision,
      );
      if (!result.ok) throw new Error(result.error.message);
    });

    const designTabs = screen.getByRole('tablist', { name: 'Design editors' });
    await waitFor(() => expect(within(designTabs).getByRole('tab', { name: 'Structure' })).toHaveAttribute('aria-selected', 'true'));
    expect(screen.getByRole('button', { name: 'Design' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(focusOwner);
    const skinGauge = screen.getByRole('spinbutton', { name: 'Skin gauge in mm' });
    expect(skinGauge).toBeVisible();
    const changedField = skinGauge.closest('label');
    expect(changedField).toHaveClass('field-changed');
    expect(within(changedField as HTMLElement).getByText('Agent')).toBeVisible();
  });

  it('uses Summary as a two-way results drawer toggle', () => {
    render(<AeroficiencyWorkspace />);
    const mobileNavigation = screen.getByRole('navigation', { name: 'Workspace views' });
    const summary = within(mobileNavigation).getByRole('button', { name: 'Summary' });
    const visualizationControls = screen.getByRole('group', { name: 'Visualization controls' });
    const visualizationTabs = within(visualizationControls).getByRole('tablist', { name: 'Visualization mode' });
    const inlineSummary = within(visualizationControls).getByRole('button', { name: 'Summary' });
    expect(within(visualizationTabs).getByRole('tab', { name: 'Structure' }).compareDocumentPosition(inlineSummary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const workspace = document.querySelector('.workspace');
    expect(workspace).not.toHaveClass('summary-open');

    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(summary).toHaveAttribute('aria-pressed', 'true');
    expect(workspace).toHaveClass('summary-open');

    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    expect(summary).toHaveAttribute('aria-pressed', 'false');
    expect(workspace).not.toHaveClass('summary-open');
  });

  it('exposes one full-results ZIP action with truthful export counts', () => {
    render(<AeroficiencyWorkspace />);
    const exportButton = screen.getByRole('button', { name: 'Download Full Results ZIP' });
    expect(exportButton).toBeEnabled();
    expect(screen.getByText('0 current · 0 diagnostic · 0 stale · 1 unanalysed')).toBeVisible();
  });

  it('disables the ZIP action while an analysis is running', () => {
    const state = useProjectStore.getState().project;
    useProjectStore.setState({ analysisRun: {
      status: 'running',
      runId: 'run_test',
      designId: state.activeDesignId,
      designRevision: state.designs[state.activeDesignId].revision,
      progress: null,
    } });
    render(<AeroficiencyWorkspace />);
    expect(screen.getByRole('button', { name: 'Download Full Results ZIP' })).toBeDisabled();
  });

  it('opens the local CSV batch import dialog beside candidate creation', async () => {
    render(<AeroficiencyWorkspace />);
    const trigger = screen.getByRole('button', { name: '⇧ Import candidates' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Import candidates' });
    expect(within(dialog).getByText(/CSV only/i)).toBeVisible();
    expect(within(dialog).getByRole('link', { name: 'Download CSV template' })).toHaveAttribute('href', '/templates/aeroficiency-candidate-import.csv');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Import candidates' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(trigger);
  });

  it('accepts a normal .csv selection under Strict Mode and builds a preview', async () => {
    render(<StrictMode><AeroficiencyWorkspace /></StrictMode>);
    const trigger = screen.getByRole('button', { name: '⇧ Import candidates' });
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Import candidates' });
    const input = within(dialog).getByLabelText('Choose candidate CSV');
    const invalid = new File(['not a csv'], 'candidates.xlsx', { type: 'text/csv' });
    fireEvent.change(input, { target: { files: [invalid] } });
    expect(await within(dialog).findByText(/ends in \.csv/i)).toBeVisible();

    const csv = [BATCH_CSV_HEADERS.join(','), 'C1,Preview candidate,,,,,,,,,,,'].join('\n');
    const valid = new File([csv], 'candidates.CSV', { type: 'application/octet-stream' });
    fireEvent.change(input, { target: { files: [valid] } });
    await waitFor(() => expect(within(dialog).getByRole('region', { name: 'Candidate import preview' })).toBeVisible());
    expect(within(dialog).getByText('Preview candidate')).toBeVisible();
  });

  it('moves lost editor focus to changed evidence and preserves it across same-tab remounts', async () => {
    render(<AeroficiencyWorkspace />);
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    let candidateId = baseline.designId;
    act(() => {
      const created = useProjectStore.getState().createCandidate(baseline.designId, 'Keyboard focus target', 'agent');
      if (!created.ok) throw new Error(created.error.message);
      candidateId = created.data.designId;
    });
    const geometryInput = screen.getByRole('spinbutton', { name: 'Projected span in m' });
    geometryInput.focus();

    act(() => {
      const state = useProjectStore.getState().project;
      const result = useProjectStore.getState().updateStructure(
        candidateId,
        { skinThicknessMm: 1.7 },
        'agent',
        createIdempotencyKey(),
        state.designs[candidateId].revision,
      );
      if (!result.ok) throw new Error(result.error.message);
    });

    const skinGauge = await screen.findByRole('spinbutton', { name: 'Skin gauge in mm' });
    await waitFor(() => expect(document.activeElement).toBe(skinGauge));

    act(() => {
      const state = useProjectStore.getState().project;
      const result = useProjectStore.getState().updateStructure(
        candidateId,
        { frontWebThicknessMm: 2.1 },
        'agent',
        createIdempotencyKey(),
        state.designs[candidateId].revision,
      );
      if (!result.ok) throw new Error(result.error.message);
    });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('spinbutton', { name: 'Skin gauge in mm' })));
  });
});
