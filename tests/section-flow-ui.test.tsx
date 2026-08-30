// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionFlowLab } from '@/components/flow/SectionFlowLab';
import { createDefaultProject } from '@/lib/domain/defaults';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { deriveSectionCondition } from '@/lib/visualization/sectionFlow';

afterEach(() => cleanup());

function fixture() {
  const state = createDefaultProject();
  const design = state.designs[state.activeDesignId];
  const analysis = buildAnalysisSnapshot(state, design, 'standard');
  return { state, design, analysis };
}

describe('V3 Section Flow Lab', () => {
  it('derives one finite immutable section condition with the documented sign convention', () => {
    const { state, design, analysis } = fixture();
    const condition = deriveSectionCondition(design, analysis, state.flightCase, 0.5);
    expect(condition.analysisId).toBe(analysis.analysisId);
    expect(condition.localIncidenceDeg).toBeCloseTo(
      condition.trimIncidenceDeg + condition.geometricTwistDeg + condition.elasticTwistDeg - condition.inducedAngleDeg,
      12,
    );
    expect(condition.inducedAngleDeg).toBeGreaterThan(0);
    expect(condition.reynoldsNumber).toBeCloseTo(
      state.flightCase.airDensityKgM3 * state.flightCase.velocityMps * condition.chordM / state.flightCase.dynamicViscosityPaS,
      8,
    );
  });

  it('renders linked streamlines, Cp, validation evidence, warnings, and accessible controls', () => {
    const { state, design, analysis } = fixture();
    const onSelectEta = vi.fn();
    render(<SectionFlowLab design={design} analysis={analysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={onSelectEta} />);
    expect(screen.getByRole('heading', { name: new RegExp(`NACA 2412.*${analysis.analysisId}`) })).toBeVisible();
    expect(screen.getByRole('img', { name: /Inviscid streamlines and local velocity vectors/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Upper and lower surface pressure coefficient/ })).toBeVisible();
    expect(screen.getByText(/diagnostic does not alter the main wing analysis/)).toBeVisible();
    expect(screen.getByText(/Two-dimensional inviscid attached potential-flow diagnostic/)).toBeVisible();
    expect(screen.getByText(/Kutta residual/)).toBeVisible();
    expect(screen.getByText(/Re · coupled polar input/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Section panel resolution' })).toHaveValue('80');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section panel resolution' }), { target: { value: '120' } });
    expect(screen.getByRole('combobox', { name: 'Section panel resolution' })).toHaveValue('120');
    fireEvent.change(screen.getByRole('slider', { name: /Linked 3D station/ }), { target: { value: '0.7' } });
    expect(onSelectEta).toHaveBeenCalledWith(0.7);
  });

  it('fails closed without a current converged analysis', () => {
    const { state, design } = fixture();
    render(<SectionFlowLab design={design} analysis={null} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    expect(screen.getByText('A current converged wing analysis is required.')).toBeVisible();
    expect(screen.queryByRole('img', { name: /streamlines/i })).not.toBeInTheDocument();
  });
});
