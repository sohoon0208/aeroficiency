import { analysisIsCurrent } from '@/lib/domain/commands';
import type { AnalysisSnapshot, ConstraintResult, DesignId, ProjectState } from '@/lib/domain/types';
import { CANONICAL_TRADE_OFF_SENTENCE } from './copy';

/** A reporting policy for display language, not a solver uncertainty or acceptance tolerance. */
export const DRAG_REPORTING_NEUTRAL_PCT = 0.05;

export type ChangeMeaning = 'improvement' | 'neutral' | 'worse';

export function classifyDragChange(percent: number): ChangeMeaning {
  if (percent < -DRAG_REPORTING_NEUTRAL_PCT) return 'improvement';
  if (percent > DRAG_REPORTING_NEUTRAL_PCT) return 'worse';
  return 'neutral';
}

function percentDelta(candidate: number, reference: number) {
  return reference === 0 ? null : 100 * (candidate - reference) / reference;
}

function compatible(reference: AnalysisSnapshot, candidate: AnalysisSnapshot) {
  return reference.flightCaseRevision === candidate.flightCaseRevision
    && reference.constraintsRevision === candidate.constraintsRevision
    && reference.fidelity === candidate.fidelity
    && reference.solverVersion === candidate.solverVersion;
}

export type CandidateVerdict =
  | { status: 'unavailable'; reason: string }
  | {
    status: 'ready' | 'failed';
    title: 'Ready for human review' | 'Configured checks not met';
    checks: ConstraintResult[];
    passedChecks: number;
    analysis: { analysisId: string; designRevision: number; fidelity: string; freshness: 'current' };
    wallMass: { referenceKg: number; candidateKg: number; deltaPct: number | null };
    wakeDrag: { referenceN: number; candidateN: number; deltaPct: number | null; meaning: ChangeMeaning | 'undefined' };
    yieldRatio: number;
    tipDeflection: { actualM: number; limitM: number };
    tradeOffSentence: string | null;
  };

export function currentSelectedCandidateAnalysis(
  project: ProjectState,
  activeDesignId: DesignId,
  selected: AnalysisSnapshot | null,
) {
  const design = project.designs[activeDesignId];
  if (!design || design.kind !== 'candidate' || !selected || selected.designId !== design.designId) return null;
  if (selected.status !== 'converged' || !analysisIsCurrent(project, selected.analysisId)) return null;
  return selected;
}

export function buildCandidateVerdict(project: ProjectState, reference: AnalysisSnapshot | null, candidate: AnalysisSnapshot | null): CandidateVerdict {
  if (!candidate) return { status: 'unavailable', reason: 'Run a current candidate analysis.' };
  const candidateDesign = project.designs[candidate.designId];
  if (!candidateDesign || candidateDesign.kind !== 'candidate') return { status: 'unavailable', reason: 'Select a candidate analysis.' };
  if (candidate.status !== 'converged' || !analysisIsCurrent(project, candidate.analysisId)) return { status: 'unavailable', reason: 'Candidate verdict unavailable for stale or non-converged results.' };
  if (!reference) return { status: 'unavailable', reason: 'Run a current Baseline analysis.' };
  const referenceDesign = project.designs[reference.designId];
  if (!referenceDesign || referenceDesign.kind !== 'baseline' || reference.status !== 'converged' || !analysisIsCurrent(project, reference.analysisId)) {
    return { status: 'unavailable', reason: 'A current converged analysis for the selected Baseline is required.' };
  }
  if (!compatible(reference, candidate)) return { status: 'unavailable', reason: 'Baseline and candidate analyses are not compatible.' };

  const checks = candidate.constraints;
  const passedChecks = checks.filter((constraint) => constraint.state === 'pass').length;
  const ready = checks.length === 5 && passedChecks === 5;
  const massDeltaPct = percentDelta(candidate.metrics.structuralMassKg, reference.metrics.structuralMassKg);
  const dragDeltaPct = percentDelta(candidate.metrics.inducedDragN, reference.metrics.inducedDragN);
  const dragMeaning = dragDeltaPct === null ? 'undefined' : classifyDragChange(dragDeltaPct);
  const meaningfulMassReduction = massDeltaPct !== null && massDeltaPct <= -project.constraints.minMassReductionPct;
  return {
    status: ready ? 'ready' : 'failed',
    title: ready ? 'Ready for human review' : 'Configured checks not met',
    checks,
    passedChecks,
    analysis: { analysisId: candidate.analysisId, designRevision: candidate.designRevision, fidelity: candidate.fidelity, freshness: 'current' },
    wallMass: { referenceKg: reference.metrics.structuralMassKg, candidateKg: candidate.metrics.structuralMassKg, deltaPct: massDeltaPct },
    wakeDrag: { referenceN: reference.metrics.inducedDragN, candidateN: candidate.metrics.inducedDragN, deltaPct: dragDeltaPct, meaning: dragMeaning },
    yieldRatio: candidate.metrics.minYieldMargin,
    tipDeflection: { actualM: candidate.metrics.tipDeflectionM, limitM: project.constraints.maxTipDeflectionM },
    tradeOffSentence: ready && meaningfulMassReduction && dragMeaning === 'neutral' ? CANONICAL_TRADE_OFF_SENTENCE : null,
  };
}
