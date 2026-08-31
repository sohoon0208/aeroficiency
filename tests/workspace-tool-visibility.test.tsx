// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/charts/SpanwiseCharts', () => ({ SpanwiseCharts: () => <div data-testid="charts" /> }));
vi.mock('@/components/viewport/WingViewport', () => ({ WingViewport: () => <div data-testid="viewport" /> }));
vi.mock('@/webmcp/registerSiteTools', () => ({ AEROFICIENCY_TOOL_COUNT: 10, registerAeroficiencySiteTools: vi.fn(() => undefined) }));

import { AeroficiencyWorkspace } from '@/components/workspace/AeroficiencyWorkspace';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
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
    fireEvent.click(within(mobileNavigation).getByRole('button', { name: 'Results & Compare' }));
    const focusOwner = within(mobileNavigation).getByRole('button', { name: 'Results & Compare' });
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
