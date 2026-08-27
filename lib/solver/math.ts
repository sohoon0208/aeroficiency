export type Vec3 = readonly [number, number, number];

export const add3 = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, scalar: number): Vec3 => [a[0] * scalar, a[1] * scalar, a[2] * scalar];
export const dot3 = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm3 = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const maxAbs = (values: ArrayLike<number>) => {
  let maximum = 0;
  for (let index = 0; index < values.length; index += 1) maximum = Math.max(maximum, Math.abs(values[index]));
  return maximum;
};

export class NumericalError extends Error {
  constructor(public readonly code: 'SINGULAR_SYSTEM' | 'RESIDUAL_TOO_LARGE' | 'NONFINITE_VALUE', message: string) {
    super(message);
    this.name = 'NumericalError';
  }
}

export interface LuFactorization {
  lu: number[][];
  pivots: number[];
  original: number[][];
  normInf: number;
}

export function factorDense(matrix: readonly (readonly number[])[]): LuFactorization {
  const size = matrix.length;
  if (!size || matrix.some((row) => row.length !== size)) throw new NumericalError('SINGULAR_SYSTEM', 'Dense matrix must be non-empty and square.');
  const lu = matrix.map((row) => row.map(Number));
  if (lu.some((row) => row.some((value) => !Number.isFinite(value)))) throw new NumericalError('NONFINITE_VALUE', 'Dense matrix contains a non-finite value.');
  const original = lu.map((row) => [...row]);
  const scales = lu.map((row) => Math.max(...row.map(Math.abs)));
  const normInf = Math.max(...lu.map((row) => row.reduce((sum, value) => sum + Math.abs(value), 0)));
  const pivots = Array.from({ length: size }, (_, index) => index);
  if (!Number.isFinite(normInf) || normInf === 0 || scales.some((scale) => scale === 0)) throw new NumericalError('SINGULAR_SYSTEM', 'Dense system has a zero row.');

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column;
    let pivotScore = -1;
    for (let row = column; row < size; row += 1) {
      const score = Math.abs(lu[row][column]) / scales[row];
      if (score > pivotScore) { pivotScore = score; pivotRow = row; }
    }
    if (Math.abs(lu[pivotRow][column]) <= 1e-12 * normInf) throw new NumericalError('SINGULAR_SYSTEM', `Dense system pivot ${column} is singular or ill-conditioned.`);
    if (pivotRow !== column) {
      [lu[pivotRow], lu[column]] = [lu[column], lu[pivotRow]];
      [scales[pivotRow], scales[column]] = [scales[column], scales[pivotRow]];
      [pivots[pivotRow], pivots[column]] = [pivots[column], pivots[pivotRow]];
    }
    for (let row = column + 1; row < size; row += 1) {
      lu[row][column] /= lu[column][column];
      for (let next = column + 1; next < size; next += 1) lu[row][next] -= lu[row][column] * lu[column][next];
    }
  }
  return { lu, pivots, original, normInf };
}

export function solveFactored(factor: LuFactorization, rightHandSide: ArrayLike<number>) {
  const size = factor.lu.length;
  if (rightHandSide.length !== size) throw new NumericalError('SINGULAR_SYSTEM', 'Right-hand side length does not match the matrix.');
  const solution = factor.pivots.map((originalRow) => Number(rightHandSide[originalRow]));
  if (solution.some((value) => !Number.isFinite(value))) throw new NumericalError('NONFINITE_VALUE', 'Right-hand side contains a non-finite value.');
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < row; column += 1) solution[row] -= factor.lu[row][column] * solution[column];
  }
  for (let row = size - 1; row >= 0; row -= 1) {
    for (let column = row + 1; column < size; column += 1) solution[row] -= factor.lu[row][column] * solution[column];
    solution[row] /= factor.lu[row][row];
  }
  const bNorm = maxAbs(rightHandSide);
  const xNorm = maxAbs(solution);
  let residual = 0;
  for (let row = 0; row < size; row += 1) {
    let value = -Number(rightHandSide[row]);
    for (let column = 0; column < size; column += 1) value += factor.original[row][column] * solution[column];
    residual = Math.max(residual, Math.abs(value));
  }
  const relativeResidual = residual / Math.max(factor.normInf * xNorm + bNorm, Number.EPSILON);
  if (!Number.isFinite(relativeResidual) || relativeResidual > 1e-9) throw new NumericalError('RESIDUAL_TOO_LARGE', `Dense solve relative residual ${relativeResidual} exceeds tolerance.`);
  return { solution, relativeResidual };
}

export function solveDense(matrix: readonly (readonly number[])[], rightHandSide: ArrayLike<number>) {
  return solveFactored(factorDense(matrix), rightHandSide);
}

export function interpolateLinear(x: number, xs: ArrayLike<number>, ys: ArrayLike<number>) {
  if (xs.length !== ys.length || xs.length === 0) throw new Error('Interpolation arrays must have equal non-zero length.');
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let high = 1;
  while (high < xs.length && xs[high] < x) high += 1;
  const low = high - 1;
  const fraction = (x - xs[low]) / (xs[high] - xs[low]);
  return ys[low] + fraction * (ys[high] - ys[low]);
}

export const radians = (degrees: number) => degrees * Math.PI / 180;
export const degrees = (radiansValue: number) => radiansValue * 180 / Math.PI;
