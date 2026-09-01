// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ChallengeHeader } from '@/components/workspace/ChallengeHeader';
import { immutableResultState } from '@/lib/presentation/status';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHeader() {
  return render(<ChallengeHeader
    analysisState={immutableResultState(null, false)}
    activeDesignLabel="Baseline"
    activeDesignRevision={1}
    candidateCount={0}
    toolCount={10}
    siteTools="ready"
    running={false}
    onRun={vi.fn()}
    onCancel={vi.fn()}
    onReset={vi.fn()}
  />);
}

describe('challenge first-screen controls', () => {
  it('shows the reference case, objective, validity, editable Baseline, candidate requirement, and ten-tool readiness', () => {
    renderHeader();
    const logo = screen.getByRole('img', { name: 'Aeroficiency' });
    expect(logo).toBeVisible();
    expect(logo).toHaveAttribute('src', '/aeroficiency-logo-white.svg');
    expect(screen.queryByText('HUMAN + AGENT WING TRADE STUDIES')).not.toBeInTheDocument();
    expect(screen.getByText(/Reference Wing — 31\.6 kN target lift at 64 m\/s/)).toBeVisible();
    expect(screen.getByText(/Reduce modeled wall mass ≥5% · all 5 checks · wake drag no worse/)).toBeVisible();
    expect(screen.getByText('BASELINE EDITABLE')).toBeVisible();
    expect(screen.getByText('1 CANDIDATE REQUIRED')).toBeVisible();
    expect(screen.getByText('PRELIMINARY · key omissions disclosed')).toBeVisible();
    expect(screen.getByText('10 Site Tools ready')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset reference case' })).toBeEnabled();
  });

  it('omits the optional agent-task clipboard control', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: 'Copy agent task' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Model scope' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset reference case' })).toBeVisible();
  });

  it('opens a keyboard-accessible complete model-scope dialog and restores trigger focus on Escape', async () => {
    renderHeader();
    const trigger = screen.getByRole('button', { name: 'Model scope' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Supported model scope' });
    expect(dialog).toBeVisible();
    expect(screen.getByText('Key omissions')).toBeVisible();
    expect(screen.getByText(/No first-principles boundary layer, transition, turbulence, separation, or stall prediction/)).toBeVisible();
    expect(screen.getByText(/No fuselage, tail, nacelle, control-surface, interference, wave, or other full-aircraft drag/)).toBeVisible();
    expect(screen.getByText(/Aeroelastic divergence, flutter, gust response/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Close model scope' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });

  it('keeps the user’s dialog focus across live status rerenders', () => {
    const props = {
      analysisState: immutableResultState(null, false),
      activeDesignLabel: 'Baseline',
      activeDesignRevision: 1,
      candidateCount: 0,
      toolCount: 10,
      siteTools: 'ready' as const,
      running: false,
      onRun: vi.fn(),
      onCancel: vi.fn(),
      onReset: vi.fn(),
    };
    const rendered = render(<ChallengeHeader {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Model scope' }));
    const footerClose = screen.getByRole('button', { name: 'Close' });
    footerClose.focus();
    rendered.rerender(<ChallengeHeader {...props} siteTools="checking" activeDesignRevision={2} />);
    expect(footerClose).toHaveFocus();
  });

  it('keeps a real cancel action available while analysis is running', () => {
    const onCancel = vi.fn();
    render(<ChallengeHeader
      analysisState={immutableResultState(null, false)}
      activeDesignLabel="Candidate A"
      activeDesignRevision={2}
      candidateCount={1}
      toolCount={10}
      siteTools="ready"
      running
      onRun={vi.fn()}
      onCancel={onCancel}
      onReset={vi.fn()}
    />);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Solving…' })).toBeDisabled();
  });
});
