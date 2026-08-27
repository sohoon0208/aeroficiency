import { describe, expect, it } from 'vitest';
import { computeThinWallSection, recoverWallStress } from '@/lib/solver/wingBox';

describe('closed thin-wall wing box', () => {
  it('matches a rectangular analytical fixture', () => {
    const material = {
      key: 'aluminum_2024_t3' as const,
      label: 'Fixture aluminum',
      densityKgM3: 2_700,
      youngsModulusPa: 70e9,
      poissonRatio: 0.33,
      shearModulusPa: 70e9 / 2.66,
      yieldStrengthPa: 250e6,
    };
    const section = computeThinWallSection(
      [{ xM: 0, zM: 0.1 }, { xM: 1, zM: 0.1 }, { xM: 1, zM: -0.1 }, { xM: 0, zM: -0.1 }],
      [0.01, 0.01, 0.01, 0.01],
      material,
    );
    expect(section.areaM2).toBeCloseTo(0.024, 14);
    expect(section.centroidXM).toBeCloseTo(0.5, 14);
    expect(section.centroidZM).toBeCloseTo(0, 14);
    expect(section.bendingInertiaM4).toBeCloseTo(0.00021333333333333333, 14);
    expect(section.enclosedAreaM2).toBeCloseTo(0.2, 14);
    expect(section.torsionConstantM4).toBeCloseTo(0.0006666666666666666, 14);
    expect(section.massPerLengthKgM).toBeCloseTo(64.8, 12);

    const stress = recoverWallStress(section, 10_000, 1_000);
    expect(stress.maxBendingStressPa).toBeCloseTo(4_687_500, 6);
    expect(stress.maxTorsionalShearPa).toBeCloseTo(250_000, 6);
    expect(stress.maxVonMisesPa).toBeCloseTo(4_707_457.514412637, 6);
    expect(stress.yieldMargin).toBeCloseTo(53.107223853764985, 8);
  });

  it('keeps zero-load output JSON-safe and rejects nonfinite actions', () => {
    const section = computeThinWallSection(
      [{ xM: 0, zM: 0.1 }, { xM: 1, zM: 0.1 }, { xM: 1, zM: -0.1 }, { xM: 0, zM: -0.1 }],
      [0.01, 0.01, 0.01, 0.01],
    );
    const stress = recoverWallStress(section, 0, 0);
    expect(stress.yieldMargin).toBeNull();
    expect(JSON.parse(JSON.stringify(stress)).yieldMargin).toBeNull();
    expect(() => recoverWallStress(section, Number.NaN, 0)).toThrow(/finite/);
    expect(() => recoverWallStress(section, 0, Number.POSITIVE_INFINITY)).toThrow(/finite/);
  });
});
