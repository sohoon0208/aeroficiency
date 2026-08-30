import { describe, expect, it } from 'vitest';
import {
  nacaSectionContour,
  normalizeSectionContour,
  sampleSectionVelocityVectors,
  sectionPointToWindAxes,
  sectionVectorToWindAxes,
  solvePotentialFlowContour,
  solveSectionPotentialFlow,
  traceSectionStreamlines,
  windPointToSectionAxes,
  type Point2,
} from '@/lib/solver/panel2d';

function properIntersection(a: Point2, b: Point2, c: Point2, d: Point2) {
  const orientation = (first: Point2, second: Point2, third: Point2) =>
    (second.x - first.x) * (third.z - first.z) - (second.z - first.z) * (third.x - first.x);
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  return abC * abD < -1e-12 && cdA * cdB < -1e-12;
}

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
    expect(lines.reduce((sum, line) => sum + line.points.length, 0)).toBeLessThanOrEqual(17 * 420);
    expect(lines.every((line) => line.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.z)))).toBe(true);
    expect(lines.every((line) => Math.abs(line.points[0].x + 0.55) < 1e-12)).toBe(true);
    expect(vectors.length).toBeGreaterThan(10);
    expect(vectors.every(({ velocity }) => Number.isFinite(velocity.x) && Number.isFinite(velocity.z))).toBe(true);
  });

  it('maps the solution into wind axes with a horizontal freestream and visible section attitude', () => {
    for (const incidenceDeg of [-8, 0, 12]) {
      const incidenceRad = incidenceDeg * Math.PI / 180;
      const windVelocity = sectionVectorToWindAxes({ x: 50 * Math.cos(incidenceRad), z: 50 * Math.sin(incidenceRad) }, incidenceDeg);
      expect(windVelocity.x).toBeCloseTo(50, 12);
      expect(windVelocity.z).toBeCloseTo(0, 12);

      const leadingEdge = sectionPointToWindAxes({ x: 0, z: 0 }, incidenceDeg);
      const trailingEdge = sectionPointToWindAxes({ x: 1, z: 0 }, incidenceDeg);
      const recoveredLeadingEdge = windPointToSectionAxes(leadingEdge, incidenceDeg);
      expect(recoveredLeadingEdge.x).toBeCloseTo(0, 12);
      expect(recoveredLeadingEdge.z).toBeCloseTo(0, 12);
      if (incidenceDeg > 0) expect(leadingEdge.z).toBeGreaterThan(trailingEdge.z);
      if (incidenceDeg < 0) expect(leadingEdge.z).toBeLessThan(trailingEdge.z);
    }
  });

  it('keeps adaptively integrated wind-axis streamlines out of the solid section', () => {
    for (const incidenceDeg of [-8, 0, 12]) {
      const solution = solveSectionPotentialFlow('2412', incidenceDeg, 64, 80);
      const contourSegments = solution.panels.map((panel) => ({
        start: sectionPointToWindAxes(panel.start, incidenceDeg),
        end: sectionPointToWindAxes(panel.end, incidenceDeg),
      }));
      for (const line of traceSectionStreamlines(solution)) {
        for (let pointIndex = 1; pointIndex < line.points.length; pointIndex += 1) {
          const start = line.points[pointIndex - 1];
          const end = line.points[pointIndex];
          expect(contourSegments.some((panel) => properIntersection(start, end, panel.start, panel.end))).toBe(false);
        }
      }
    }
  });
});
