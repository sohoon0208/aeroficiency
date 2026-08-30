// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AngleSweepScrubber } from '@/components/flow/AngleSweepExplorer';
import { analysisAtSweepPoint, sweepPointAtAngle } from '@/lib/domain/angleSweep';
import { createDefaultProject } from '@/lib/domain/defaults';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { deriveSectionCondition } from '@/lib/visualization/sectionFlow';

afterEach(() => cleanup());

function fixture() {
  const state = createDefaultProject();
  const design = state.designs[state.activeDesignId];
  const analysis = buildAnalysisSnapshot(state, design, 'fast');
  return { state, design, analysis };
}

describe('interactive angle-of-attack sweep', () => {
  it('stores an exact bounded coupled point matrix with internally consistent force and drag identities', () => {
    const { analysis } = fixture();
    expect(analysis.angleSweep.points).toHaveLength(29);
    expect(analysis.angleSweep.points[0].alphaDeg).toBe(-4);
    expect(analysis.angleSweep.points.at(-1)!.alphaDeg).toBe(10);
    expect(analysis.angleSweep.points.every((point) => point.status === 'converged')).toBe(true);
    analysis.angleSweep.points.forEach((point) => {
      expect(point.metrics.trimmedAlphaDeg).toBe(point.alphaDeg);
      expect(point.metrics.combinedWingDragEstimateN).toBeCloseTo(point.metrics.inducedDragN + point.metrics.profileDragEstimateN, 9);
      expect(point.metrics.inducedDragCoefficientEstimate).not.toBeNull();
      expect(point.metrics.combinedDragCoefficientEstimate).toBeCloseTo((point.metrics.inducedDragCoefficientEstimate ?? 0) + point.metrics.profileDragCoefficientEstimate, 9);
      expect(point.metrics.combinedDragCoefficientEstimate).toBeGreaterThan(0);
      expect(point.stations.every((station) => Number.isFinite(station.liftPerSpanNpm) && Number.isFinite(station.deflectionM))).toBe(true);
    });
    expect(sweepPointAtAngle(analysis, -4)!.metrics.liftCoefficient).toBeLessThan(sweepPointAtAngle(analysis, 4)!.metrics.liftCoefficient);
    expect(analysis.angleSweep.bestLiftToDragAlphaDeg).not.toBeNull();
  });

  it('uses a selected immutable point for the 3D, metric, and 2D-condition views without changing the official trim snapshot', () => {
    const { state, design, analysis } = fixture();
    const officialAlpha = analysis.metrics.trimmedAlphaDeg;
    const point = sweepPointAtAngle(analysis, 2)!;
    const selected = analysisAtSweepPoint(analysis, point);
    const condition = deriveSectionCondition(design, selected, state.flightCase, 0.5);
    expect(selected.analysisId).toBe(analysis.analysisId);
    expect(selected.inputFingerprint).toBe(analysis.inputFingerprint);
    expect(selected.metrics.trimmedAlphaDeg).toBe(2);
    expect(condition.wingAngleOfAttackDeg).toBe(2);
    expect(analysis.metrics.trimmedAlphaDeg).toBe(officialAlpha);
  });

  it('renders the configured range and emits the exact selected AoA', () => {
    const { analysis } = fixture();
    const point = sweepPointAtAngle(analysis, null)!;
    const onSelect = vi.fn();
    render(<AngleSweepScrubber analysis={analysis} point={point} onSelect={onSelect} />);
    const slider = screen.getByRole('slider', { name: 'Selected angle of attack' });
    expect(slider).toHaveAttribute('min', '-4');
    expect(slider).toHaveAttribute('max', '10');
    expect(slider).toHaveAttribute('step', '0.5');
    expect(screen.getByText('29/29 solved')).toBeVisible();
    expect(screen.getByText(/Official candidate checks remain tied/)).toBeVisible();
    fireEvent.input(slider, { target: { value: '-2.5' } });
    expect(onSelect).toHaveBeenCalledWith(-2.5);
    fireEvent.change(slider, { target: { value: '3.5' } });
    expect(onSelect).toHaveBeenCalledWith(3.5);
  });
});
