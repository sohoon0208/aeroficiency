import type { WingDesign } from '@/lib/domain/types';
import type { AeroResult, AeroStripResult } from './aero';
import { solveDense } from './math';
import { chordAtY } from './planform';
import { expectedStructuralMassKg, recoverWallStress, wingBoxAtY, type WallStressResult } from './wingBox';

const GAUSS_POINTS = [
  { r: 0.5 * (1 - Math.sqrt(3 / 5)), weight: 5 / 18 },
  { r: 0.5, weight: 4 / 9 },
  { r: 0.5 * (1 + Math.sqrt(3 / 5)), weight: 5 / 18 },
] as const;

export interface CantileverBendingResult {
  deflectionM: number[];
  slopeRad: number[];
  relativeResidual: number;
}

export interface CantileverTorsionResult {
  twistRad: number[];
  relativeResidual: number;
}

export interface InternalAction {
  shearN: number;
  bendingMomentNm: number;
  torqueNm: number;
}

export interface StructuralNodeResult extends InternalAction {
  yM: number;
  eta: number;
  chordM: number;
  deflectionM: number;
  slopeRad: number;
  elasticTwistRad: number;
  bendingStiffnessNm2: number;
  torsionalStiffnessNm2: number;
  massPerLengthKgM: number;
  stress: WallStressResult;
}

export interface StructuralResult {
  nodes: StructuralNodeResult[];
  structuralMassKg: number;
  tipDeflectionM: number;
  tipElasticTwistRad: number;
  maxElasticTwistRad: number;
  rootShearN: number;
  rootBendingMomentNm: number;
  rootTorqueNm: number;
  minimumYieldMargin: number;
  maxBendingStressPa: number;
  maxTorsionalShearPa: number;
  maxVonMisesPa: number;
  bendingRelativeResidual: number;
  torsionRelativeResidual: number;
}

function validateMesh(nodesM: readonly number[], elementValues: readonly number[]) {
  if (nodesM.length < 2 || elementValues.length !== nodesM.length - 1) throw new Error('Cantilever mesh and element arrays do not match.');
  if (nodesM.some((value) => !Number.isFinite(value)) || elementValues.some((value) => !Number.isFinite(value))) throw new Error('Cantilever inputs must be finite.');
  for (let index = 1; index < nodesM.length; index += 1) {
    if (!(nodesM[index] > nodesM[index - 1])) throw new Error('Cantilever nodes must increase strictly from root to tip.');
  }
}

function reducedSolve(matrix: number[][], load: number[], fixedDofs: readonly number[]) {
  const fixed = new Set(fixedDofs);
  const free = matrix.map((_, index) => index).filter((index) => !fixed.has(index));
  const reducedMatrix = free.map((row) => free.map((column) => matrix[row][column]));
  const reducedLoad = free.map((row) => load[row]);
  const solved = solveDense(reducedMatrix, reducedLoad);
  const full = Array(matrix.length).fill(0);
  free.forEach((dof, index) => { full[dof] = solved.solution[index]; });
  return { solution: full, relativeResidual: solved.relativeResidual };
}

export function solveCantileverBending(
  nodesM: readonly number[],
  bendingStiffnessAtY: (yM: number) => number,
  elementLoadNpm: readonly number[],
  tipForceN = 0,
  signal?: AbortSignal,
): CantileverBendingResult {
  validateMesh(nodesM, elementLoadNpm);
  const dofCount = nodesM.length * 2;
  const stiffness = Array.from({ length: dofCount }, () => Array(dofCount).fill(0));
  const load = Array(dofCount).fill(0);

  for (let element = 0; element < nodesM.length - 1; element += 1) {
    if (signal?.aborted) throw new Error('Structural solve was aborted.');
    const start = nodesM[element];
    const length = nodesM[element + 1] - start;
    const local = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (const { r, weight } of GAUSS_POINTS) {
      const yM = start + r * length;
      const ei = bendingStiffnessAtY(yM);
      if (!Number.isFinite(ei) || ei <= 0) throw new Error('Bending stiffness must be finite and positive.');
      const curvature = [
        (-6 + 12 * r) / length ** 2,
        (-4 + 6 * r) / length,
        (6 - 12 * r) / length ** 2,
        (-2 + 6 * r) / length,
      ];
      for (let row = 0; row < 4; row += 1) {
        for (let column = 0; column < 4; column += 1) local[row][column] += ei * curvature[row] * curvature[column] * length * weight;
      }
    }
    const dofs = [2 * element, 2 * element + 1, 2 * element + 2, 2 * element + 3];
    dofs.forEach((row, localRow) => dofs.forEach((column, localColumn) => { stiffness[row][column] += local[localRow][localColumn]; }));
    const distributed = elementLoadNpm[element];
    const localLoad = [distributed * length / 2, distributed * length ** 2 / 12, distributed * length / 2, -distributed * length ** 2 / 12];
    dofs.forEach((dof, index) => { load[dof] += localLoad[index]; });
  }
  load[dofCount - 2] += tipForceN;
  if (signal?.aborted) throw new Error('Structural solve was aborted.');
  const solved = reducedSolve(stiffness, load, [0, 1]);
  return {
    deflectionM: nodesM.map((_, index) => solved.solution[2 * index]),
    slopeRad: nodesM.map((_, index) => solved.solution[2 * index + 1]),
    relativeResidual: solved.relativeResidual,
  };
}

export function solveCantileverTorsion(
  nodesM: readonly number[],
  torsionalStiffnessAtY: (yM: number) => number,
  elementTorqueNmPerM: readonly number[],
  tipTorqueNm = 0,
  signal?: AbortSignal,
): CantileverTorsionResult {
  validateMesh(nodesM, elementTorqueNmPerM);
  const stiffness = Array.from({ length: nodesM.length }, () => Array(nodesM.length).fill(0));
  const load = Array(nodesM.length).fill(0);
  for (let element = 0; element < nodesM.length - 1; element += 1) {
    if (signal?.aborted) throw new Error('Structural solve was aborted.');
    const start = nodesM[element];
    const length = nodesM[element + 1] - start;
    let coefficient = 0;
    for (const { r, weight } of GAUSS_POINTS) {
      const gj = torsionalStiffnessAtY(start + r * length);
      if (!Number.isFinite(gj) || gj <= 0) throw new Error('Torsional stiffness must be finite and positive.');
      coefficient += gj * weight / length;
    }
    stiffness[element][element] += coefficient;
    stiffness[element][element + 1] -= coefficient;
    stiffness[element + 1][element] -= coefficient;
    stiffness[element + 1][element + 1] += coefficient;
    const torque = elementTorqueNmPerM[element] * length / 2;
    load[element] += torque;
    load[element + 1] += torque;
  }
  load[load.length - 1] += tipTorqueNm;
  if (signal?.aborted) throw new Error('Structural solve was aborted.');
  const solved = reducedSolve(stiffness, load, [0]);
  return { twistRad: solved.solution, relativeResidual: solved.relativeResidual };
}

export function internalActionAtY(
  yM: number,
  nodesM: readonly number[],
  elementLoadNpm: readonly number[],
  elementTorqueNmPerM: readonly number[],
  tipForceN = 0,
  tipTorqueNm = 0,
): InternalAction {
  validateMesh(nodesM, elementLoadNpm);
  if (elementTorqueNmPerM.length !== elementLoadNpm.length) throw new Error('Torque and load arrays must use the same structural mesh.');
  if (!Number.isFinite(yM) || yM < nodesM[0] || yM > nodesM[nodesM.length - 1]) throw new Error('Internal-action station must lie on the finite semispan mesh.');
  if (elementTorqueNmPerM.some((value) => !Number.isFinite(value)) || !Number.isFinite(tipForceN) || !Number.isFinite(tipTorqueNm)) throw new Error('Internal-action torque and tip loads must be finite.');
  let shearN = tipForceN;
  let bendingMomentNm = tipForceN * (nodesM[nodesM.length - 1] - yM);
  let torqueNm = tipTorqueNm;
  for (let element = 0; element < elementLoadNpm.length; element += 1) {
    const segmentStart = Math.max(yM, nodesM[element]);
    const segmentEnd = nodesM[element + 1];
    if (segmentEnd <= segmentStart) continue;
    const length = segmentEnd - segmentStart;
    const centroid = (segmentStart + segmentEnd) / 2;
    shearN += elementLoadNpm[element] * length;
    bendingMomentNm += elementLoadNpm[element] * length * (centroid - yM);
    torqueNm += elementTorqueNmPerM[element] * length;
  }
  return { shearN, bendingMomentNm, torqueNm };
}

function positiveSemispanStrips(aero: AeroResult): AeroStripResult[] {
  const strips = aero.strips.filter((strip) => strip.yStartM >= -1e-12).sort((a, b) => a.yStartM - b.yStartM);
  if (!strips.length || Math.abs(strips[0].yStartM) > 1e-9) throw new Error('Aerodynamic lattice does not expose a root-to-tip right semispan.');
  if (strips.length !== aero.panelCount / 2) throw new Error('Aerodynamic semispan strip count is inconsistent.');
  strips.forEach((strip, index) => {
    const values = [strip.yStartM, strip.yEndM, strip.verticalForceN, strip.chordM];
    if (values.some((value) => !Number.isFinite(value)) || !(strip.yEndM > strip.yStartM)) throw new Error('Aerodynamic semispan strip loads must be finite and have positive width.');
    if (index > 0 && Math.abs(strip.yStartM - strips[index - 1].yEndM) > 1e-9) throw new Error('Aerodynamic semispan strip boundaries must be contiguous.');
  });
  return strips;
}

export function solveWingStructure(design: WingDesign, aero: AeroResult, signal?: AbortSignal): StructuralResult {
  const strips = positiveSemispanStrips(aero);
  if (Math.abs(strips[strips.length - 1].yEndM - design.geometry.spanM / 2) > 1e-9) throw new Error('Aerodynamic semispan extent does not match the design span.');
  const nodesM = [0, ...strips.map((strip) => strip.yEndM)];
  const elementLoadNpm = strips.map((strip, index) => strip.verticalForceN / (nodesM[index + 1] - nodesM[index]));
  const elementTorqueNmPerM = strips.map((strip, index) => (
    (design.structure.elasticAxisXOverC - 0.25) * chordAtY(design.geometry, strip.yMidM) * strip.verticalForceN / (nodesM[index + 1] - nodesM[index])
    + strip.pitchingMomentNmPerM
  ));
  const sectionAt = (yM: number) => wingBoxAtY(design, yM);
  const bending = solveCantileverBending(nodesM, (yM) => sectionAt(yM).bendingStiffnessNm2, elementLoadNpm, 0, signal);
  const torsion = solveCantileverTorsion(nodesM, (yM) => sectionAt(yM).torsionalStiffnessNm2, elementTorqueNmPerM, 0, signal);

  let minimumYieldMargin = Number.POSITIVE_INFINITY;
  let maxBendingStressPa = 0;
  let maxTorsionalShearPa = 0;
  let maxVonMisesPa = 0;
  const includeStress = (stress: WallStressResult) => {
    if (stress.yieldMargin !== null) minimumYieldMargin = Math.min(minimumYieldMargin, stress.yieldMargin);
    maxBendingStressPa = Math.max(maxBendingStressPa, stress.maxBendingStressPa);
    maxTorsionalShearPa = Math.max(maxTorsionalShearPa, stress.maxTorsionalShearPa);
    maxVonMisesPa = Math.max(maxVonMisesPa, stress.maxVonMisesPa);
  };

  strips.forEach((strip) => {
    if (signal?.aborted) throw new Error('Structural solve was aborted.');
    const length = strip.yEndM - strip.yStartM;
    for (const { r } of GAUSS_POINTS) {
      const yM = strip.yStartM + r * length;
      const section = sectionAt(yM);
      const actions = internalActionAtY(yM, nodesM, elementLoadNpm, elementTorqueNmPerM);
      includeStress(recoverWallStress(section, actions.bendingMomentNm, actions.torqueNm));
    }
  });

  const nodes = nodesM.map((yM, index): StructuralNodeResult => {
    const section = sectionAt(yM);
    const actions = internalActionAtY(yM, nodesM, elementLoadNpm, elementTorqueNmPerM);
    const stress = recoverWallStress(section, actions.bendingMomentNm, actions.torqueNm);
    includeStress(stress);
    return {
      yM,
      eta: yM / nodesM[nodesM.length - 1],
      chordM: chordAtY(design.geometry, yM),
      deflectionM: bending.deflectionM[index],
      slopeRad: bending.slopeRad[index],
      elasticTwistRad: torsion.twistRad[index],
      bendingStiffnessNm2: section.bendingStiffnessNm2,
      torsionalStiffnessNm2: section.torsionalStiffnessNm2,
      massPerLengthKgM: section.massPerLengthKgM,
      stress,
      ...actions,
    };
  });
  const root = nodes[0];
  const tip = nodes[nodes.length - 1];
  if (!Number.isFinite(minimumYieldMargin)) throw new Error('Structural solve requires a nonzero finite aerodynamic load field.');
  return {
    nodes,
    structuralMassKg: expectedStructuralMassKg(design),
    tipDeflectionM: tip.deflectionM,
    tipElasticTwistRad: tip.elasticTwistRad,
    maxElasticTwistRad: Math.max(...nodes.map((node) => Math.abs(node.elasticTwistRad))),
    rootShearN: root.shearN,
    rootBendingMomentNm: root.bendingMomentNm,
    rootTorqueNm: root.torqueNm,
    minimumYieldMargin,
    maxBendingStressPa,
    maxTorsionalShearPa,
    maxVonMisesPa,
    bendingRelativeResidual: bending.relativeResidual,
    torsionRelativeResidual: torsion.relativeResidual,
  };
}
