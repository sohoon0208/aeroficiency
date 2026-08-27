import { currentAnalysis } from './validation';
import type { AnalysisSnapshot, ConstraintResult, ProjectState, SolverFidelity, WingDesign } from './types';

function unavailableConstraint(key: ConstraintResult['key'], label: string, unit: string, detail: string): ConstraintResult {
  return { key, label, state: 'unavailable', actual: null, limit: null, unit, detail };
}

function comparisonAnalysis(state: ProjectState, design: WingDesign, fidelity: SolverFidelity) {
  if (design.kind === 'baseline') return null;
  const baseline = Object.values(state.designs).find((candidate) => candidate.kind === 'baseline');
  if (!baseline) return null;
  const analysis = currentAnalysis(state, baseline);
  if (!analysis || analysis.fidelity !== fidelity || analysis.solverVersion !== state.solverVersion) return null;
  return analysis;
}

export function evaluateDesignConstraints(
  state: ProjectState,
  design: WingDesign,
  fidelity: SolverFidelity,
  status: AnalysisSnapshot['status'],
  massKg: number,
  inducedDragN: number,
  yieldMargin: number,
  tipDeflectionM: number,
): ConstraintResult[] {
  if (status !== 'converged') {
    return [
      unavailableConstraint('mass_reduction', 'Structural mass reduction', '%', 'Unavailable because the coupled solution did not converge.'),
      unavailableConstraint('yield_margin', 'Modeled yield margin', '×', 'Unavailable because the coupled solution did not converge.'),
      unavailableConstraint('tip_deflection', 'Tip deflection', 'm', 'Unavailable because the coupled solution did not converge.'),
      unavailableConstraint('induced_drag', 'Induced drag increase', '%', 'Unavailable because the coupled solution did not converge.'),
      unavailableConstraint('convergence', 'Aeroelastic convergence', '', 'The fixed-point iteration did not converge.'),
    ];
  }

  const baseline = comparisonAnalysis(state, design, fidelity);
  const massReduction = baseline ? 100 * (baseline.metrics.structuralMassKg - massKg) / baseline.metrics.structuralMassKg : null;
  const dragIncrease = baseline ? 100 * (inducedDragN - baseline.metrics.inducedDragN) / baseline.metrics.inducedDragN : null;
  return [
    massReduction === null
      ? unavailableConstraint('mass_reduction', 'Structural mass reduction', '%', design.kind === 'baseline' ? 'Baseline defines the mass reference.' : 'Run a current baseline analysis at the same fidelity first.')
      : { key: 'mass_reduction', label: 'Structural mass reduction', state: massReduction >= state.constraints.minMassReductionPct ? 'pass' : 'fail', actual: massReduction, limit: state.constraints.minMassReductionPct, unit: '%', detail: 'Relative to the current baseline analysis.' },
    { key: 'yield_margin', label: 'Modeled yield margin', state: yieldMargin >= state.constraints.minYieldMargin ? 'pass' : 'fail', actual: yieldMargin, limit: state.constraints.minYieldMargin, unit: '×', detail: 'Material yield only; buckling and local failure are omitted.' },
    { key: 'tip_deflection', label: 'Tip deflection', state: Math.abs(tipDeflectionM) <= state.constraints.maxTipDeflectionM ? 'pass' : 'fail', actual: Math.abs(tipDeflectionM), limit: state.constraints.maxTipDeflectionM, unit: 'm', detail: 'Right-semispan Euler–Bernoulli beam.' },
    dragIncrease === null
      ? unavailableConstraint('induced_drag', 'Induced drag increase', '%', design.kind === 'baseline' ? 'Baseline defines the drag reference.' : 'Run a current baseline analysis at the same fidelity first.')
      : { key: 'induced_drag', label: 'Induced drag increase', state: dragIncrease <= state.constraints.maxInducedDragIncreasePct ? 'pass' : 'fail', actual: dragIncrease, limit: state.constraints.maxInducedDragIncreasePct, unit: '%', detail: 'Matched target lift and identical flight case.' },
    { key: 'convergence', label: 'Aeroelastic convergence', state: 'pass', actual: 1, limit: 1, unit: '', detail: 'All fixed-point, load, and target-lift residuals passed.' },
  ];
}
