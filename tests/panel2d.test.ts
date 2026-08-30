import { describe, expect, it } from 'vitest';
import {
  nacaSectionContour,
  normalizeSectionContour,
  sampleSectionVelocityVectors,
  solvePotentialFlowContour,
  solveSectionPotentialFlow,
  traceSectionStreamlines,
} from '@/lib/solver/panel2d';

describe('two-dimensional section potential-flow solver', () => {
  it('recovers symmetric zero-incidence flow for NACA 0012', () => {
    const solution = solveSectionPotentialFlow('0012', 0, 50, 80);
    expect(solution.liftCoefficient).toBeCloseTo(0, 6);
    expect(Math.abs(solution.kuttaResidualMps)).toBeLessThan(1e-8);
    expect(Math.abs(solution.sourceFluxResidualM2ps) / solution.freeStreamMps).toBeLessThan(0.005);
    const lower = solution.surface.filter((point) => point.surface === 'lower').sort((a, b) => a.xOverC - b.xOverC);
    const upper = solution.surface.filter((point) => point.surface === 'upper').sort((a, b) => a.xOverC - b.xOverC);
    expect(lower).toHaveLength(upper.length);
    expect(Math.max(...lower.map((point, index) => Math.abs(point.cp - upper[index].cp)))).toBeLessThan(1e-7);
  });

  it('produces positive small-angle lift consistent with thin-airfoil theory', () => {
    const incidenceDeg = 4;
    const solution = solveSectionPotentialFlow('0012', incidenceDeg, 50, 120);
    const thinAirfoil = 2 * Math.PI * incidenceDeg * Math.PI / 180;
    expect(solution.liftCoefficient).toBeGreaterThan(0);
    expect(Math.abs(solution.liftCoefficient - thinAirfoil) / thinAirfoil).toBeLessThan(0.18);
    expect(Math.abs(solution.kuttaResidualMps)).toBeLessThan(1e-8);
    expect(Math.abs(solution.dragCoefficientNumerical)).toBeLessThan(0.02);
  });

  it('converges under panel refinement and remains finite near all collocation points', () => {
    const low = solveSectionPotentialFlow('2412', 3, 50, 40);
    const medium = solveSectionPotentialFlow('2412', 3, 50, 80);
    const high = solveSectionPotentialFlow('2412', 3, 50, 160);
    expect(Math.abs(high.liftCoefficient - medium.liftCoefficient)).toBeLessThan(Math.abs(medium.liftCoefficient - low.liftCoefficient));
    for (const solution of [low, medium, high]) {
      expect(solution.surface.every((point) => Number.isFinite(point.cp) && Number.isFinite(point.tangentialVelocityRatio))).toBe(true);
    }
  });

  it('normalizes reversed point order to the same physical solution', () => {
    const { points } = nacaSectionContour('0012', 80);
    const forward = solvePotentialFlowContour(points, 4, 50);
    const reversed = solvePotentialFlowContour([...points].reverse(), 4, 50);
    expect(reversed.liftCoefficient).toBeCloseTo(forward.liftCoefficient, 9);
    expect(reversed.momentCoefficientQuarterChord).toBeCloseTo(forward.momentCoefficientQuarterChord, 9);
    expect(normalizeSectionContour([...points].reverse())).toHaveLength(points.length);
  });

  it('generates bounded finite section streamlines and velocity vectors', () => {
    const solution = solveSectionPotentialFlow('2412', 4, 64, 80);
    const lines = traceSectionStreamlines(solution);
    const vectors = sampleSectionVelocityVectors(solution);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.reduce((sum, line) => sum + line.points.length, 0)).toBeLessThanOrEqual(17 * 260);
    expect(lines.every((line) => line.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z)))).toBe(true);
    expect(vectors.length).toBeGreaterThan(10);
    expect(vectors.every(({ velocity }) => Number.isFinite(velocity.x) && Number.isFinite(velocity.z))).toBe(true);
  });
});
