import type { FlightCase, SolverFidelity, WingDesign } from '@/lib/domain/types';
import { SOLVER_SETTINGS } from '@/lib/domain/limits';
import { AeroError, solveTargetLiftAerodynamics, type AeroResult } from './aero';
import { solveWingStructure, type StructuralResult } from './beam';
import { maxAbs } from './math';

export interface CouplingProgress {
  iteration: number;
  maxIterations: number;
  phase: 'aerodynamics' | 'structure' | 'verification';
}

export interface CouplingDiagnostics {
  iterations: number;
  equilibriumResidualRad: number;
  iterateChangeRad: number;
  relativeLoadChange: number;
  relativeLiftError: number;
}

export interface CoupledResult {
  status: 'converged' | 'not_converged';
  aero: AeroResult;
  structure: StructuralResult;
  diagnostics: CouplingDiagnostics;
}

export class CouplingError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'TARGET_LIFT_UNBRACKETED' | 'TRIM_DID_NOT_CONVERGE' | 'VLM_SINGULAR' | 'MODEL_RANGE_EXCEEDED' | 'ABORTED' | 'NUMERICAL_FAILURE', message: string) {
    super(message);
    this.name = 'CouplingError';
  }
}

function relativeChange(current: readonly number[], previous: readonly number[] | null) {
  if (!previous || current.length !== previous.length) return Number.POSITIVE_INFINITY;
  let delta2 = 0;
  let current2 = 0;
  for (let index = 0; index < current.length; index += 1) {
    delta2 += (current[index] - previous[index]) ** 2;
    current2 += current[index] ** 2;
  }
  return Math.sqrt(delta2) / Math.max(Math.sqrt(current2), 1);
}

function relaxed(raw: readonly number[], current: readonly number[]) {
  return raw.map((value, index) => (1 - SOLVER_SETTINGS.relaxationFactor) * current[index] + SOLVER_SETTINGS.relaxationFactor * value);
}

function ensureWithinModelRange(design: WingDesign, structure: StructuralResult) {
  if (structure.maxElasticTwistRad > 15 * Math.PI / 180) throw new CouplingError('MODEL_RANGE_EXCEEDED', 'Elastic twist exceeded the supported 15 degree preliminary-model range.');
  if (Math.abs(structure.tipDeflectionM) > 0.1 * design.geometry.spanM / 2) throw new CouplingError('MODEL_RANGE_EXCEEDED', 'Tip bending exceeded 10% of semispan; small-deflection beam assumptions are invalid.');
}

function diagnostic(
  iterations: number,
  rawTwist: readonly number[],
  iterateTwist: readonly number[],
  nextTwist: readonly number[],
  loads: readonly number[],
  previousLoads: readonly number[] | null,
  aero: AeroResult,
): CouplingDiagnostics {
  return {
    iterations,
    equilibriumResidualRad: maxAbs(rawTwist.map((value, index) => value - iterateTwist[index])),
    iterateChangeRad: maxAbs(nextTwist.map((value, index) => value - iterateTwist[index])),
    relativeLoadChange: relativeChange(loads, previousLoads),
    relativeLiftError: Math.abs(aero.targetLiftError),
  };
}

function converged(values: CouplingDiagnostics) {
  return values.iterations >= 2
    && values.equilibriumResidualRad <= SOLVER_SETTINGS.equilibriumToleranceRad
    && values.iterateChangeRad <= SOLVER_SETTINGS.iterateChangeToleranceRad
    && values.relativeLoadChange <= SOLVER_SETTINGS.relativeLoadTolerance
    && values.relativeLiftError <= SOLVER_SETTINGS.coupledLiftTolerance;
}

export function runAeroelasticCoupling(
  design: WingDesign,
  flightCase: FlightCase,
  fidelity: SolverFidelity,
  signal?: AbortSignal,
  onProgress?: (progress: CouplingProgress) => void,
): CoupledResult {
  const panelCount = fidelity === 'fast' ? SOLVER_SETTINGS.fast.fullSpanPanelCount : SOLVER_SETTINGS.standard.fullSpanPanelCount;
  const semispanNodeCount = panelCount / 2 + 1;
  const eta = Array.from({ length: semispanNodeCount }, (_, index) => -Math.cos(Math.PI * (panelCount / 2 + index) / panelCount));
  let twist = Array(semispanNodeCount).fill(0);
  let previousLoads: number[] | null = null;
  let last: CoupledResult | null = null;

  try {
    for (let iteration = 1; iteration <= SOLVER_SETTINGS.couplingMaxIterations; iteration += 1) {
      if (signal?.aborted) throw new CouplingError('ABORTED', 'Aeroelastic solve was aborted.');
      onProgress?.({ iteration, maxIterations: SOLVER_SETTINGS.couplingMaxIterations, phase: 'aerodynamics' });
      const aero = solveTargetLiftAerodynamics(design.geometry, flightCase, { eta, twistRad: twist }, panelCount, signal);
      const loads = aero.strips.filter((strip) => strip.yStartM >= -1e-12).map((strip) => strip.verticalForceN);
      onProgress?.({ iteration, maxIterations: SOLVER_SETTINGS.couplingMaxIterations, phase: 'structure' });
      const structure = solveWingStructure(design, aero, signal);
      ensureWithinModelRange(design, structure);
      const rawTwist = structure.nodes.map((node) => node.elasticTwistRad);
      const nextTwist = relaxed(rawTwist, twist);
      const diagnostics = diagnostic(iteration, rawTwist, twist, nextTwist, loads, previousLoads, aero);
      last = { status: 'not_converged', aero, structure, diagnostics };

      if (converged(diagnostics)) {
        onProgress?.({ iteration, maxIterations: SOLVER_SETTINGS.couplingMaxIterations, phase: 'verification' });
        const verifiedAero = solveTargetLiftAerodynamics(design.geometry, flightCase, { eta, twistRad: nextTwist }, panelCount, signal);
        const verifiedStructure = solveWingStructure(design, verifiedAero, signal);
        ensureWithinModelRange(design, verifiedStructure);
        const verifiedRaw = verifiedStructure.nodes.map((node) => node.elasticTwistRad);
        const verifiedLoads = verifiedAero.strips.filter((strip) => strip.yStartM >= -1e-12).map((strip) => strip.verticalForceN);
        const verifiedNext = relaxed(verifiedRaw, nextTwist);
        const verifiedDiagnostics = diagnostic(iteration, verifiedRaw, nextTwist, verifiedNext, verifiedLoads, loads, verifiedAero);
        if (converged(verifiedDiagnostics)) return { status: 'converged', aero: verifiedAero, structure: verifiedStructure, diagnostics: verifiedDiagnostics };
      }
      twist = nextTwist;
      previousLoads = loads;
    }
  } catch (error) {
    if (error instanceof CouplingError) throw error;
    if (error instanceof AeroError) throw new CouplingError(error.code, error.message);
    if (signal?.aborted || (error instanceof Error && /aborted/i.test(error.message))) throw new CouplingError('ABORTED', 'Aeroelastic solve was aborted.');
    if (error instanceof Error && /invalid|outside|must|thin-wall|target lift/i.test(error.message)) throw new CouplingError('INVALID_INPUT', error.message);
    throw new CouplingError('NUMERICAL_FAILURE', error instanceof Error ? error.message : 'Aeroelastic solve failed numerically.');
  }
  if (!last) throw new CouplingError('NUMERICAL_FAILURE', 'Aeroelastic solve produced no iteration result.');
  return last;
}
