import { describe, expect, it } from 'vitest';
import type { FlightCase, WingGeometry } from '@/lib/domain/types';
import { AeroError, solveTargetLiftAerodynamics } from '@/lib/solver/aero';

const expectClose = (actual: number, expected: number, tolerance = 1e-10) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
};

const relativeChange = (coarse: number, fine: number) => Math.abs(fine - coarse) / Math.abs(fine);

describe('target-lift horseshoe-vortex solver', () => {
  const geometry: WingGeometry = { spanM: 8, rootChordM: 1, tipChordM: 1, rootTwistDeg: 0, tipTwistDeg: 0, nacaCode: '0012' };
  const flightCase: FlightCase = {
    revision: 1,
    mode: 'target_lift',
    targetLiftN: 5_000,
    velocityMps: 40,
    altitudeM: 0,
    airDensityKgM3: 1.225,
    dynamicViscosityPaS: 1.7894e-5,
  };
  const twistField = { eta: [0, 1], twistRad: [0, 0] } as const;

  it('trims to target lift with symmetric circulation and positive induced drag', () => {
    const result = solveTargetLiftAerodynamics(geometry, flightCase, twistField, 32);
    expect(result.liftN).toBeCloseTo(5_000, 1);
    expect(result.alphaRad).toBeCloseTo(0.13801209419311927, 8);
    expect(result.inducedDragCoefficient).toBeGreaterThan(0);
    expect(result.symmetryError).toBeLessThan(1e-8);
    expect(result.relativeResidual).toBeLessThan(1e-9);
  });

  it('preserves coefficients when density and target lift scale together within the supported atmosphere', () => {
    const factor = 0.8;
    const first = solveTargetLiftAerodynamics(geometry, flightCase, twistField, 32);
    const second = solveTargetLiftAerodynamics(geometry, {
      ...flightCase,
      airDensityKgM3: flightCase.airDensityKgM3 * factor,
      targetLiftN: flightCase.targetLiftN * factor,
    }, twistField, 32);
    expect(second.liftCoefficient).toBeCloseTo(first.liftCoefficient, 10);
    expect(second.inducedDragCoefficient).toBeCloseTo(first.inducedDragCoefficient, 10);
    expect(second.alphaRad).toBeCloseTo(first.alphaRad, 10);
    expect(second.liftN / first.liftN).toBeCloseTo(factor, 10);
    expect(second.inducedDragN / first.inducedDragN).toBeCloseTo(factor, 10);
  });

  it('matches the exact N=16/32/64 deterministic fixtures and truthful mesh gates', () => {
    const fixtures = [
      {
        panelCount: 16,
        alphaRad: 0.13592134628983887,
        liftN: 4999.999862987434,
        liftCoefficient: 0.6377550845647237,
        inducedDragN: 121.28057784719616,
        inducedDragCoefficient: 0.01546946146010155,
        spanEfficiencyEstimate: 1.046147219228945,
        targetLiftError: -2.740251311479369e-8,
        trimIterations: 24,
      },
      {
        panelCount: 32,
        alphaRad: 0.13801209419311927,
        liftN: 4999.999973409036,
        liftCoefficient: 0.6377550986491117,
        inducedDragN: 125.02434889232238,
        inducedDragCoefficient: 0.015946983277081935,
        spanEfficiencyEstimate: 1.0148210807688123,
        targetLiftError: -5.3181927796686064e-9,
        trimIterations: 24,
      },
      {
        panelCount: 64,
        alphaRad: 0.1391451027893798,
        liftN: 5000.0002117775075,
        liftCoefficient: 0.6377551290532535,
        inducedDragN: 126.96203439884137,
        inducedDragCoefficient: 0.01619413704066854,
        spanEfficiencyEstimate: 0.9993330491552473,
        targetLiftError: 4.2355501500424e-8,
        trimIterations: 24,
      },
    ] as const;

    const results = fixtures.map((fixture) => {
      const result = solveTargetLiftAerodynamics(geometry, flightCase, twistField, fixture.panelCount);
      expect(result.panelCount).toBe(fixture.panelCount);
      expect(result.trimIterations).toBe(fixture.trimIterations);
      expectClose(result.alphaRad, fixture.alphaRad);
      expectClose(result.liftN, fixture.liftN);
      expectClose(result.liftCoefficient, fixture.liftCoefficient);
      expectClose(result.inducedDragN, fixture.inducedDragN);
      expectClose(result.inducedDragCoefficient, fixture.inducedDragCoefficient);
      expectClose(result.spanEfficiencyEstimate!, fixture.spanEfficiencyEstimate);
      expectClose(result.targetLiftError, fixture.targetLiftError);
      expect(result.relativeResidual).toBeLessThan(1e-12);
      expect(result.symmetryError).toBeLessThan(1e-12);
      expectClose(result.strips.reduce((sum, strip) => sum + strip.liftN, 0), result.liftN, 1e-12);
      expectClose(result.strips.reduce((sum, strip) => sum + strip.inducedDragN, 0), result.inducedDragN, 1e-12);
      return result;
    });

    expect(relativeChange(results[0].inducedDragCoefficient, results[1].inducedDragCoefficient)).toBeLessThan(0.035);
    expect(relativeChange(results[1].alphaRad, results[2].alphaRad)).toBeLessThan(0.01);
    expect(relativeChange(results[1].inducedDragCoefficient, results[2].inducedDragCoefficient)).toBeLessThan(0.02);
  });

  it('rejects negative speed and corrupt geometry at the public solver boundary', () => {
    const cases: Array<{ name: string; geometry: WingGeometry; flightCase: FlightCase }> = [
      { name: 'negative speed', geometry, flightCase: { ...flightCase, velocityMps: -40 } },
      { name: 'negative span', geometry: { ...geometry, spanM: -8 }, flightCase },
      { name: 'nonfinite twist', geometry: { ...geometry, tipTwistDeg: Number.NaN }, flightCase },
      { name: 'unsupported NACA code', geometry: { ...geometry, nacaCode: '9912' }, flightCase },
    ];

    for (const testCase of cases) {
      let thrown: unknown;
      try {
        solveTargetLiftAerodynamics(testCase.geometry, testCase.flightCase, twistField, 32);
      } catch (error) {
        thrown = error;
      }
      expect.soft(thrown, testCase.name).toBeInstanceOf(AeroError);
      expect.soft((thrown as AeroError | undefined)?.code, testCase.name).toBe('INVALID_INPUT');
    }
  });

  it('moves load inboard with geometric washout and lowers induced drag at higher aspect ratio', () => {
    const untwisted = solveTargetLiftAerodynamics(geometry, flightCase, twistField, 32);
    const washedOut = solveTargetLiftAerodynamics({ ...geometry, tipTwistDeg: -4 }, flightCase, twistField, 32);
    const outerLiftFraction = (result: typeof untwisted) => {
      const positive = result.strips.filter((strip) => strip.yStartM >= -1e-12);
      return positive.filter((strip) => strip.etaMid >= 0.5).reduce((sum, strip) => sum + strip.liftN, 0)
        / positive.reduce((sum, strip) => sum + strip.liftN, 0);
    };
    expect(outerLiftFraction(washedOut)).toBeLessThan(outerLiftFraction(untwisted));

    const lowAspectGeometry: WingGeometry = { ...geometry, spanM: 6, rootChordM: 4 / 3, tipChordM: 4 / 3 };
    const highAspectGeometry: WingGeometry = { ...geometry, spanM: 10, rootChordM: 0.8, tipChordM: 0.8 };
    const lowAspect = solveTargetLiftAerodynamics(lowAspectGeometry, flightCase, twistField, 32);
    const highAspect = solveTargetLiftAerodynamics(highAspectGeometry, flightCase, twistField, 32);
    expect(highAspect.inducedDragCoefficient).toBeLessThan(lowAspect.inducedDragCoefficient);
    expect(highAspect.inducedDragN).toBeLessThan(lowAspect.inducedDragN);
  });
});
