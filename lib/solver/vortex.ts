import { cross3, dot3, norm3, scale3, sub3, type Vec3 } from './math';

const FOUR_PI = 4 * Math.PI;

export function finiteVortexVelocity(point: Vec3, start: Vec3, end: Vec3, coreM = 0): Vec3 {
  const r1 = sub3(point, start);
  const r2 = sub3(point, end);
  const r0 = sub3(end, start);
  const cross = cross3(r1, r2);
  const r1Norm = norm3(r1);
  const r2Norm = norm3(r2);
  const r0Norm = norm3(r0);
  if (r1Norm === 0 || r2Norm === 0 || r0Norm === 0) return [0, 0, 0];
  const denominator = dot3(cross, cross) + coreM ** 2 * r0Norm ** 2;
  if (denominator <= Number.EPSILON) return [0, 0, 0];
  const factor = dot3(r0, sub3(scale3(r1, 1 / r1Norm), scale3(r2, 1 / r2Norm))) / (FOUR_PI * denominator);
  return scale3(cross, factor);
}

export function semiInfiniteVortexVelocity(point: Vec3, start: Vec3, direction: Vec3 = [1, 0, 0], coreM = 0): Vec3 {
  const directionNorm = norm3(direction);
  if (directionNorm === 0) return [0, 0, 0];
  const unit = scale3(direction, 1 / directionNorm);
  const r = sub3(point, start);
  const rNorm = norm3(r);
  if (rNorm === 0) return [0, 0, 0];
  const cross = cross3(unit, r);
  const hSquared = dot3(cross, cross);
  const factor = (1 + dot3(unit, r) / rNorm) / (FOUR_PI * (hSquared + coreM ** 2));
  return scale3(cross, factor);
}

export function horseshoeVelocity(point: Vec3, start: Vec3, end: Vec3, coreM = 0): Vec3 {
  const bound = finiteVortexVelocity(point, start, end, coreM);
  const leftWake = semiInfiniteVortexVelocity(point, start, [1, 0, 0], coreM);
  const rightWake = semiInfiniteVortexVelocity(point, end, [1, 0, 0], coreM);
  return [bound[0] - leftWake[0] + rightWake[0], bound[1] - leftWake[1] + rightWake[1], bound[2] - leftWake[2] + rightWake[2]];
}

export function wakeOnlyVelocity(point: Vec3, start: Vec3, end: Vec3, coreM = 0): Vec3 {
  const leftWake = semiInfiniteVortexVelocity(point, start, [1, 0, 0], coreM);
  const rightWake = semiInfiniteVortexVelocity(point, end, [1, 0, 0], coreM);
  return [-leftWake[0] + rightWake[0], -leftWake[1] + rightWake[1], -leftWake[2] + rightWake[2]];
}
