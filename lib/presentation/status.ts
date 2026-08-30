import type { AnalysisSnapshot, ConstraintResult, DesignKind } from '@/lib/domain/types';

export type ImmutableResultTone = 'awaiting' | 'current' | 'stale' | 'failed';

export interface ImmutableResultState {
  key: ImmutableResultTone;
  label: string;
  detail: string;
  verdictAvailable: boolean;
}

export function immutableResultState(analysis: AnalysisSnapshot | null, current: boolean): ImmutableResultState {
  if (!analysis) return { key: 'awaiting', label: 'AWAITING ANALYSIS', detail: 'Run the solver to evaluate this revision.', verdictAvailable: false };
  if (analysis.status !== 'converged') return { key: 'failed', label: 'NOT CONVERGED', detail: 'Diagnostic snapshot only; configured checks are unavailable.', verdictAvailable: false };
  if (!current) return { key: 'stale', label: 'STALE RESULT', detail: 'Inputs changed after this immutable analysis.', verdictAvailable: false };
  return { key: 'current', label: 'CURRENT RESULT', detail: `Converged in ${analysis.convergence.iterations} iterations.`, verdictAvailable: true };
}

export function unavailableChecks(): ConstraintResult[] {
  return [
    ['mass_reduction', 'Modeled wing-box wall-mass reduction', '%'],
    ['yield_margin', 'Modeled yield ratio', '×'],
    ['tip_deflection', 'Tip deflection', 'm'],
    ['induced_drag', 'Wake-induced drag increase', '%'],
    ['convergence', 'Static analysis convergence', ''],
  ].map(([key, label, unit]) => ({
    key: key as ConstraintResult['key'],
    label,
    unit,
    state: 'unavailable',
    actual: null,
    limit: null,
    detail: 'Awaiting a current converged analysis.',
  }));
}

export function presentedConstraints(analysis: AnalysisSnapshot | null, current: boolean): ConstraintResult[] {
  if (!analysis) return unavailableChecks();
  if (current) return analysis.constraints;
  return analysis.constraints.map((constraint) => {
    if (analysis.status !== 'converged' || constraint.state === 'unavailable') return { ...constraint, state: 'unavailable' };
    return { ...constraint, state: 'stale' };
  });
}

export function configuredCheckSummary(kind: DesignKind, analysis: AnalysisSnapshot | null, current: boolean) {
  if (!analysis) return { label: 'Awaiting analysis', tone: 'awaiting' as const, passed: 0, applicable: 0 };
  if (analysis.status !== 'converged') return { label: 'Verdict unavailable · not converged', tone: 'failed' as const, passed: 0, applicable: 0 };
  if (!current) return { label: 'Verdict unavailable · stale', tone: 'stale' as const, passed: 0, applicable: 0 };
  const applicableKeys = kind === 'baseline'
    ? new Set<ConstraintResult['key']>(['yield_margin', 'tip_deflection', 'convergence'])
    : new Set<ConstraintResult['key']>(['mass_reduction', 'yield_margin', 'tip_deflection', 'induced_drag', 'convergence']);
  const applicable = analysis.constraints.filter((constraint) => applicableKeys.has(constraint.key));
  const passed = applicable.filter((constraint) => constraint.state === 'pass').length;
  return {
    label: kind === 'baseline' ? `${passed} / 3 intrinsic checks pass · 2 comparison checks N/A` : `${passed} / 5 configured checks pass`,
    tone: passed === applicable.length ? 'current' as const : 'failed' as const,
    passed,
    applicable: applicable.length,
  };
}

type AlertOutcome<T> = Extract<T, { status: 'not_converged' | 'failed' | 'conflicted' | 'aborted' }>;

export function visibleRunOutcome<T extends { status: string; designId?: string }>(run: T): AlertOutcome<T> | null {
  if (run.status === 'idle' || run.status === 'running' || run.status === 'succeeded') return null;
  return run as AlertOutcome<T>;
}
