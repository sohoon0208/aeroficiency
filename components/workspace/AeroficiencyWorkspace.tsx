'use client';

import { useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { SpanwiseCharts } from '@/components/charts/SpanwiseCharts';
import { AirfoilEditor, CaseEditor, GeometryEditor, StructureEditor } from '@/components/design/Editors';
import { SectionFlowLab } from '@/components/flow/SectionFlowLab';
import { PerformanceLab } from '@/components/flow/PerformanceLab';
import { AngleSweepScrubber } from '@/components/flow/AngleSweepExplorer';
import { ChallengeHeader } from '@/components/workspace/ChallengeHeader';
import { WingViewport, type ViewMode } from '@/components/viewport/WingViewport';
import { analysisIsCurrent } from '@/lib/domain/commands';
import { sweepPresentationAtAngle } from '@/lib/domain/angleSweep';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { MODEL_WARNINGS } from '@/lib/domain/limits';
import { interpolateStationValue } from '@/lib/domain/stations';
import type { AnalysisSnapshot, DomainResult, WingDesign, WingGeometry, WingStructure } from '@/lib/domain/types';
import { configuredCheckSummary, immutableResultState, presentedConstraints, visibleRunOutcome } from '@/lib/presentation/status';
import { buildCandidateVerdict, classifyDragChange, currentSelectedCandidateAnalysis } from '@/lib/presentation/verdict';
import { RELEASE_IDENTITY } from '@/lib/release';
import { chordAtY } from '@/lib/solver/planform';
import { useProjectStore, type CommandNotice } from '@/store/projectStore';
import { AEROFICIENCY_TOOL_COUNT, registerAeroficiencySiteTools } from '@/webmcp/registerSiteTools';

type EditorTab = 'geometry' | 'airfoils' | 'structure' | 'case';
type MobileView = 'design' | 'model' | 'results';
type ResultTab = 'overview' | 'checks' | 'compare' | 'log';

const VISUALIZATION_TABS: ReadonlyArray<readonly [ViewMode, string]> = [
  ['geometry', 'Geometry'],
  ['aero', 'Aero loads'],
  ['section', '2D Section'],
  ['performance', 'Efficiency'],
  ['structure', 'Structure'],
];

const EDITOR_FIELD_LABELS: Record<string, string> = {
  'geometry.spanM': 'Projected span in m',
  'geometry.rootChordM': 'Root chord in m',
  'geometry.tipChordM': 'Tip chord in m',
  'geometry.tipTwistDeg': 'Tip twist in deg',
  'geometry.nacaCode': 'NACA four-digit code',
  'geometry.airfoilStations': 'Spanwise airfoil stations',
  'geometry.polarModel': 'Section polar JSON',
  'structure.skinThicknessMm': 'Skin gauge in mm',
  'structure.frontWebThicknessMm': 'Front web in mm',
  'structure.rearWebThicknessMm': 'Rear web in mm',
  'structure.elasticAxisXOverC': 'Elastic axis in x/c',
};

const fmt = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value)
  ? '—'
  : value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${fmt(value, digits)}`;

function moveTabFocus<T extends string>(event: ReactKeyboardEvent<HTMLButtonElement>, keys: readonly T[], current: T, setCurrent: (value: T) => void, idPrefix: string) {
  const index = keys.indexOf(current);
  let next = index;
  if (event.key === 'ArrowRight') next = (index + 1) % keys.length;
  else if (event.key === 'ArrowLeft') next = (index - 1 + keys.length) % keys.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = keys.length - 1;
  else return;
  event.preventDefault();
  setCurrent(keys[next]);
  window.requestAnimationFrame(() => document.getElementById(`${idPrefix}-${keys[next]}`)?.focus());
}

function MetricCell({ label, value, unit, detail }: { label: string; value: string; unit: string; detail: string }) {
  return <article className="metric-cell"><span>{label}</span><p><strong>{value}</strong><small>{unit}</small></p><b>{detail}</b></article>;
}

function analysisCompatibility(reference: AnalysisSnapshot, candidate: AnalysisSnapshot) {
  return reference.flightCaseRevision === candidate.flightCaseRevision
    && reference.constraintsRevision === candidate.constraintsRevision
    && reference.fidelity === candidate.fidelity
    && reference.solverVersion === candidate.solverVersion;
}

function commandNoticeHeading(notice: CommandNotice) {
  if (notice.kind === 'replay') return 'Idempotent replay · no duplicate write';
  if (notice.code === 'BASELINE_CHANGED') return 'Baseline reference changed';
  if (notice.kind === 'success') return 'Analysis committed · background target';
  switch (notice.code) {
    case 'VALIDATION_ERROR': return 'Input needs correction';
    case 'DESIGN_NOT_FOUND': return 'Design not found';
    case 'ANALYSIS_NOT_FOUND': return 'Analysis not found';
    case 'ANALYSIS_ALREADY_RUNNING': return 'Analysis already running';
    case 'REVISION_CONFLICT': return 'Revision conflict';
    case 'DUPLICATE_MUTATION_MISMATCH': return 'Idempotency key conflict';
    case 'ANALYSIS_REQUIRED': return 'Analysis required';
    case 'STALE_ANALYSIS': return 'Analysis is stale';
    case 'INVALID_COMPARISON': return 'Comparison request invalid';
    case 'INCOMPATIBLE_ANALYSES': return 'Analyses are incompatible';
    case 'DESIGN_LIMIT_REACHED': return 'Design limit reached';
    case 'WORKSPACE_STATE_INVALID': return 'Workspace state needs reset';
    case 'ANALYSIS_DID_NOT_CONVERGE': return 'Analysis did not converge';
    case 'ABORTED': return 'Analysis aborted';
    case 'TOOL_UNAVAILABLE': return 'Analysis tool unavailable';
    case 'ANALYSIS_FAILED': return 'Analysis failed';
    default: return 'Command rejected safely';
  }
}

function DesignVariantItem({ design, active, running, onSelect, onRename }: { design: WingDesign; active: boolean; running: boolean; onSelect: () => void; onRename: (label: string) => DomainResult<unknown> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(design.label);
  const [error, setError] = useState('');
  const errorId = `rename-error-${design.designId}`;
  const beginRename = () => {
    if (running) return;
    onSelect();
    setDraft(design.label);
    setError('');
    setEditing(true);
  };
  const commitRename = () => {
    const next = draft.trim();
    if (next === design.label) {
      setDraft(design.label);
      setError('');
      setEditing(false);
      return;
    }
    const result = onRename(next);
    if (!result.ok) {
      setError(result.error.issues?.[0]?.reason ?? result.error.message);
      return;
    }
    setDraft(next);
    setError('');
    setEditing(false);
  };
  return (
    <article className={`variant-item ${design.kind} ${active ? 'active' : ''} ${error ? 'has-error' : ''}`}>
      <button className="variant-select" type="button" aria-label={`Select ${design.label}`} onClick={onSelect}><span aria-hidden="true">{design.kind === 'baseline' ? '◆' : '◇'}</span><p><small>Revision {design.revision} · {design.kind === 'baseline' ? 'Baseline reference · Editable' : 'Candidate · Editable'}</small></p>{active && <b>ACTIVE</b>}</button>
      <div className="variant-name-control">{editing
        ? <input aria-label={`Rename ${design.label}`} aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)} autoFocus value={draft} maxLength={48} disabled={running} onFocus={(event) => event.currentTarget.select()} onChange={(event) => { setDraft(event.target.value); setError(''); }} onBlur={commitRename} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); } else if (event.key === 'Escape') { event.preventDefault(); setDraft(design.label); setError(''); setEditing(false); } }} />
        : <button className="variant-name-button" type="button" aria-label={`Rename ${design.label}`} title={running ? 'Finish the current analysis before renaming.' : 'Click to rename this design'} disabled={running} onClick={beginRename}><strong>{design.label}</strong></button>}</div>
      {error && <small id={errorId} className="variant-name-error" role="alert">{error}</small>}
    </article>
  );
}

/** Shared human-and-agent engineering workspace. */
export function AeroficiencyWorkspace() {
  const project = useProjectStore((state) => state.project);
  const analysisRun = useProjectStore((state) => state.analysisRun);
  const siteTools = useProjectStore((state) => state.siteTools);
  const presentation = useProjectStore((state) => state.presentation);
  const mutationHighlight = useProjectStore((state) => state.mutationHighlight);
  const commandNotice = useProjectStore((state) => state.commandNotice);
  const store = useProjectStore.getState;
  const [editorTab, setEditorTab] = useState<EditorTab>('geometry');
  const [mode, setMode] = useState<ViewMode>('geometry');
  const [deformed, setDeformed] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('model');
  const [resultTab, setResultTab] = useState<ResultTab>('overview');
  const [resetOpen, setResetOpen] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [sweepSelection, setSweepSelection] = useState<{ analysisId: string; alphaDeg: number } | null>(null);
  const resetDialogRef = useRef<HTMLElement>(null);
  const editorFocusRef = useRef<{ tab: EditorTab; ariaLabel: string } | null>(null);

  const focusedDesign = presentation.designId ? project.designs[presentation.designId] : null;
  const activeDesign = focusedDesign ?? project.designs[project.activeDesignId];
  const baseline = Object.values(project.designs).find((design) => design.kind === 'baseline') ?? null;
  const candidateCount = Object.values(project.designs).filter((design) => design.kind === 'candidate').length;
  const selectedAnalysisId = presentation.analysisId ?? project.selectedAnalysisId ?? activeDesign.latestAnalysisId;
  const analysis = selectedAnalysisId ? project.analyses[selectedAnalysisId] ?? null : null;
  const selectedEta = presentation.eta ?? project.selectedEta;
  const current = Boolean(analysis && analysisIsCurrent(project, analysis.analysisId));
  const immutableState = immutableResultState(analysis, current);
  const requestedSweepAlpha = sweepSelection && sweepSelection.analysisId === analysis?.analysisId
    ? sweepSelection.alphaDeg
    : analysis ? Number(analysis.angleSweep.trimAlphaDeg.toFixed(2)) : null;
  const deferredSweepAlpha = useDeferredValue(requestedSweepAlpha);
  const sweepPresentation = useMemo(() => analysis?.status === 'converged' && current ? sweepPresentationAtAngle(analysis, deferredSweepAlpha) : null, [analysis, current, deferredSweepAlpha]);
  const selectedSweepPoint = sweepPresentation?.point ?? null;
  const visualAnalysis = analysis?.status === 'converged' && current
    ? sweepPresentation?.analysis ?? analysis
    : null;
  const metricAnalysis = analysis;
  const overviewAnalysis = visualAnalysis ?? metricAnalysis;
  const runningGlobally = analysisRun.status === 'running';
  const runningForActive = runningGlobally && analysisRun.designId === activeDesign.designId && analysisRun.designRevision === activeDesign.revision;
  const editable = true;
  const activeMutationHighlight = mutationHighlight?.designId === activeDesign.designId ? mutationHighlight : null;
  const visibleCommandNotice = commandNotice;
  const runAlert = visibleRunOutcome(analysisRun);
  const commandNoticeTarget = visibleCommandNotice?.designId
    ? project.designs[visibleCommandNotice.designId]?.label
      ? `${project.designs[visibleCommandNotice.designId].label} (${visibleCommandNotice.designId})`
      : visibleCommandNotice.designId
    : 'project';

  const currentBaselineAnalysis = baseline?.latestAnalysisId && analysisIsCurrent(project, baseline.latestAnalysisId)
    ? project.analyses[baseline.latestAnalysisId]
    : null;
  const retainedCurrentCandidateAnalysis = activeDesign.kind === 'candidate'
    && activeDesign.latestAnalysisId
    && analysisIsCurrent(project, activeDesign.latestAnalysisId)
    ? project.analyses[activeDesign.latestAnalysisId] ?? null
    : null;
  const candidateAttemptBlocksVerdict = Boolean(runAlert && runAlert.designId === activeDesign.designId);
  const currentCandidateAnalysis = candidateAttemptBlocksVerdict
    ? null
    : currentSelectedCandidateAnalysis(project, activeDesign.designId, analysis);
  const pinnedPair = presentation.comparisonAnalysisIds;
  const comparisonReference = pinnedPair ? project.analyses[pinnedPair.referenceAnalysisId] ?? null : currentBaselineAnalysis;
  const comparisonCandidate = pinnedPair ? project.analyses[pinnedPair.candidateAnalysisId] ?? null : currentCandidateAnalysis;
  const comparisonCompatible = Boolean(comparisonReference && comparisonCandidate && analysisCompatibility(comparisonReference, comparisonCandidate));
  const comparisonCurrent = Boolean(
    comparisonReference
    && comparisonCandidate
    && analysisIsCurrent(project, comparisonReference.analysisId)
    && analysisIsCurrent(project, comparisonCandidate.analysisId),
  );
  const comparisonReplacementReferenceId = comparisonReference
    ? (() => {
      const owner = project.designs[comparisonReference.designId];
      return owner?.latestAnalysisId && analysisIsCurrent(project, owner.latestAnalysisId) ? owner.latestAnalysisId : null;
    })()
    : null;
  const comparisonReplacementCandidateId = comparisonCandidate
    ? (() => {
      const owner = project.designs[comparisonCandidate.designId];
      return owner?.latestAnalysisId && analysisIsCurrent(project, owner.latestAnalysisId) ? owner.latestAnalysisId : null;
    })()
    : null;
  const comparisonReplacementReference = comparisonReplacementReferenceId ? project.analyses[comparisonReplacementReferenceId] ?? null : null;
  const comparisonReplacementCandidate = comparisonReplacementCandidateId ? project.analyses[comparisonReplacementCandidateId] ?? null : null;
  const comparisonReplacementsCompatible = Boolean(
    comparisonReplacementReference
    && comparisonReplacementCandidate
    && analysisCompatibility(comparisonReplacementReference, comparisonReplacementCandidate),
  );
  const comparisonRecovery = comparisonReplacementReferenceId && comparisonReplacementCandidateId
    ? comparisonReplacementsCompatible
      ? `Use current analyses ${comparisonReplacementReferenceId} and ${comparisonReplacementCandidateId}; no rerun is required.`
      : `Current replacements ${comparisonReplacementReferenceId} and ${comparisonReplacementCandidateId} use incompatible fidelity or settings. Run candidate design ${comparisonReplacementCandidate?.designId ?? activeDesign.designId} at ${comparisonReplacementReference?.fidelity ?? 'the chosen shared'} fidelity, then compare the explicit current IDs.`
    : 'Run only the design revisions without a current replacement, then compare the explicit current IDs.';
  const comparison = useMemo(() => {
    if (!comparisonReference || !comparisonCandidate || !comparisonCompatible) return null;
    const percent = (candidate: number, reference: number) => reference === 0 ? null : 100 * (candidate - reference) / reference;
    const drag = percent(comparisonCandidate.metrics.inducedDragN, comparisonReference.metrics.inducedDragN);
    return {
      mass: percent(comparisonCandidate.metrics.structuralMassKg, comparisonReference.metrics.structuralMassKg),
      drag,
      dragMeaning: drag === null ? 'undefined' as const : classifyDragChange(drag),
      deflection: percent(comparisonCandidate.metrics.tipDeflectionM, comparisonReference.metrics.tipDeflectionM),
      yieldRatio: comparisonCandidate.metrics.minYieldMargin - comparisonReference.metrics.minYieldMargin,
    };
  }, [comparisonCandidate, comparisonCompatible, comparisonReference]);
  const computedVerdict = buildCandidateVerdict(project, comparisonReference, comparisonCandidate);
  const verdict = computedVerdict.status === 'unavailable' && retainedCurrentCandidateAnalysis && !currentCandidateAnalysis
    ? {
      status: 'unavailable' as const,
      reason: 'A current candidate result is retained, but it is not the acknowledged result of the latest attempt. Show the retained current analysis to restore its verdict.',
    }
    : computedVerdict;

  useEffect(() => registerAeroficiencySiteTools(), []);
  useEffect(() => {
    const rememberEditorFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const panel = target.closest<HTMLElement>('.editor-panel');
      const ariaLabel = target.getAttribute('aria-label');
      if (!panel || !ariaLabel) {
        editorFocusRef.current = null;
        return;
      }
      const tab = panel.id === 'panel-geometry' ? 'geometry' : panel.id === 'panel-airfoils' ? 'airfoils' : panel.id === 'panel-structure' ? 'structure' : 'case';
      editorFocusRef.current = { tab, ariaLabel };
    };
    document.addEventListener('focusin', rememberEditorFocus);
    return () => document.removeEventListener('focusin', rememberEditorFocus);
  }, []);
  useEffect(() => {
    if (!activeMutationHighlight) return;
    const targetTab: EditorTab = activeMutationHighlight.paths.some((path) => path.startsWith('structure.'))
      ? 'structure'
      : activeMutationHighlight.paths.some((path) => path === 'geometry.airfoilStations' || path === 'geometry.polarModel' || path === 'geometry.nacaCode')
        ? 'airfoils'
        : 'geometry';
    const priorEditorFocus = editorFocusRef.current;
    let restoreFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      setEditorTab(targetTab);
      setMobileView('design');
      restoreFrame = window.requestAnimationFrame(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body && active !== document.documentElement && active.isConnected) return;
        if (!priorEditorFocus) return;
        const targetLabel = priorEditorFocus.tab === targetTab
          ? priorEditorFocus.ariaLabel
          : activeMutationHighlight.paths.map((path) => EDITOR_FIELD_LABELS[path]).find(Boolean);
        if (!targetLabel) return;
        const control = [...document.querySelectorAll<HTMLElement>('#design-workspace-panel [aria-label]')]
          .find((element) => element.getAttribute('aria-label') === targetLabel);
        control?.focus({ preventScroll: true });
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (restoreFrame !== null) window.cancelAnimationFrame(restoreFrame);
    };
  }, [activeMutationHighlight]);
  useEffect(() => {
    if (!mutationHighlight) return;
    const timer = window.setTimeout(() => useProjectStore.getState().clearMutationHighlight(), 10_000);
    return () => window.clearTimeout(timer);
  }, [mutationHighlight]);

  useEffect(() => {
    if (presentation.focusedPanel === 'none') return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame = window.requestAnimationFrame(() => {
      if (presentation.focusedPanel === 'station') {
        setMode('structure');
        setMobileView('model');
      } else {
        setResultTab('compare');
        setMobileView('results');
      }
      const targetId = presentation.focusedPanel === 'station' ? 'selected-station-evidence' : 'comparison-evidence';
      document.getElementById(targetId)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [presentation.focusedPanel, presentation.sequence]);

  useEffect(() => {
    if (!resetOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = resetDialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setResetOpen(false); return; }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); previousFocus?.focus(); };
  }, [resetOpen]);

  const runAnalysis = () => {
    const live = useProjectStore.getState();
    if (live.analysisRun.status === 'running') return;
    const latest = live.project;
    const design = latest.designs[activeDesign.designId] ?? latest.designs[latest.activeDesignId];
    void live.runAnalysis({
      designId: design.designId,
      expectedProjectRevision: latest.projectRevision,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: latest.flightCase.revision,
      expectedConstraintsRevision: latest.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, 'human');
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !document.querySelector('[aria-modal="true"]') && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runAnalysis(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  });

  const createCandidate = () => {
    store().createCandidate(activeDesign.designId, `Candidate ${String.fromCharCode(65 + candidateCount)}`, 'human');
  };
  const setActiveBaseline = () => store().setBaseline(activeDesign.designId, 'human');
  const updateGeometry = (patch: Partial<WingGeometry>) => store().updateGeometry(activeDesign.designId, patch, 'human');
  const updateStructure = (patch: Partial<WingStructure>) => store().updateStructure(activeDesign.designId, patch, 'human');
  const updateAngleSweep = (patch: Parameters<ReturnType<typeof useProjectStore.getState>['configureAngleSweep']>[0]) => store().configureAngleSweep(patch, 'human');

  const constraints = presentedConstraints(analysis, current);
  const checkSummary = configuredCheckSummary(activeDesign.kind, analysis, current);
  const progressText = runningForActive
    ? analysisRun.progress
      ? analysisRun.progress.scope === 'sweep'
        ? `AoA ${analysisRun.progress.alphaDeg?.toFixed(1)}° · point ${analysisRun.progress.sweepIndex} of ${analysisRun.progress.sweepCount} · ${analysisRun.progress.phase}`
        : `Target-lift trim · ${analysisRun.progress.phase} · iteration ${analysisRun.progress.iteration} of ${analysisRun.progress.maxIterations}`
      : 'Starting local analysis worker…'
    : immutableState.key === 'awaiting'
      ? ''
      : immutableState.detail;
  const effectiveDeformed = Boolean(deformed && visualAnalysis && mode !== 'section' && mode !== 'performance');
  const warnings = analysis?.warnings ?? [...MODEL_WARNINGS];
  const runDesign = runAlert ? project.designs[runAlert.designId] ?? null : null;
  const retainedAnalysis = runDesign?.latestAnalysisId ? project.analyses[runDesign.latestAnalysisId] ?? null : null;
  const retainedAnalysisCurrent = Boolean(retainedAnalysis && analysisIsCurrent(project, retainedAnalysis.analysisId));
  const commandNoticeCoveredByRun = Boolean(runAlert && visibleCommandNotice?.kind !== 'replay' && visibleCommandNotice?.kind !== 'success' && visibleCommandNotice?.designId === runAlert.designId);
  const standaloneCommandNotice = commandNoticeCoveredByRun ? null : visibleCommandNotice;
  const runSafeNextAction = commandNoticeCoveredByRun ? visibleCommandNotice?.safeNextAction : null;
  const stationY = selectedEta * activeDesign.geometry.spanM / 2;
  const stationGeometry = {
    yM: stationY,
    chordM: chordAtY(activeDesign.geometry, stationY),
    twistDeg: activeDesign.geometry.rootTwistDeg + (activeDesign.geometry.tipTwistDeg - activeDesign.geometry.rootTwistDeg) * selectedEta,
  };
  const analysisStation = visualAnalysis ? {
    liftPerSpanNpm: interpolateStationValue(visualAnalysis, selectedEta, 'liftPerSpanNpm'),
    circulationM2s: interpolateStationValue(visualAnalysis, selectedEta, 'circulationM2s'),
    downwashMps: interpolateStationValue(visualAnalysis, selectedEta, 'downwashMps'),
    inducedAngleDeg: interpolateStationValue(visualAnalysis, selectedEta, 'inducedAngleDeg'),
    elasticTwistDeg: interpolateStationValue(visualAnalysis, selectedEta, 'elasticTwistDeg'),
    deflectionM: interpolateStationValue(visualAnalysis, selectedEta, 'deflectionM'),
    yieldRatio: interpolateStationValue(visualAnalysis, selectedEta, 'yieldMargin'),
  } : null;
  const visibleActivities = showAllActivity ? project.activities : project.activities.slice(0, 5);
  const liveMessage = presentation.message
    ?? (standaloneCommandNotice?.kind === 'replay' || standaloneCommandNotice?.kind === 'success'
      ? `${standaloneCommandNotice.message} ${standaloneCommandNotice.safeNextAction}`
      : runningForActive
        ? `Analysis running for ${activeDesign.label} revision ${activeDesign.revision}.`
      : runAlert || standaloneCommandNotice
        ? ''
        : `${immutableState.label}: ${immutableState.detail}`);

  return (
    <main className="app-shell">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</span>
      <ChallengeHeader analysisState={immutableState} activeDesignLabel={activeDesign.label} activeDesignRevision={activeDesign.revision} candidateCount={candidateCount} toolCount={AEROFICIENCY_TOOL_COUNT} siteTools={siteTools} running={runningGlobally} onRun={runAnalysis} onCancel={() => store().cancelAnalysis()} onReset={() => setResetOpen(true)} />

      <nav className="mobile-nav" aria-label="Workspace views">{(['design', 'model', 'results'] as const).map((item) => <button key={item} id={item === 'results' ? 'results-nav-button' : undefined} type="button" aria-pressed={mobileView === item} aria-expanded={item === 'results' ? mobileView === 'results' : undefined} aria-controls={`${item}-workspace-panel`} className={`mobile-view-button view-${item} ${mobileView === item ? 'active' : ''}`} onClick={() => setMobileView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}<span className={`mobile-tools ${siteTools}`} title={siteTools === 'ready' ? `${AEROFICIENCY_TOOL_COUNT} Site Tools ready` : 'Manual UI ready'}><i />{siteTools === 'ready' ? `${AEROFICIENCY_TOOL_COUNT} TOOLS` : 'MANUAL'}</span><button className="mobile-reset" type="button" aria-label="Reset reference case" onClick={() => setResetOpen(true)}>↺</button></nav>

      <section className="workspace" aria-busy={runningGlobally}>
        {(presentation.message || standaloneCommandNotice || runAlert) && <div className="notification-stack">
          {presentation.message && <div className={`presentation-focus ${presentation.focusedPanel}`}><span><strong>{presentation.actor === 'agent' ? 'Agent focus applied' : 'Visible evidence focused'}</strong>{presentation.message}</span><button type="button" aria-label="Dismiss focus message" onClick={() => store().clearPresentationFocus()}>×</button></div>}
          {standaloneCommandNotice && <div className={`command-notice ${standaloneCommandNotice.kind === 'replay' ? 'replay' : standaloneCommandNotice.kind === 'success' ? 'success' : ''} ${standaloneCommandNotice.code === 'REVISION_CONFLICT' ? 'conflict' : ''}`} role={standaloneCommandNotice.kind === 'replay' || standaloneCommandNotice.kind === 'success' ? undefined : 'alert'}><span><strong>{commandNoticeHeading(standaloneCommandNotice)}</strong>Target {commandNoticeTarget}. {standaloneCommandNotice.message} {standaloneCommandNotice.safeNextAction}</span><button type="button" aria-label="Dismiss command notice" onClick={() => store().clearCommandNotice()}>×</button></div>}
          {runAlert && <div className={`command-notice run-outcome ${runAlert.status === 'conflicted' ? 'conflict' : ''}`} role="alert"><span><strong>{runAlert.status === 'not_converged' ? 'Latest run committed · not converged' : runAlert.status === 'conflicted' ? 'Latest run hit a revision conflict' : runAlert.status === 'aborted' ? 'Latest run was aborted' : 'Latest run failed safely'}</strong>Target {runDesign ? `${runDesign.label} (${runDesign.designId})` : runAlert.designId}. Attempted design r{runAlert.designRevision}; current design r{runDesign?.revision ?? 'unavailable'}. {runAlert.message} {runSafeNextAction} {runAlert.hadCurrentAnalysis ? retainedAnalysisCurrent ? 'The retained converged analysis is still current.' : 'A retained prior analysis is now stale.' : 'No current result was replaced.'}</span><div className="run-outcome-actions">{runAlert.hadCurrentAnalysis && retainedAnalysis && runDesign && <button className="button compact" type="button" onClick={() => { store().selectDesign(runDesign.designId); store().clearAnalysisRunOutcome(); }}>{retainedAnalysisCurrent ? 'Show retained current analysis' : 'Show retained prior analysis'}</button>}<button type="button" aria-label="Dismiss run outcome" onClick={() => store().clearAnalysisRunOutcome()}>×</button></div></div>}
        </div>}

        <aside id="design-workspace-panel" className={`side-panel design-panel mobile-${mobileView}`} aria-label="Design definition">
          <div className="panel-title"><div><span className="eyebrow">DESIGN DEFINITION</span><h1>{activeDesign.label}</h1></div></div>
          <div className="variant-list" aria-label="Design variants">{Object.values(project.designs).map((design) => <DesignVariantItem key={design.designId} design={design} active={design.designId === activeDesign.designId} running={runningGlobally} onSelect={() => store().selectDesign(design.designId)} onRename={(label) => store().renameDesign(design.designId, label, 'human')} />)}</div>
          <button className="candidate-button" type="button" onClick={createCandidate}>＋ Create candidate variant</button>
          {activeDesign.kind === 'candidate' && <button className="baseline-button" type="button" disabled={runningGlobally} onClick={setActiveBaseline}>◆ Set active design as Baseline</button>}
          <div className="tab-strip" role="tablist" aria-label="Design editors">{([['geometry', 'Planform'], ['airfoils', 'Airfoils'], ['structure', 'Structure'], ['case', 'Case']] as const).map(([key, label]) => <button key={key} id={`tab-${key}`} type="button" role="tab" tabIndex={editorTab === key ? 0 : -1} aria-selected={editorTab === key} aria-controls={`panel-${key}`} className={editorTab === key ? 'active' : ''} onClick={() => setEditorTab(key)} onKeyDown={(event) => moveTabFocus(event, ['geometry', 'airfoils', 'structure', 'case'] as const, editorTab, setEditorTab, 'tab')}>{label}</button>)}</div>
          <div id="panel-geometry" role="tabpanel" aria-labelledby="tab-geometry" className="editor-panel" hidden={editorTab !== 'geometry'}>
            {editorTab === 'geometry' && <GeometryEditor key={`${activeDesign.designId}-${activeDesign.revision}`} design={activeDesign} editable={editable} changedFields={activeMutationHighlight?.paths ?? []} changedActor={activeMutationHighlight?.actor ?? null} onUpdate={updateGeometry} />}
          </div>
          <div id="panel-airfoils" role="tabpanel" aria-labelledby="tab-airfoils" className="editor-panel" hidden={editorTab !== 'airfoils'}>
            {editorTab === 'airfoils' && <AirfoilEditor key={`${activeDesign.designId}-${activeDesign.revision}`} design={activeDesign} editable={editable} changedFields={activeMutationHighlight?.paths ?? []} changedActor={activeMutationHighlight?.actor ?? null} onUpdate={updateGeometry} />}
          </div>
          <div id="panel-structure" role="tabpanel" aria-labelledby="tab-structure" className="editor-panel" hidden={editorTab !== 'structure'}>
            {editorTab === 'structure' && <StructureEditor key={`${activeDesign.designId}-${activeDesign.revision}`} design={activeDesign} editable={editable} changedFields={activeMutationHighlight?.paths ?? []} changedActor={activeMutationHighlight?.actor ?? null} onUpdate={updateStructure} />}
          </div>
          <div id="panel-case" role="tabpanel" aria-labelledby="tab-case" className="editor-panel" hidden={editorTab !== 'case'}>
            {editorTab === 'case' && <CaseEditor key={project.flightCase.revision} flightCase={project.flightCase} constraints={project.constraints} editable={!runningGlobally} onUpdate={updateAngleSweep} />}
          </div>
        </aside>

        <section id="model-workspace-panel" className={`center-stage mobile-${mobileView}`} aria-label="Engineering model and plots">
          <div className="stage-heading">
            <div><span className="eyebrow">ENGINEERING VIEWPORT</span><h2>{activeDesign.label} · {mode === 'section' ? 'analysis-linked section diagnostic' : mode === 'performance' ? 'Reynolds and drag evidence' : 'linked full-wing evidence'}</h2></div>
            <div className="mode-controls">
              <div className="view-tabs" role="tablist" aria-label="Visualization mode">{VISUALIZATION_TABS.map(([key, label]) => <button key={key} id={`view-tab-${key}`} type="button" role="tab" tabIndex={mode === key ? 0 : -1} aria-selected={mode === key} aria-controls="model-view-panel" className={mode === key ? 'active' : ''} onClick={() => setMode(key)} onKeyDown={(event) => moveTabFocus(event, VISUALIZATION_TABS.map(([tab]) => tab), mode, setMode, 'view-tab')}>{label}</button>)}</div>
              <div className="stage-actions">
                <div className="tablet-stage-actions" aria-label="Workspace actions">
                  <button id="tablet-results-nav-button" className={`tablet-results-button ${mobileView === 'results' ? 'active' : ''}`} type="button" aria-pressed={mobileView === 'results'} aria-expanded={mobileView === 'results'} aria-controls="results-workspace-panel" onClick={() => setMobileView('results')}>Results</button>
                  <span className={`tablet-tools ${siteTools}`} title={siteTools === 'ready' ? `${AEROFICIENCY_TOOL_COUNT} Site Tools ready` : 'Manual UI ready'}><i />{siteTools === 'ready' ? `${AEROFICIENCY_TOOL_COUNT} TOOLS` : 'MANUAL'}</span>
                  <button className="tablet-reset" type="button" aria-label="Reset reference case" onClick={() => setResetOpen(true)}>↺</button>
                </div>
                <button type="button" className={`deform-toggle ${effectiveDeformed ? 'active' : ''}`} aria-pressed={effectiveDeformed} disabled={!visualAnalysis || mode === 'section' || mode === 'performance'} onClick={() => setDeformed((value) => !value)}>{mode === 'section' || mode === 'performance' ? 'Diagnostic view' : effectiveDeformed ? 'Deformed ×6' : 'Undeformed'}</button>
              </div>
            </div>
          </div>
          <div id="model-view-panel" role="tabpanel" aria-labelledby={`view-tab-${mode}`} className={`viewport-card ${mode === 'section' || mode === 'performance' ? 'section-mode' : ''} ${analysis && current && selectedSweepPoint ? 'sweep-active' : ''} ${presentation.focusedPanel === 'station' ? 'agent-focused' : ''}`}>
            <div className={`solver-strip ${runningForActive ? 'running' : immutableState.key}`}><span><i />{runningForActive ? 'SOLVER RUNNING' : immutableState.label}</span>{progressText && <span>{progressText}</span>}{metricAnalysis && <><span>Analysis {metricAnalysis.analysisId}</span><span>r{metricAnalysis.designRevision} · {metricAnalysis.fidelity}</span></>}</div>
            {analysis && current && selectedSweepPoint && <AngleSweepScrubber key={`${analysis.analysisId}-${sweepPresentation?.source === 'snapped' ? `snap-${selectedSweepPoint.alphaDeg}` : 'smooth'}`} analysis={analysis} point={selectedSweepPoint} onSelect={(alphaDeg) => setSweepSelection({ analysisId: analysis.analysisId, alphaDeg })} />}
            {mode === 'section'
              ? <SectionFlowLab design={activeDesign} analysis={visualAnalysis} flightCase={project.flightCase} selectedEta={selectedEta} onSelectEta={(eta) => store().selectEta(eta)} />
              : mode === 'performance'
                ? <PerformanceLab design={activeDesign} analysis={visualAnalysis} flightCase={project.flightCase} selectedEta={selectedEta} onSelectEta={(eta) => store().selectEta(eta)} />
              : <><WingViewport design={activeDesign} baseline={activeDesign.kind === 'candidate' ? baseline : null} analysis={visualAnalysis} mode={mode} deformed={effectiveDeformed} selectedEta={selectedEta} yieldLimit={project.constraints.minYieldMargin} />
                <div id="selected-station-evidence" className="station-readout"><span>SELECTED STATION</span><strong>η {selectedEta.toFixed(3)}</strong><div className="station-inline-scrubber"><input type="range" min="0" max="1" step="0.001" value={selectedEta} onChange={(event) => store().selectEta(Number(event.target.value))} aria-label="Selected span station" aria-valuetext={`eta ${selectedEta.toFixed(3)}`} /></div><b>y {fmt(stationGeometry.yM, 2)} m</b>{mode === 'geometry' ? <><b>c {fmt(stationGeometry.chordM, 2)} m</b><b>twist {fmt(stationGeometry.twistDeg, 2)}°</b></> : mode === 'aero' && analysisStation ? <><b>lift {fmt(analysisStation.liftPerSpanNpm, 0)} N/m</b><b>elastic twist {fmt(analysisStation.elasticTwistDeg, 2)}°</b></> : mode === 'structure' && analysisStation ? <><b>w {fmt(analysisStation.deflectionM, 3)} m</b><b>yield ratio {analysisStation.yieldRatio === null ? '—' : fmt(analysisStation.yieldRatio, 2)}×</b></> : <b>Run a current analysis</b>}</div>
                <SpanwiseCharts mode={mode} design={activeDesign} analysis={visualAnalysis} selectedEta={selectedEta} onSelect={(eta) => store().selectEta(eta)} /></>}
          </div>
        </section>

        <aside id="results-workspace-panel" className={`side-panel results-panel mobile-${mobileView}`} aria-label="Analysis results">
          <div className="panel-title"><div><span className="eyebrow">IMMUTABLE ANALYSIS RESULT</span><h2>{metricAnalysis ? `${activeDesign.label} · ${metricAnalysis.analysisId}` : `${activeDesign.label} · awaiting analysis`}</h2></div><span className={`result-pill ${immutableState.key}`}>{immutableState.label}</span><button className="tablet-results-close" type="button" onClick={() => { setMobileView('model'); window.requestAnimationFrame(() => document.getElementById(window.matchMedia('(min-width: 900px)').matches ? 'tablet-results-nav-button' : 'results-nav-button')?.focus()); }}>Close results</button></div>
          <div className="results-tabs" role="tablist" aria-label="Result sections">{([['overview', 'Overview'], ['checks', 'Checks'], ['compare', 'Compare'], ['log', 'Log']] as const).map(([key, label]) => <button key={key} id={`result-tab-${key}`} type="button" role="tab" tabIndex={resultTab === key ? 0 : -1} aria-selected={resultTab === key} aria-controls={`result-panel-${key}`} className={resultTab === key ? 'active' : ''} onClick={() => setResultTab(key)} onKeyDown={(event) => moveTabFocus(event, ['overview', 'checks', 'compare', 'log'] as const, resultTab, setResultTab, 'result-tab')}>{label}</button>)}</div>
          <div id="result-panel-overview" role="tabpanel" aria-labelledby="result-tab-overview" className="result-tab-panel" hidden={resultTab !== 'overview'}><div className="metrics-grid">
            <MetricCell label="Modeled wing-box wall mass" value={fmt(overviewAnalysis?.metrics.structuralMassKg, 1)} unit="kg" detail={metricAnalysis ? `Analysis r${metricAnalysis.designRevision}` : 'Awaiting analysis'} />
            <MetricCell label="Wake-induced drag estimate" value={fmt(overviewAnalysis?.metrics.inducedDragN, 1)} unit="N" detail={selectedSweepPoint && current ? `${sweepPresentation?.source === 'interpolated' ? 'Interpolated display' : 'Solved'} α ${selectedSweepPoint.alphaDeg.toFixed(2)}° · not total drag` : 'Matched target lift · not total drag'} />
            <MetricCell label="Profile drag estimate" value={fmt(overviewAnalysis?.metrics.profileDragEstimateN, 1)} unit="N" detail={overviewAnalysis?.polarDiagnostics.model === 'user_section_polars' ? 'User SectionPolar tables' : 'Analytic attached-flow estimate'} />
            <MetricCell label="Combined wing drag estimate" value={fmt(overviewAnalysis?.metrics.combinedWingDragEstimateN, 1)} unit="N" detail="Induced + profile · wing only" />
            <MetricCell label="Estimated wing L/D" value={fmt(overviewAnalysis?.metrics.estimatedWingLiftToDrag, 1)} unit="" detail="No fuselage/interference drag" />
            <MetricCell label="Tip deflection" value={fmt(overviewAnalysis?.metrics.tipDeflectionM, 3)} unit="m" detail={`Limit ${project.constraints.maxTipDeflectionM.toFixed(2)} m`} />
            <MetricCell label="Tip elastic twist" value={fmt(overviewAnalysis?.metrics.tipElasticTwistDeg, 2)} unit="deg" detail="Fixed-AoA torsion-coupled" />
            <MetricCell label="Modeled yield ratio" value={fmt(overviewAnalysis?.metrics.minYieldMargin, 2)} unit="×" detail="σy / max(σVM) · not a full FoS" />
            <MetricCell label={selectedSweepPoint && current ? 'Selected AoA' : 'Trim angle'} value={fmt(overviewAnalysis?.metrics.trimmedAlphaDeg, 2)} unit="deg" detail={selectedSweepPoint && metricAnalysis ? `Target-lift trim ${metricAnalysis.metrics.trimmedAlphaDeg.toFixed(2)}°` : `${fmt(metricAnalysis?.metrics.liftN ? metricAnalysis.metrics.liftN / 1000 : null, 1)} kN lift`} />
          </div>{overviewAnalysis && <div className="overview-validity"><span>Polar source</span><strong>{overviewAnalysis.polarDiagnostics.model === 'user_section_polars' ? 'User SectionPolar tables' : 'Analytic attached-flow estimate'}</strong><small>Re {overviewAnalysis.polarDiagnostics.reynoldsRange[0].toExponential(2)} → {overviewAnalysis.polarDiagnostics.reynoldsRange[1].toExponential(2)} · open Efficiency for distributions and range states.</small></div>}</div>

          <div id="result-panel-checks" role="tabpanel" aria-labelledby="result-tab-checks" className="result-tab-panel" hidden={resultTab !== 'checks'}><section className="result-section"><div className="group-heading"><h3>Configured trade-study checks</h3><span className={checkSummary.tone === 'current' ? 'success-text' : ''}>{checkSummary.label}</span></div><div className="constraint-list">{constraints.map((constraint) => <div key={constraint.key}><span className={`constraint-icon ${constraint.state}`} aria-hidden="true">{constraint.state === 'pass' ? '✓' : constraint.state === 'fail' ? '!' : constraint.state === 'stale' ? '↻' : '—'}</span><p><strong>{constraint.label}</strong><small>{constraint.detail}</small></p><b className={constraint.state}><span className="sr-only">Check state: {constraint.state}. </span>{constraint.actual === null ? constraint.state.toUpperCase() : `${fmt(constraint.actual, 2)} ${constraint.unit}`}</b></div>)}</div></section>

          {activeDesign.kind === 'candidate' && <section className={`result-section verdict-card ${verdict.status}`}><div className="group-heading"><h3>Candidate verdict</h3><span>{verdict.status === 'unavailable' ? 'Unavailable' : `${verdict.passedChecks} / 5`}</span></div>{verdict.status === 'unavailable' ? <p>{verdict.reason}</p> : <><h4>{verdict.title}</h4><dl><div><dt>Modeled wall mass</dt><dd>{fmt(verdict.wallMass.referenceKg, 1)} → {fmt(verdict.wallMass.candidateKg, 1)} kg · {verdict.wallMass.deltaPct === null ? 'undefined' : `${signed(verdict.wallMass.deltaPct, 2)}%`}</dd></div><div><dt>Wake-drag estimate</dt><dd>{fmt(verdict.wakeDrag.referenceN, 1)} → {fmt(verdict.wakeDrag.candidateN, 1)} N · {verdict.wakeDrag.deltaPct === null ? 'undefined' : `${signed(verdict.wakeDrag.deltaPct, 3)}%`} · {verdict.wakeDrag.meaning}</dd></div><div><dt>Modeled yield ratio</dt><dd>{fmt(verdict.yieldRatio, 2)}×</dd></div><div><dt>Tip deflection</dt><dd>{fmt(verdict.tipDeflection.actualM, 3)} / {fmt(verdict.tipDeflection.limitM, 2)} m</dd></div></dl><p className="analysis-identity">{verdict.analysis.analysisId} · design r{verdict.analysis.designRevision} · {verdict.analysis.fidelity} · {verdict.analysis.freshness}</p>{verdict.tradeOffSentence && <p className="tradeoff-copy">{verdict.tradeOffSentence}</p>}</>}</section>}
          </div>

          <div id="result-panel-compare" role="tabpanel" aria-labelledby="result-tab-compare" className="result-tab-panel" hidden={resultTab !== 'compare'}><section id="comparison-evidence" className={`result-section comparison-section ${presentation.focusedPanel === 'comparison' ? 'agent-focused' : ''}`}><div className="group-heading"><h3>Baseline comparison</h3><span>{candidateCount === 0 ? 'Candidate required' : pinnedPair ? comparisonCurrent ? 'Exact pinned pair · current' : 'Exact pinned pair · stale' : comparison ? 'Current pair' : comparisonReference && comparisonCandidate ? 'Incompatible pair' : retainedCurrentCandidateAnalysis && !currentCandidateAnalysis ? 'Comparison withheld' : 'Awaiting analyses'}</span></div>{comparison ? <><p className="comparison-ids">Reference {comparisonReference!.analysisId}<br />Candidate {comparisonCandidate!.analysisId}</p><div className="comparison-grid"><div><span>Modeled wall mass</span><strong className={comparisonCurrent && comparison.mass !== null && comparison.mass <= -project.constraints.minMassReductionPct ? 'good' : comparisonCurrent && comparison.mass !== null && comparison.mass > 0 ? 'bad' : ''}>{comparison.mass === null ? 'Not defined' : `${signed(comparison.mass, 2)}%`}</strong></div><div><span>Wake-drag estimate</span><strong className={comparisonCurrent && comparison.dragMeaning === 'improvement' ? 'good' : comparisonCurrent && comparison.dragMeaning === 'worse' ? 'bad' : 'neutral'}>{comparison.drag === null ? 'Not defined' : `${signed(comparison.drag, 3)}% · ${comparison.dragMeaning}`}</strong></div><div><span>Deflection</span><strong>{comparison.deflection === null ? 'Not defined' : `${signed(comparison.deflection, 1)}%`}</strong></div><div><span>Modeled yield ratio</span><strong>{signed(comparison.yieldRatio, 2)}×</strong></div></div>{!comparisonCurrent && <div className="comparison-stale">Pinned values are historical. {comparisonRecovery}</div>}</> : <div className="comparison-empty">{candidateCount === 0 ? 'Create at least one candidate to unlock comparison results. You can continue editing and analysing the Baseline.' : comparisonReference && comparisonCandidate ? 'These analyses use different flight cases, configured checks, fidelity, or solver versions.' : retainedCurrentCandidateAnalysis && !currentCandidateAnalysis ? 'A current candidate analysis is retained but not acknowledged after the latest attempt. Show the retained current analysis before comparing it.' : 'Run current Baseline and candidate analyses with identical settings, then compare their explicit immutable IDs.'}</div>}</section></div>

          <div id="result-panel-log" role="tabpanel" aria-labelledby="result-tab-log" className="result-tab-panel" hidden={resultTab !== 'log'}><section className="result-section"><div className="group-heading"><h3>Warnings & model limitations</h3><span>{warnings.length} disclosed</span></div><ul className="warning-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>

          <section className="result-section activity-section"><div className="group-heading"><h3>Engineering activity</h3><span>{project.activities.length} events</span></div><div className="timeline">{visibleActivities.map((event) => { const changes = Object.entries(event.changedFields); return <div key={event.activityId}><span className={`actor ${event.actor}`}>{event.actor === 'agent' ? 'AI' : event.actor === 'solver' ? '∿' : event.actor === 'human' ? 'YOU' : 'SYS'}</span><p><strong>{event.summary}</strong>{changes.slice(0, 3).map(([path, change]) => <em className="activity-diff" key={path}>{path.replace(/^(geometry|structure)\./, '')}: {String(change.from)} → {String(change.to)} {change.unit ?? ''}</em>)}{changes.length > 3 && <details className="activity-details"><summary>+{changes.length - 3} more change{changes.length - 3 === 1 ? '' : 's'}</summary>{changes.slice(3).map(([path, change]) => <em className="activity-diff" key={path}>{path.replace(/^(geometry|structure)\./, '')}: {String(change.from)} → {String(change.to)} {change.unit ?? ''}</em>)}</details>}<small>{event.actor} · r{event.fromRevision ?? '—'} → r{event.toRevision ?? '—'} · {event.timestamp.slice(11, 16)} UTC</small></p></div>; })}</div>{project.activities.length > 5 && <button className="activity-toggle" type="button" aria-expanded={showAllActivity} onClick={() => setShowAllActivity((value) => !value)}>{showAllActivity ? 'Show recent activity' : `View all ${project.activities.length} events`}</button>}</section>
          </div>
        </aside>
      </section>

      <footer className="statusbar"><span><i />{runningGlobally ? 'Solver running' : 'Model ready'}</span><span>Solver <strong>{RELEASE_IDENTITY.solverVersion}</strong></span><span>Tool schema <strong>{RELEASE_IDENTITY.toolSchemaVersion}</strong></span><span>Build <strong>{RELEASE_IDENTITY.buildCommit}</strong></span><span className="spacer" /><span>Preliminary · aerospace education & early fixed-wing concepts · not for certification · SI units</span></footer>

      {resetOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}><section ref={resetDialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><span className="dialog-icon" aria-hidden="true">↺</span><h2 id="reset-title">Reset reference case?</h2><p id="reset-description">Candidate history and analyses will return to the deterministic starting state. Any running analysis will be cancelled. This local action cannot be undone.</p><div><button type="button" className="button quiet" onClick={() => setResetOpen(false)}>Cancel</button><button type="button" className="button danger" onClick={() => { store().resetDemo(); setResetOpen(false); }}>Reset reference case</button></div></section></div>}
    </main>
  );
}
