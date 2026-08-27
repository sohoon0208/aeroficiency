import { describe, expect, it } from 'vitest';
import { solveDense } from '@/lib/solver/math';
import { nacaCamber, nacaSurfacePoint, nacaThickness, parseNaca4, zeroLiftAngleRad } from '@/lib/solver/naca';
import { finiteVortexVelocity, semiInfiniteVortexVelocity, wakeOnlyVelocity } from '@/lib/solver/vortex';
import { meanAerodynamicChord, wingArea, wingAspectRatio } from '@/lib/solver/planform';

const close = (actual: number, expected: number, tolerance = 1e-11) => expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));

describe('solver foundations', () => {
  it('solves a pivoted dense linear system and rejects singular matrices', () => {
    const solved = solveDense([[3, 2, -1], [2, -2, 4], [-1, 0.5, -1]], [1, -2, 0]);
    expect(solved.solution).toEqual(expect.arrayContaining([expect.closeTo(1, 12), expect.closeTo(-2, 12), expect.closeTo(-2, 12)]));
    expect(() => solveDense([[1, 2], [2, 4]], [1, 2])).toThrow(/singular/i);
  });

  it('implements the closed-trailing-edge NACA four-digit equations', () => {
    const symmetric = parseNaca4('0012');
    const leadingEdge = nacaSurfacePoint(0, symmetric);
    expect(Object.values(leadingEdge).every(Number.isFinite)).toBe(true);
    close(leadingEdge.zUpper, -leadingEdge.zLower);
    close(nacaThickness(0.3, symmetric.t), 0.06000706039397028);
    close(nacaThickness(1, symmetric.t), 0, 2e-15);
    expect(nacaCamber(0.4, symmetric)).toEqual({ yc: 0, slope: 0 });

    const cambered = parseNaca4('2412');
    close(nacaCamber(0.4, cambered).yc, 0.02);
    close(nacaCamber(0.4, cambered).slope, 0);
    const surface = nacaSurfacePoint(0.4, cambered);
    close(surface.zUpper, 0.07799785247647903);
    close(surface.zLower, -0.03799785247647902);
    close(zeroLiftAngleRad(cambered), -0.0362546844206, 1e-8);
    for (const x of [0, 0.001, 0.05, 0.3, 0.7, 1]) {
      const point = nacaSurfacePoint(x, symmetric);
      expect(Object.values(point).every(Number.isFinite)).toBe(true);
      close(point.zUpper, -point.zLower);
    }
  });

  it('computes analytic trapezoidal-wing quantities', () => {
    const geometry = { spanM: 8, rootChordM: 1.4, tipChordM: 0.7, rootTwistDeg: 0, tipTwistDeg: -2, nacaCode: '2412' };
    close(wingArea(geometry), 8.4);
    close(meanAerodynamicChord(geometry), 1.088888888888889);
    close(wingAspectRatio(geometry), 7.619047619047619);
  });

  it('matches finite and semi-infinite vortex reference kernels', () => {
    const finite = finiteVortexVelocity([1, 0, 0], [0, -1, 0], [0, 1, 0]);
    close(finite[0], 0); close(finite[1], 0); close(finite[2], -Math.SQRT2 / (4 * Math.PI));
    const reversed = finiteVortexVelocity([1, 0, 0], [0, 1, 0], [0, -1, 0]);
    close(reversed[2], -finite[2]);
    const semi = semiInfiniteVortexVelocity([0, 1, 0], [0, 0, 0]);
    close(semi[2], 1 / (4 * Math.PI));
  });

  it('recovers the analytic induced drag of an elliptic wake independently of the VLM solve', () => {
    const panelCount = 128;
    const spanM = 10;
    const areaM2 = 10;
    const densityKgM3 = 1;
    const velocityMps = 1;
    const liftCoefficient = 0.5;
    const circulation0 = 1 / Math.PI;
    const coreM = 1e-6;
    const nodes = Array.from({ length: panelCount + 1 }, (_, index) => -spanM / 2 * Math.cos(Math.PI * index / panelCount));
    const strips = Array.from({ length: panelCount }, (_, index) => {
      const start = [0, nodes[index], 0] as const;
      const end = [0, nodes[index + 1], 0] as const;
      const yMidM = (start[1] + end[1]) / 2;
      return {
        start,
        end,
        yMidM,
        circulationM2s: circulation0 * Math.sqrt(1 - (2 * yMidM / spanM) ** 2),
      };
    });
    const discreteDragN = strips.reduce((total, strip) => {
      let downwashMps = 0;
      for (const source of strips) {
        downwashMps += wakeOnlyVelocity([0, strip.yMidM, 0], source.start, source.end, coreM)[2] * source.circulationM2s;
      }
      const widthM = strip.end[1] - strip.start[1];
      return total - densityKgM3 * strip.circulationM2s * downwashMps * widthM;
    }, 0);
    const dynamicPressurePa = 0.5 * densityKgM3 * velocityMps ** 2;
    const discreteCoefficient = discreteDragN / (dynamicPressurePa * areaM2);
    const aspectRatio = spanM ** 2 / areaM2;
    const analyticCoefficient = liftCoefficient ** 2 / (Math.PI * aspectRatio);
    const analyticDragN = analyticCoefficient * dynamicPressurePa * areaM2;

    close(discreteDragN, 0.03941069191010903, 1e-10);
    close(discreteCoefficient, 0.007882138382021805, 1e-10);
    close(analyticDragN, 0.039788735772973836, 1e-12);
    close(analyticCoefficient, 0.007957747154594767, 1e-12);
    expect(Math.abs(discreteDragN - analyticDragN) / analyticDragN).toBeLessThan(0.012);
  });
});
