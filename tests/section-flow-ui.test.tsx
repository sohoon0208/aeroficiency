// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SectionFlowLab } from '@/components/flow/SectionFlowLab';
import { analysisAtSweepPoint, sweepPointAtAngle, sweepPresentationAtAngle } from '@/lib/domain/angleSweep';
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
      condition.wingAngleOfAttackDeg + condition.geometricTwistDeg + condition.elasticTwistDeg - condition.inducedAngleDeg,
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
    expect(screen.getByRole('heading', { name: /NACA 2412.*wing α/ })).toBeVisible();
    expect(screen.getByText(new RegExp(`Presentation derived from immutable analysis ${analysis.analysisId}`))).toBeVisible();
    expect(screen.getByRole('img', { name: /Wind-axis inviscid attached-flow streamlines/ })).toBeVisible();
    expect(screen.getByRole('img', { name: /Upper and lower surface pressure coefficient/ })).toBeVisible();
    expect(screen.getByText(/Wind axes · horizontal U∞/)).toBeVisible();
    expect(screen.getByText(/diagnostic does not alter the main wing analysis/)).toBeVisible();
    expect(screen.getByText(/Two-dimensional inviscid attached potential-flow diagnostic/)).toBeVisible();
    expect(screen.getByText(/cannot predict boundary layers, separation, stall/)).toBeVisible();
    expect(screen.getByText(/Kutta residual/)).toBeVisible();
    expect(screen.getByText(/Re · coupled polar input/)).toBeVisible();
    expect(screen.getByRole('combobox', { name: 'Section panel resolution' })).toHaveValue('120');
    fireEvent.change(screen.getByRole('combobox', { name: 'Section panel resolution' }), { target: { value: '160' } });
    expect(screen.getByRole('combobox', { name: 'Section panel resolution' })).toHaveValue('160');
    fireEvent.change(screen.getByRole('slider', { name: /Linked 3D station/ }), { target: { value: '0.7' } });
    expect(onSelectEta).toHaveBeenCalledWith(0.7);
  });

  it('rotates the rendered airfoil when the selected angle of attack changes', () => {
    const { state, design, analysis } = fixture();
    const lowPoint = sweepPointAtAngle(analysis, -4);
    const highPoint = sweepPointAtAngle(analysis, 10);
    expect(lowPoint).not.toBeNull();
    expect(highPoint).not.toBeNull();
    const lowAnalysis = analysisAtSweepPoint(analysis, lowPoint!);
    const highAnalysis = analysisAtSweepPoint(analysis, highPoint!);
    const rendered = render(<SectionFlowLab design={design} analysis={lowAnalysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    const lowGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    const lowIncidence = Number(lowGraphic.dataset.incidenceDeg);
    const lowOutline = lowGraphic.querySelector('.section-airfoil')!.getAttribute('points');

    rendered.rerender(<SectionFlowLab design={design} analysis={highAnalysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    const highGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    const highIncidence = Number(highGraphic.dataset.incidenceDeg);
    const highOutline = highGraphic.querySelector('.section-airfoil')!.getAttribute('points');

    expect(highIncidence).toBeGreaterThan(lowIncidence);
    expect(highOutline).not.toBe(lowOutline);
    expect(highGraphic).toHaveAccessibleName(new RegExp(`airfoil at ${highIncidence.toFixed(2)} degrees local incidence`));
  });

  it('recalculates pressure and streamlines across fine interpolated AoA movements', () => {
    const { state, design, analysis } = fixture();
    const first = sweepPresentationAtAngle(analysis, 2.2)!;
    const second = sweepPresentationAtAngle(analysis, 2.21)!;
    expect(first.source).toBe('interpolated');
    expect(second.source).toBe('interpolated');

    const rendered = render(<SectionFlowLab design={design} analysis={first.analysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    const firstGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    const firstIncidence = Number(firstGraphic.dataset.incidenceDeg);
    const firstOutline = firstGraphic.querySelector('.section-airfoil')!.getAttribute('points');
    const firstStreamline = firstGraphic.querySelector('.section-streamline')!.getAttribute('points');
    const firstPressure = rendered.container.querySelector('.cp-upper')!.getAttribute('points');

    rendered.rerender(<SectionFlowLab design={design} analysis={second.analysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    const secondGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    expect(Number(secondGraphic.dataset.incidenceDeg)).toBeGreaterThan(firstIncidence);
    expect(secondGraphic.querySelector('.section-airfoil')!.getAttribute('points')).not.toBe(firstOutline);
    expect(secondGraphic.querySelector('.section-streamline')!.getAttribute('points')).not.toBe(firstStreamline);
    expect(rendered.container.querySelector('.cp-upper')!.getAttribute('points')).not.toBe(firstPressure);
  });

  it('uses a lightweight flow field only while the AoA control is moving', () => {
    const { state, design, analysis } = fixture();
    const rendered = render(<SectionFlowLab design={design} analysis={analysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} interactive />);
    const previewGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    expect(previewGraphic.dataset.panelCount).toBe('40');
    expect(previewGraphic.dataset.streamlineCount).toBe('3');
    expect(rendered.container.querySelectorAll('.section-streamline')).toHaveLength(3);

    rendered.rerender(<SectionFlowLab design={design} analysis={analysis} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    const finalGraphic = rendered.container.querySelector<SVGElement>('svg[data-reference-frame="wind"]')!;
    expect(finalGraphic.dataset.panelCount).toBe('120');
    expect(finalGraphic.dataset.streamlineCount).toBe('17');
    expect(rendered.container.querySelectorAll('.section-streamline')).toHaveLength(17);
  });

  it('fails closed without a current converged analysis', () => {
    const { state, design } = fixture();
    render(<SectionFlowLab design={design} analysis={null} flightCase={state.flightCase} selectedEta={0.5} onSelectEta={() => undefined} />);
    expect(screen.getByText('A current converged wing analysis is required.')).toBeVisible();
    expect(screen.queryByRole('img', { name: /streamlines/i })).not.toBeInTheDocument();
  });
});
