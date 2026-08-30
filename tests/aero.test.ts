import { describe, expect, it } from 'vitest';
import type { FlightCase, WingGeometry } from '@/lib/domain/types';
import { AeroError, solveTargetLiftAerodynamics } from '@/lib/solver/aero';

const expectClose = (actual: number, expected: number, tolerance = 1e-10) => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance * Math.max(1, Math.abs(expected)));
};

const relativeChange = (coarse: number, fine: number) => Math.abs(fine - coarse) / Math.abs(fine);

describe('target-lift horseshoe-vortex solver', () => {
  const geometry: WingGeometry = {
    spanM: 8, rootChordM: 1, tipChordM: 1, rootTwistDeg: 0, tipTwistDeg: 0, nacaCode: '0012',
    airfoilStations: [
      { id: 'afs_root', eta: 0, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'LINEAR_CAMBER_THICKNESS' },
      { id: 'afs_tip', eta: 1, airfoil: { kind: 'NACA4', code: '0012' }, blendToNext: 'HOLD' },
    ],
    polarModel: { kind: 'ANALYTIC_ATTACHED', tables: [] },
  };
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
    expect(result.alphaRad).toBeCloseTo(0.130472830788727, 10);
    expect(result.inducedDragCoefficient).toBeGreaterThan(0);
    expect(result.profileDragCoefficient).toBeGreaterThan(0);
    expect(result.combinedDragCoefficient).toBeCloseTo(result.inducedDragCoefficient + result.profileDragCoefficient, 12);
    expect(result.symmetryError).toBeLessThan(1e-8);
    expect(result.relativeResidual).toBeLessThan(2e-7);
  });

  it('preserves the target-lift state while the analytic profile estimate responds to Reynolds number', () => {
    const factor = 0.8;
    const first = solveTargetLiftAerodynamics(geometry, flightCase, twistField, 32);
    const second = solveTargetLiftAerodynamics(geometry, {
      ...flightCase,
      airDensityKgM3: flightCase.airDensityKgM3 * factor,
      targetLiftN: flightCase.targetLiftN * factor,
    }, twistField, 32);
    expect(Math.abs(second.liftCoefficient - first.liftCoefficient)).toBeLessThan(2e-7);
    expect(Math.abs(second.inducedDragCoefficient - first.inducedDragCoefficient)).toBeLessThan(2e-6);
    expect(Math.abs(second.alphaRad - first.alphaRad)).toBeLessThan(2e-5);
    expect(second.liftN / first.liftN).toBeCloseTo(factor, 6);
    expect(second.inducedDragN / first.inducedDragN).toBeCloseTo(factor, 4);
    expect(second.profileDragCoefficient).toBeGreaterThan(first.profileDragCoefficient);
  });

  it('matches the exact N=16/32/64 deterministic fixtures and truthful mesh gates', () => {
    const fixtures = [
      {
        panelCount: 16,
        alphaRad: 0.12919397251089254,
        liftN: 4999.999829002125,
        liftCoefficient: 0.6377550802298628,
        inducedDragN: 126.41175918501784,
        inducedDragCoefficient: 0.01612394887564003,
        profileDragN: 96.78396416228483,
        profileDragCoefficient: 0.012344893388046533,
        combinedDragN: 223.19572334730267,
        combinedDragCoefficient: 0.028468842263686563,
        estimatedLiftToDrag: 22.40186215943707,
        spanEfficiencyEstimate: 1.003683030396233,
        targetLiftError: -3.4199575020466e-8,
        trimIterations: 21,
        polarIterations: 3,
        polarResidual: 2.5792942874624576e-9,
      },
      {
        panelCount: 32,
        alphaRad: 0.130472830788727,
        liftN: 5000.0000450444,
        liftCoefficient: 0.6377551077862755,
        inducedDragN: 130.36744124833672,
        inducedDragCoefficient: 0.01662850015922662,
        profileDragN: 96.89415665539848,
        profileDragCoefficient: 0.012358948552984498,
        combinedDragN: 227.2615979037352,
        combinedDragCoefficient: 0.02898744871221112,
        estimatedLiftToDrag: 22.00107757388175,
        spanEfficiencyEstimate: 0.9732288007340514,
        targetLiftError: 9.008880078908987e-9,
        trimIterations: 23,
        polarIterations: 3,
        polarResidual: 1.2821143371949573e-8,
      },
      {
        panelCount: 64,
        alphaRad: 0.13116333852511408,
        liftN: 5000.000159991579,
        liftCoefficient: 0.6377551224479053,
        inducedDragN: 132.35360599931536,
        inducedDragCoefficient: 0.01688183749991267,
        profileDragN: 96.96234017999926,
        profileDragCoefficient: 0.012367645431122353,
        combinedDragN: 229.3159461793146,
        combinedDragCoefficient: 0.029249482931035024,
        estimatedLiftToDrag: 21.803979371246196,
        spanEfficiencyEstimate: 0.9586240841463679,
        targetLiftError: 3.199831571691902e-8,
        trimIterations: 23,
        polarIterations: 3,
        polarResidual: 2.622306900276323e-8,
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
      expectClose(result.profileDragN, fixture.profileDragN);
      expectClose(result.profileDragCoefficient, fixture.profileDragCoefficient);
      expectClose(result.combinedDragN, fixture.combinedDragN);
      expectClose(result.combinedDragCoefficient, fixture.combinedDragCoefficient);
      expectClose(result.estimatedLiftToDrag, fixture.estimatedLiftToDrag);
      expectClose(result.spanEfficiencyEstimate!, fixture.spanEfficiencyEstimate);
      expectClose(result.targetLiftError, fixture.targetLiftError);
      expect(result.polarIterations).toBe(fixture.polarIterations);
      expectClose(result.polarResidual, fixture.polarResidual);
      expect(result.relativeResidual).toBeLessThan(2e-7);
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
