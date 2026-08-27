export interface NacaDefinition { code: string; m: number; p: number; t: number }
export interface NacaCamberPoint { yc: number; slope: number }
export interface NacaSurfacePoint { xUpper: number; zUpper: number; xLower: number; zLower: number; yc: number; thickness: number }

export function parseNaca4(code: string): NacaDefinition {
  if (!/^\d{4}$/.test(code)) throw new Error('NACA code must contain exactly four digits.');
  const m = Number(code[0]) / 100;
  const p = Number(code[1]) / 10;
  const t = Number(code.slice(2)) / 100;
  if (m === 0 && p !== 0) throw new Error('Symmetric NACA sections require a zero camber-position digit.');
  if (m > 0 && (p <= 0 || p >= 1)) throw new Error('Cambered NACA sections require a valid camber position.');
  if (t < 0.06 || t > 0.24) throw new Error('NACA thickness must remain between 6% and 24%.');
  return { code, m, p, t };
}

export function nacaThickness(x: number, t: number) {
  const clamped = Math.max(0, Math.min(1, x));
  return 5 * t * (0.2969 * Math.sqrt(clamped) - 0.1260 * clamped - 0.3516 * clamped ** 2 + 0.2843 * clamped ** 3 - 0.1036 * clamped ** 4);
}

export function nacaCamber(x: number, definition: NacaDefinition): NacaCamberPoint {
  const clamped = Math.max(0, Math.min(1, x));
  const { m, p } = definition;
  if (m === 0) return { yc: 0, slope: 0 };
  if (clamped < p) return { yc: m / p ** 2 * (2 * p * clamped - clamped ** 2), slope: 2 * m / p ** 2 * (p - clamped) };
  return { yc: m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * clamped - clamped ** 2), slope: 2 * m / (1 - p) ** 2 * (p - clamped) };
}

export function nacaSurfacePoint(x: number, definition: NacaDefinition): NacaSurfacePoint {
  const { yc, slope } = nacaCamber(x, definition);
  const thickness = nacaThickness(x, definition.t);
  const theta = Math.atan(slope);
  return {
    xUpper: x - thickness * Math.sin(theta),
    zUpper: yc + thickness * Math.cos(theta),
    xLower: x + thickness * Math.sin(theta),
    zLower: yc - thickness * Math.cos(theta),
    yc,
    thickness,
  };
}

export function sampleNaca4(code: string, intervals = 80) {
  const definition = parseNaca4(code);
  return Array.from({ length: intervals + 1 }, (_, index) => {
    const x = 0.5 * (1 - Math.cos(Math.PI * index / intervals));
    return { x, ...nacaSurfacePoint(x, definition) };
  });
}

export function zeroLiftAngleRad(definition: NacaDefinition, intervals = 2048) {
  if (definition.m === 0) return 0;
  const count = intervals % 2 === 0 ? intervals : intervals + 1;
  const step = Math.PI / count;
  let sum = 0;
  for (let index = 0; index <= count; index += 1) {
    const phi = index * step;
    const x = 0.5 * (1 - Math.cos(phi));
    const integrand = nacaCamber(x, definition).slope * (1 - Math.cos(phi));
    const weight = index === 0 || index === count ? 1 : index % 2 === 0 ? 2 : 4;
    sum += weight * integrand;
  }
  return sum * step / (3 * Math.PI);
}
