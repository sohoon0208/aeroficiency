'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { analysisIsCurrent } from '@/lib/domain/commands';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { interpolateStationValue } from '@/lib/domain/stations';
import type { AnalysisSnapshot, ConstraintResult, WingGeometry, WingStructure } from '@/lib/domain/types';
import { CaseEditor, GeometryEditor, StructureEditor } from '@/components/design/Editors';
import { SpanwiseCharts } from '@/components/charts/SpanwiseCharts';
import { WingViewport, type ViewMode } from '@/components/viewport/WingViewport';
import { useProjectStore } from '@/store/projectStore';
import { registerAerociencySiteTools } from '@/webmcp/registerSiteTools';
import { chordAtY } from '@/lib/solver/planform';

type EditorTab = 'geometry' | 'structure' | 'case';
type MobileView = 'design' | 'model' | 'results';

const fmt = (value: number | null | undefined, digits = 2) => value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${fmt(value, digits)}`;
const FALLBACK_WARNINGS = [
  'Preliminary low-order analysis; not for certification.',
  'Profile drag and stall are omitted.',
  'Buckling, fatigue, and local failure modes are omitted.',
];

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

function resultState(analysis: AnalysisSnapshot | null, current: boolean, running: boolean) {
  if (running) return { key: 'running', label: 'RUNNING', detail: 'Solving aeroelastic equilibrium' };
  if (!analysis) return { key: 'unavailable', label: 'NO ANALYSIS', detail: 'Run the solver to evaluate this revision.' };
  if (analysis.status !== 'converged') return { key: 'failed', label: 'NOT CONVERGED', detail: 'Constraints are unavailable.' };
  if (!current) return { key: 'stale', label: 'STALE', detail: 'Inputs changed after this analysis.' };
  return { key: 'current', label: 'CURRENT', detail: `Converged in ${analysis.convergence.iterations} iterations.` };
}

function emptyConstraints(): ConstraintResult[] {
  return [
    ['mass_reduction', 'Structural mass reduction', '%'], ['yield_margin', 'Modeled yield margin', '×'], ['tip_deflection', 'Tip deflection', 'm'], ['induced_drag', 'Induced drag increase', '%'], ['convergence', 'Aeroelastic convergence', ''],
  ].map(([key, label, unit]) => ({ key: key as ConstraintResult['key'], label, unit, state: 'unavailable', actual: null, limit: null, detail: 'No current analysis for this revision.' }));
}

function MetricCell({ label, value, unit, detail }: { label: string; value: string; unit: string; detail: string }) {
  return <article className="metric-cell"><span>{label}</span><p><strong>{value}</strong><small>{unit}</small></p><b>{detail}</b></article>;
}

export function AerociencyWorkspace() {
  const project = useProjectStore((state) => state.project);
  const analysisRun = useProjectStore((state) => state.analysisRun);
  const siteTools = useProjectStore((state) => state.siteTools);
  const mutationHighlight = useProjectStore((state) => state.mutationHighlight);
  const commandNotice = useProjectStore((state) => state.commandNotice);
  const store = useProjectStore.getState;
  const [editorTab, setEditorTab] = useState<EditorTab>('geometry');
  const [mode, setMode] = useState<ViewMode>('geometry');
  const [deformed, setDeformed] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>('model');
  const [resetOpen, setResetOpen] = useState(false);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const dialogRef = useRef<HTMLElement>(null);

  const activeDesign = project.designs[project.activeDesignId];
  const baseline = Object.values(project.designs).find((design) => design.kind === 'baseline') ?? null;
  const selectedAnalysisId = project.selectedAnalysisId ?? activeDesign.latestAnalysisId;
  const analysis = selectedAnalysisId ? project.analyses[selectedAnalysisId] ?? null : null;
  const current = Boolean(analysis && analysisIsCurrent(project, analysis.analysisId));
  const runningGlobally = analysisRun.status === 'running';
  const runningForActive = runningGlobally && analysisRun.designId === activeDesign.designId;
  const state = resultState(analysis, current, runningForActive);
  const editable = activeDesign.kind === 'candidate';
  const activeMutationHighlight = mutationHighlight?.designId === activeDesign.designId ? mutationHighlight : null;
  const visibleCommandNotice = !commandNotice || commandNotice.designId === null || commandNotice.designId === activeDesign.designId ? commandNotice : null;
  const baselineAnalysis = baseline?.latestAnalysisId && analysisIsCurrent(project, baseline.latestAnalysisId) ? project.analyses[baseline.latestAnalysisId] : null;
  const candidateAnalysis = activeDesign.kind === 'candidate' && activeDesign.latestAnalysisId && analysisIsCurrent(project, activeDesign.latestAnalysisId) ? project.analyses[activeDesign.latestAnalysisId] : null;

  useEffect(() => registerAerociencySiteTools(), []);
  useEffect(() => {
    if (!mutationHighlight) return;
    const timer = window.setTimeout(() => useProjectStore.getState().clearMutationHighlight(), 10_000);
    return () => window.clearTimeout(timer);
  }, [mutationHighlight]);

  useEffect(() => {
    if (!resetOpen) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
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
    const liveStore = useProjectStore.getState();
    if (liveStore.analysisRun.status === 'running') return;
    const latest = liveStore.project;
    const design = latest.designs[latest.activeDesignId];
    void useProjectStore.getState().runAnalysis({
      designId: design.designId,
      expectedDesignRevision: design.revision,
      expectedFlightCaseRevision: latest.flightCase.revision,
      expectedConstraintsRevision: latest.constraints.revision,
      idempotencyKey: createIdempotencyKey(),
      fidelity: 'standard',
    }, 'human');
  };

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.defaultPrevented && !resetOpen && (event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); runAnalysis(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [resetOpen]);

  const createCandidate = () => {
    const candidates = Object.values(project.designs).filter((design) => design.kind === 'candidate').length;
    const source = activeDesign;
    useProjectStore.getState().createCandidate(source.designId, `Candidate ${String.fromCharCode(65 + candidates)}`, 'human');
  };
  const updateGeometry = (patch: Partial<WingGeometry>) => useProjectStore.getState().updateGeometry(activeDesign.designId, patch, 'human');
  const updateStructure = (patch: Partial<WingStructure>) => useProjectStore.getState().updateStructure(activeDesign.designId, patch, 'human');
  const displayAnalysis = analysis?.status === 'converged' && current ? analysis : null;
  const constraints = analysis ? analysis.constraints.map((constraint) => current ? constraint : { ...constraint, state: analysis.status === 'converged' ? 'stale' as const : 'unavailable' as const }) : emptyConstraints();
  const passed = constraints.filter((constraint) => constraint.state === 'pass').length;

  const comparison = useMemo(() => {
    if (!baselineAnalysis || !candidateAnalysis) return null;
    if (baselineAnalysis.flightCaseRevision !== candidateAnalysis.flightCaseRevision
      || baselineAnalysis.fidelity !== candidateAnalysis.fidelity
      || baselineAnalysis.solverVersion !== candidateAnalysis.solverVersion) return null;
    const percent = (candidate: number, reference: number) => reference === 0 ? null : 100 * (candidate - reference) / reference;
    return {
      mass: percent(candidateAnalysis.metrics.structuralMassKg, baselineAnalysis.metrics.structuralMassKg),
      drag: percent(candidateAnalysis.metrics.inducedDragN, baselineAnalysis.metrics.inducedDragN),
      deflection: percent(candidateAnalysis.metrics.tipDeflectionM, baselineAnalysis.metrics.tipDeflectionM),
      margin: candidateAnalysis.metrics.minYieldMargin - baselineAnalysis.metrics.minYieldMargin,
    };
  }, [baselineAnalysis, candidateAnalysis]);
  const comparisonIncompatible = Boolean(
    baselineAnalysis
    && candidateAnalysis
    && (baselineAnalysis.flightCaseRevision !== candidateAnalysis.flightCaseRevision
      || baselineAnalysis.fidelity !== candidateAnalysis.fidelity
      || baselineAnalysis.solverVersion !== candidateAnalysis.solverVersion),
  );

  const toolCopy = siteTools === 'ready' ? 'Site Tools ready' : siteTools === 'checking' ? 'Checking Site Tools' : siteTools === 'error' ? 'Site Tools error · Manual UI ready' : 'Site Tools unavailable · Manual UI ready';
  const progressText = runningForActive && analysisRun.progress ? `${analysisRun.progress.phase} · iteration ${analysisRun.progress.iteration} of ${analysisRun.progress.maxIterations}` : state.detail;
  const effectiveDeformed = Boolean(deformed && displayAnalysis);
  const warnings = analysis?.warnings ?? FALLBACK_WARNINGS;
  const runAlert = analysisRun.status !== 'idle' && analysisRun.status !== 'running' && analysisRun.status !== 'succeeded' && analysisRun.designId === activeDesign.designId ? analysisRun : null;
  const stationY = project.selectedEta * activeDesign.geometry.spanM / 2;
  const stationGeometry = {
    yM: stationY,
    chordM: chordAtY(activeDesign.geometry, stationY),
    twistDeg: activeDesign.geometry.rootTwistDeg + (activeDesign.geometry.tipTwistDeg - activeDesign.geometry.rootTwistDeg) * project.selectedEta,
  };
  const analysisStation = displayAnalysis ? {
    yM: stationY,
    liftPerSpanNpm: interpolateStationValue(displayAnalysis, project.selectedEta, 'liftPerSpanNpm'),
    elasticTwistDeg: interpolateStationValue(displayAnalysis, project.selectedEta, 'elasticTwistDeg'),
    deflectionM: interpolateStationValue(displayAnalysis, project.selectedEta, 'deflectionM'),
    yieldMargin: interpolateStationValue(displayAnalysis, project.selectedEta, 'yieldMargin'),
  } : null;
  const visibleActivities = showAllActivity ? project.activities : project.activities.slice(0, 5);
  const liveMessage = runningForActive
    ? `Analysis running: ${analysisRun.progress?.phase ?? 'starting'}.`
    : runAlert ? `${runAlert.status}: ${runAlert.message}` : `${state.label}: ${state.detail}`;

  return (
    <main className="app-shell">
      <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{liveMessage}</span>
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true"><span /></span><div><p>AEROCIENCY</p><small>PRELIMINARY DESIGN</small></div></div>
        <div className="project-identity"><span>Demo wing / Target-lift case</span><strong>{activeDesign.label} · r{activeDesign.revision}</strong><b className={state.key}>{state.label}</b></div>
        <div className="top-actions"><span className={`tools-status ${siteTools}`}><i />{toolCopy}</span><button className="button quiet" type="button" onClick={() => setResetOpen(true)}>Reset demo</button>{runningGlobally && <button className="button cancel-run" type="button" onClick={() => store().cancelAnalysis()}>Cancel</button>}<button className="button primary" type="button" disabled={runningGlobally} onClick={runAnalysis}>{runningGlobally ? 'Solving…' : 'Run analysis'}</button></div>
      </header>

      <nav className="mobile-nav" aria-label="Workspace views">{(['design', 'model', 'results'] as const).map((item) => <button key={item} id={item === 'results' ? 'results-nav-button' : undefined} type="button" aria-pressed={mobileView === item} aria-expanded={item === 'results' ? mobileView === 'results' : undefined} aria-controls={`${item}-workspace-panel`} className={`mobile-view-button view-${item} ${mobileView === item ? 'active' : ''}`} onClick={() => setMobileView(item)}>{item[0].toUpperCase() + item.slice(1)}</button>)}<span className={`mobile-tools ${siteTools}`} title={toolCopy}><i />{siteTools === 'ready' ? 'TOOLS' : 'MANUAL'}</span><button className="mobile-reset" type="button" aria-label="Reset demo" onClick={() => setResetOpen(true)}>↺</button></nav>

      <section className="workspace" aria-busy={runningGlobally}>
        {visibleCommandNotice && <div className={`command-notice ${visibleCommandNotice.code === 'REVISION_CONFLICT' ? 'conflict' : ''}`} role="alert"><span><strong>{visibleCommandNotice.code === 'REVISION_CONFLICT' ? 'Revision conflict' : 'Command rejected safely'}</strong>{visibleCommandNotice.message} {visibleCommandNotice.safeNextAction}</span><button type="button" aria-label="Dismiss command notice" onClick={() => store().clearCommandNotice()}>×</button></div>}
        <aside id="design-workspace-panel" className={`side-panel design-panel mobile-${mobileView}`} aria-label="Design definition">
          <div className="panel-title"><div><span className="eyebrow">DESIGN DEFINITION</span><h1>{activeDesign.label}</h1></div><span className={`design-badge ${activeDesign.kind}`}>{activeDesign.kind === 'baseline' ? 'PROTECTED' : `EDITABLE · r${activeDesign.revision}`}</span></div>
          <div className="variant-list" aria-label="Design variants">{Object.values(project.designs).map((design) => <button key={design.designId} type="button" className={design.designId === activeDesign.designId ? 'active' : ''} onClick={() => useProjectStore.getState().selectDesign(design.designId)}><span aria-hidden="true">{design.kind === 'baseline' ? '◆' : '◇'}</span><p><strong>{design.label}</strong><small>Revision {design.revision} · {design.kind === 'baseline' ? 'Protected' : 'Candidate'}</small></p>{design.designId === activeDesign.designId && <b>ACTIVE</b>}</button>)}</div>
          <button className="candidate-button" type="button" onClick={createCandidate}>＋ Create candidate variant</button>
          <div className="tab-strip" role="tablist" aria-label="Design editors">{([['geometry', 'Geometry'], ['structure', 'Structure'], ['case', 'Case & limits']] as const).map(([key, label]) => <button key={key} id={`tab-${key}`} type="button" role="tab" tabIndex={editorTab === key ? 0 : -1} aria-selected={editorTab === key} aria-controls={`panel-${key}`} className={editorTab === key ? 'active' : ''} onClick={() => setEditorTab(key)} onKeyDown={(event) => moveTabFocus(event, ['geometry', 'structure', 'case'] as const, editorTab, setEditorTab, 'tab')}>{label}</button>)}</div>
          <div id={`panel-${editorTab}`} role="tabpanel" aria-labelledby={`tab-${editorTab}`} className="editor-panel">
            {editorTab === 'geometry' && <GeometryEditor key={`${activeDesign.designId}-${activeDesign.revision}`} design={activeDesign} editable={editable} changedFields={activeMutationHighlight?.paths ?? []} changedActor={activeMutationHighlight?.actor ?? null} onUpdate={updateGeometry} />}
            {editorTab === 'structure' && <StructureEditor key={`${activeDesign.designId}-${activeDesign.revision}`} design={activeDesign} editable={editable} changedFields={activeMutationHighlight?.paths ?? []} changedActor={activeMutationHighlight?.actor ?? null} onUpdate={updateStructure} />}
            {editorTab === 'case' && <CaseEditor flightCase={project.flightCase} constraints={project.constraints} />}
          </div>
        </aside>

        <section id="model-workspace-panel" className={`center-stage mobile-${mobileView}`} aria-label="Engineering model and plots">
          <div className="stage-heading"><div><span className="eyebrow">ENGINEERING VIEWPORT</span><h2>{activeDesign.label} · right-semispan-linked model</h2></div><div className="mode-controls"><div className="view-tabs" role="tablist" aria-label="Visualization mode">{([['geometry', 'Geometry'], ['aero', 'Aero loads'], ['structure', 'Structure']] as const).map(([key, label]) => <button key={key} id={`view-tab-${key}`} type="button" role="tab" tabIndex={mode === key ? 0 : -1} aria-selected={mode === key} aria-controls="model-view-panel" className={mode === key ? 'active' : ''} onClick={() => setMode(key)} onKeyDown={(event) => moveTabFocus(event, ['geometry', 'aero', 'structure'] as const, mode, setMode, 'view-tab')}>{label}</button>)}</div><button type="button" className={`deform-toggle ${effectiveDeformed ? 'active' : ''}`} aria-pressed={effectiveDeformed} disabled={!displayAnalysis} onClick={() => setDeformed((value) => !value)}>{effectiveDeformed ? 'Deformed ×6' : 'Undeformed'}</button></div></div>
          <div id="model-view-panel" role="tabpanel" aria-labelledby={`view-tab-${mode}`} className="viewport-card">
            <div className={`solver-strip ${state.key}`}><span><i />{state.label}</span><span>{progressText}</span>{displayAnalysis && <><span>α {fmt(displayAnalysis.metrics.trimmedAlphaDeg, 2)}°</span><span>{displayAnalysis.analysisId.slice(0, 12)}…</span></>}</div>
            <WingViewport design={activeDesign} baseline={activeDesign.kind === 'candidate' ? baseline : null} analysis={displayAnalysis} mode={mode} deformed={effectiveDeformed} selectedEta={project.selectedEta} yieldLimit={project.constraints.minYieldMargin} />
            <div className="station-readout"><span>SELECTED STATION</span><strong>η {project.selectedEta.toFixed(3)}</strong><b>y {fmt(stationGeometry.yM, 2)} m</b>{mode === 'geometry' ? <><b>c {fmt(stationGeometry.chordM, 2)} m</b><b>twist {fmt(stationGeometry.twistDeg, 2)}°</b></> : mode === 'aero' && analysisStation ? <><b>lift {fmt(analysisStation.liftPerSpanNpm, 0)} N/m</b><b>elastic twist {fmt(analysisStation.elasticTwistDeg, 2)}°</b></> : mode === 'structure' && analysisStation ? <><b>w {fmt(analysisStation.deflectionM, 3)} m</b><b>margin {analysisStation.yieldMargin === null ? '—' : fmt(analysisStation.yieldMargin, 2)}×</b></> : <b>Run a current analysis</b>}</div>
            <SpanwiseCharts mode={mode} design={activeDesign} analysis={displayAnalysis} selectedEta={project.selectedEta} onSelect={(eta) => useProjectStore.getState().selectEta(eta)} />
          </div>
        </section>

        <aside id="results-workspace-panel" className={`side-panel results-panel mobile-${mobileView}`} aria-label="Analysis results">
          <div className="panel-title"><div><span className="eyebrow">ANALYSIS RESULT</span><h2>{analysis ? `${activeDesign.label} · ${analysis.analysisId.slice(-6)}` : `${activeDesign.label} · no result`}</h2></div><span className={`result-pill ${state.key}`}>{state.label}</span><button className="tablet-results-close" type="button" onClick={() => { setMobileView('model'); window.requestAnimationFrame(() => document.getElementById('results-nav-button')?.focus()); }}>Close results</button></div>
          {runAlert && <div className="run-alert" role="alert"><strong>{runAlert.status === 'not_converged' ? 'Analysis committed · not converged' : runAlert.status === 'conflicted' ? 'Revision conflict' : runAlert.status === 'aborted' ? 'Analysis aborted' : 'Analysis failed safely'}</strong><span>{runAlert.status === 'not_converged' ? `${runAlert.message} The diagnostic snapshot is available, but constraints are unavailable.${runAlert.hadCurrentAnalysis ? ' The previous current result remains the design reference.' : ''}` : `${runAlert.message} ${runAlert.hadCurrentAnalysis ? 'The previous current result was preserved.' : 'No result was committed.'}`}</span></div>}
          <div className="metrics-grid">
            <MetricCell label="Structural mass" value={fmt(displayAnalysis?.metrics.structuralMassKg, 1)} unit="kg" detail="Full wing box" />
            <MetricCell label="Induced drag" value={fmt(displayAnalysis?.metrics.inducedDragN, 1)} unit="N" detail="Matched target lift" />
            <MetricCell label="Tip deflection" value={fmt(displayAnalysis?.metrics.tipDeflectionM, 3)} unit="m" detail={`Limit ${project.constraints.maxTipDeflectionM.toFixed(2)} m`} />
            <MetricCell label="Tip elastic twist" value={fmt(displayAnalysis?.metrics.tipElasticTwistDeg, 2)} unit="deg" detail="Torsion-coupled" />
            <MetricCell label="Modeled yield margin" value={fmt(displayAnalysis?.metrics.minYieldMargin, 2)} unit="×" detail="Buckling omitted" />
            <MetricCell label="Trim angle" value={fmt(displayAnalysis?.metrics.trimmedAlphaDeg, 2)} unit="deg" detail={`${fmt(displayAnalysis?.metrics.liftN ? displayAnalysis.metrics.liftN / 1000 : null, 1)} kN lift`} />
          </div>

          <section className="result-section"><div className="group-heading"><h3>Design constraints</h3><span className={passed === constraints.length ? 'success-text' : ''}>{passed} / {constraints.length} pass</span></div><div className="constraint-list">{constraints.map((constraint) => <div key={constraint.key}><span className={`constraint-icon ${constraint.state}`} aria-hidden="true">{constraint.state === 'pass' ? '✓' : constraint.state === 'fail' ? '!' : constraint.state === 'stale' ? '↻' : '—'}</span><p><strong>{constraint.label}</strong><small>{constraint.detail}</small></p><b className={constraint.state}>{constraint.actual === null ? constraint.state.toUpperCase() : `${fmt(constraint.actual, 2)} ${constraint.unit}`}</b></div>)}</div></section>

          <section className="result-section"><div className="group-heading"><h3>Baseline comparison</h3><span>{comparison ? 'Current snapshots' : comparisonIncompatible ? 'Incompatible analyses' : 'Awaiting analyses'}</span></div>{comparison ? <div className="comparison-grid"><div><span>Mass</span><strong className={comparison.mass === null ? '' : comparison.mass <= 0 ? 'good' : 'bad'}>{comparison.mass === null ? 'Not defined' : `${signed(comparison.mass)}%`}</strong></div><div><span>Induced drag</span><strong className={comparison.drag === null ? '' : comparison.drag <= 0 ? 'good' : 'bad'}>{comparison.drag === null ? 'Not defined' : `${signed(comparison.drag, 2)}%`}</strong></div><div><span>Deflection</span><strong>{comparison.deflection === null ? 'Not defined' : `${signed(comparison.deflection)}%`}</strong></div><div><span>Yield margin</span><strong>{signed(comparison.margin, 2)}×</strong></div></div> : <div className="comparison-empty">{comparisonIncompatible ? 'Current analyses use different flight cases, fidelity, or solver versions. Run both designs with identical settings before comparing.' : 'Run current baseline and candidate analyses with Standard fidelity to compare immutable results.'}</div>}</section>

          <section className="result-section"><div className="group-heading"><h3>Warnings & limitations</h3><span>{warnings.length} disclosed</span></div><ul className="warning-list">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></section>

          <section className="result-section activity-section"><div className="group-heading"><h3>Workspace activity</h3><span>{project.activities.length} events</span></div><div className="timeline">{visibleActivities.map((event) => {
            const changes = Object.entries(event.changedFields);
            return <div key={event.activityId}><span className={`actor ${event.actor}`}>{event.actor === 'agent' ? 'AI' : event.actor === 'solver' ? '∿' : event.actor === 'human' ? 'YOU' : 'SYS'}</span><p><strong>{event.summary}</strong>{changes.slice(0, 3).map(([path, change]) => <em className="activity-diff" key={path}>{path.replace(/^(geometry|structure)\./, '')}: {String(change.from)} → {String(change.to)} {change.unit ?? ''}</em>)}{changes.length > 3 && <details className="activity-details"><summary>+{changes.length - 3} more change{changes.length - 3 === 1 ? '' : 's'}</summary>{changes.slice(3).map(([path, change]) => <em className="activity-diff" key={path}>{path.replace(/^(geometry|structure)\./, '')}: {String(change.from)} → {String(change.to)} {change.unit ?? ''}</em>)}</details>}<small>{event.actor} · r{event.fromRevision ?? '—'} → r{event.toRevision ?? '—'} · {event.timestamp.slice(11, 16)} UTC</small></p></div>;
          })}</div>{project.activities.length > 5 && <button className="activity-toggle" type="button" aria-expanded={showAllActivity} onClick={() => setShowAllActivity((value) => !value)}>{showAllActivity ? 'Show recent activity' : `View all ${project.activities.length} events`}</button>}</section>
        </aside>
      </section>

      <footer className="statusbar"><span><i />{runningGlobally ? 'Solver running' : 'Model ready'}</span><span>Solver <strong>{project.solverVersion} · Standard</strong></span><span>Fingerprint <strong>{displayAnalysis?.inputFingerprint.slice(3, 15) ?? 'not current'}</strong></span><span className="spacer" /><span>Preliminary low-order analysis · Not for certification · SI units</span></footer>

      {resetOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}><section ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-description"><span className="dialog-icon" aria-hidden="true">↺</span><h2 id="reset-title">Reset demo project?</h2><p id="reset-description">Candidate history and analyses will return to the deterministic starting state. Any running analysis will be cancelled. This local action cannot be undone.</p><div><button type="button" className="button quiet" onClick={() => setResetOpen(false)}>Cancel</button><button type="button" className="button danger" onClick={() => { store().resetDemo(); setResetOpen(false); }}>Reset project</button></div></section></div>}
    </main>
  );
}
