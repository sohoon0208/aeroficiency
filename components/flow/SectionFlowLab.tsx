'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisSnapshot, FlightCase, WingDesign } from '@/lib/domain/types';
import {
  sampleSectionVelocityVectors,
  sectionPointToWindAxes,
  solveAirfoilSectionPotentialFlow,
  traceSectionStreamlines,
  type Point2,
  type SectionPotentialFlowSolution,
} from '@/lib/solver/panel2d';
import { localAirfoilSection } from '@/lib/solver/airfoilSections';
import { evaluateSectionPolar } from '@/lib/solver/polars';
import { deriveSectionCondition } from '@/lib/visualization/sectionFlow';

const format = (value: number, digits = 3) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function pointsAttribute(points: readonly Point2[], x: (value: number) => number, z: (value: number) => number) {
  return points.map((point) => `${x(point.x)},${z(point.z)}`).join(' ');
}

const SectionFlowField = memo(function SectionFlowField({ solution, sectionLabel, interactive }: { solution: SectionPotentialFlowSolution; sectionLabel: string; interactive: boolean }) {
  const width = 660;
  const height = 270;
  const xMinimum = -0.58;
  const xMaximum = 1.72;
  const zMinimum = -0.62;
  const zMaximum = 0.62;
  const x = (value: number) => 22 + (value - xMinimum) / (xMaximum - xMinimum) * (width - 42);
  const z = (value: number) => 12 + (zMaximum - value) / (zMaximum - zMinimum) * (height - 32);
  const lines = useMemo(() => traceSectionStreamlines(solution, interactive ? 9 : 17, interactive ? 240 : 420), [interactive, solution]);
  const vectors = useMemo(() => sampleSectionVelocityVectors(solution), [solution]);
  const outline = [...solution.panels.map((panel) => panel.start), solution.panels.at(-1)!.end]
    .map((point) => sectionPointToWindAxes(point, solution.incidenceDeg));
  const leadingEdge = sectionPointToWindAxes({ x: 0, z: 0 }, solution.incidenceDeg);
  const trailingEdge = sectionPointToWindAxes({ x: 1, z: 0 }, solution.incidenceDeg);
  const stagnation = sectionPointToWindAxes({ x: solution.stagnation.xOverC, z: solution.stagnation.zOverC }, solution.incidenceDeg);
  return (
    <figure className="section-figure flow-field-figure">
      <figcaption><strong>Inviscid attached-flow streamlines</strong><span>Wind axes · horizontal U∞ · adaptive integration</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" data-reference-frame="wind" data-incidence-deg={solution.incidenceDeg.toFixed(6)} data-panel-count={solution.panels.length} data-live-preview={interactive ? 'true' : 'false'} aria-label={`Wind-axis inviscid attached-flow streamlines and local velocity vectors around ${sectionLabel} with the airfoil at ${solution.incidenceDeg.toFixed(2)} degrees local incidence`}>
        <defs><marker id="section-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
        {[0, 0.5, 1].map((value) => <line key={`x-${value}`} className="section-grid" x1={x(value)} x2={x(value)} y1="10" y2={height - 20} />)}
        {[-0.4, 0, 0.4].map((value) => <line key={`z-${value}`} className="section-grid" x1="20" x2={width - 20} y1={z(value)} y2={z(value)} />)}
        {lines.map((line) => <polyline key={line.id} className="section-streamline" points={pointsAttribute(line.points, x, z)} />)}
        {vectors.map(({ point, velocity }, index) => {
          const magnitude = Math.max(Math.hypot(velocity.x, velocity.z), 1e-9);
          const scale = 0.055;
          return <line key={`vector-${index}`} className="section-vector" x1={x(point.x)} y1={z(point.z)} x2={x(point.x + scale * velocity.x / magnitude)} y2={z(point.z + scale * velocity.z / magnitude)} markerEnd="url(#section-arrow)" />;
        })}
        <line className="section-chord-reference" x1={x(leadingEdge.x)} y1={z(leadingEdge.z)} x2={x(trailingEdge.x)} y2={z(trailingEdge.z)} />
        <polygon className="section-airfoil" points={pointsAttribute(outline, x, z)} />
        <circle className="stagnation-point" cx={x(stagnation.x)} cy={z(stagnation.z)} r="4" />
        <line className="section-freestream-reference" x1={x(-0.38)} y1={z(0.53)} x2={x(-0.04)} y2={z(0.53)} markerEnd="url(#section-arrow)" />
        <text className="section-flow-label" x={x(-0.38)} y={z(0.53) - 7}>U∞ · WIND AXIS</text>
        <text className="section-angle-label" textAnchor="end" x={width - 16} y="24">LOCAL α {solution.incidenceDeg.toFixed(2)}°</text>
        <text className="section-point-label" textAnchor="end" x={x(leadingEdge.x) - 5} y={z(leadingEdge.z) - 6}>LE</text>
        <text className="section-point-label" x={x(trailingEdge.x) + 5} y={z(trailingEdge.z) - 6}>TE</text>
      </svg>
      <div className="section-legend"><span><i className="legend-stream" />Streamline</span><span><i className="legend-vector" />Velocity direction</span><span><i className="legend-chord" />Chord / AoA attitude</span><span><i className="legend-stagnation" />Approx. surface stagnation</span></div>
    </figure>
  );
});

const CpPlot = memo(function CpPlot({ solution, sectionLabel }: { solution: SectionPotentialFlowSolution; sectionLabel: string }) {
  const width = 660;
  const height = 240;
  const upper = solution.surface.filter((point) => point.surface === 'upper').sort((a, b) => a.xOverC - b.xOverC);
  const lower = solution.surface.filter((point) => point.surface === 'lower').sort((a, b) => a.xOverC - b.xOverC);
  const values = solution.surface.map((point) => point.cp);
  const minimum = Math.min(-0.25, ...values);
  const maximum = Math.max(1, ...values);
  const padding = Math.max(0.08, (maximum - minimum) * 0.08);
  const low = minimum - padding;
  const high = maximum + padding;
  const x = (value: number) => 50 + value * (width - 72);
  /** Aerodynamic convention: more-negative Cp is drawn higher. */
  const y = (value: number) => 12 + (value - low) / (high - low) * (height - 42);
  return (
    <figure className="section-figure cp-figure">
      <figcaption><strong>Surface pressure coefficient</strong><span>−Cp upward · pressure diagnostic only</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Upper and lower surface pressure coefficient for ${sectionLabel}`}>
        {[0, 0.5, 1].map((value) => <line key={`x-${value}`} className="section-grid" x1={x(value)} x2={x(value)} y1="10" y2={height - 28} />)}
        {[low, (low + high) / 2, high].map((value) => <g key={`cp-${value}`}><line className="section-grid" x1="48" x2={width - 18} y1={y(value)} y2={y(value)} /><text x="3" y={y(value) + 3}>{value.toFixed(2)}</text></g>)}
        <polyline className="cp-upper" points={upper.map((point) => `${x(point.xOverC)},${y(point.cp)}`).join(' ')} />
        <polyline className="cp-lower" points={lower.map((point) => `${x(point.xOverC)},${y(point.cp)}`).join(' ')} />
        <text x={x(0)} y={height - 8}>LE · x/c 0</text><text textAnchor="end" x={x(1)} y={height - 8}>TE · x/c 1</text>
      </svg>
      <div className="section-legend"><span><i className="legend-upper" />Upper surface</span><span><i className="legend-lower" />Lower surface</span></div>
    </figure>
  );
});

export function SectionFlowLab({
  design,
  analysis,
  flightCase,
  selectedEta,
  onSelectEta,
  interactive = false,
}: {
  design: WingDesign;
  analysis: AnalysisSnapshot | null;
  flightCase: FlightCase;
  selectedEta: number;
  onSelectEta: (eta: number) => void;
  interactive?: boolean;
}) {
  const [panelCount, setPanelCount] = useState(120);
  const [stationDraftEta, setStationDraftEta] = useState(selectedEta);
  const [stationCalculationEta, setStationCalculationEta] = useState(selectedEta);
  const [stationInteracting, setStationInteracting] = useState(false);
  const stationDraftRef = useRef(selectedEta);
  const stationInteractingRef = useRef(false);
  const pendingPreviewEtaRef = useRef<number | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const lastPreviewAtRef = useRef(Number.NEGATIVE_INFINITY);
  const lastHandledEtaRef = useRef<number | null>(null);
  const onSelectEtaRef = useRef(onSelectEta);
  const previewIntervalMs = 1000 / 30;

  useEffect(() => { onSelectEtaRef.current = onSelectEta; }, [onSelectEta]);
  useEffect(() => {
    if (stationInteractingRef.current) {
      // Station drags are intentionally local. A different incoming value therefore
      // represents an authoritative external update and must cancel the local draft.
      if (Math.abs(selectedEta - stationDraftRef.current) > 1e-9) {
        stationInteractingRef.current = false;
        setStationInteracting(false);
        if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current);
        previewFrameRef.current = null;
        pendingPreviewEtaRef.current = null;
        stationDraftRef.current = selectedEta;
        setStationDraftEta(selectedEta);
        setStationCalculationEta(selectedEta);
      }
      return;
    }
    stationDraftRef.current = selectedEta;
    setStationDraftEta(selectedEta);
    setStationCalculationEta(selectedEta);
  }, [selectedEta]);
  useEffect(() => () => {
    if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current);
  }, []);

  const scheduleStationPreview = (eta: number) => {
    pendingPreviewEtaRef.current = eta;
    if (previewFrameRef.current !== null) return;
    const tick = (timestamp: number) => {
      previewFrameRef.current = null;
      if (timestamp - lastPreviewAtRef.current < previewIntervalMs) {
        previewFrameRef.current = window.requestAnimationFrame(tick);
        return;
      }
      lastPreviewAtRef.current = timestamp;
      const pendingEta = pendingPreviewEtaRef.current;
      pendingPreviewEtaRef.current = null;
      if (pendingEta !== null) setStationCalculationEta(pendingEta);
    };
    previewFrameRef.current = window.requestAnimationFrame(tick);
  };

  const beginStationInteraction = () => {
    stationInteractingRef.current = true;
    setStationInteracting(true);
    lastHandledEtaRef.current = null;
  };
  const finishStationInteraction = () => {
    if (!stationInteractingRef.current) return;
    stationInteractingRef.current = false;
    setStationInteracting(false);
    if (previewFrameRef.current !== null) window.cancelAnimationFrame(previewFrameRef.current);
    previewFrameRef.current = null;
    pendingPreviewEtaRef.current = null;
    const finalEta = stationDraftRef.current;
    setStationCalculationEta(finalEta);
    onSelectEtaRef.current(finalEta);
  };
  const updateStationValue = (rawEta: number) => {
    const eta = Number.isFinite(rawEta) ? Math.max(0, Math.min(1, rawEta)) : stationDraftRef.current;
    if (lastHandledEtaRef.current === eta) return;
    lastHandledEtaRef.current = eta;
    stationDraftRef.current = eta;
    setStationDraftEta(eta);
    if (stationInteractingRef.current) {
      scheduleStationPreview(eta);
      return;
    }
    setStationCalculationEta(eta);
    onSelectEtaRef.current(eta);
  };
  const calculationEta = stationCalculationEta;
  const previewActive = interactive || stationInteracting;
  const calculationPanelCount = previewActive ? Math.min(panelCount, 40) : panelCount;
  const condition = useMemo(() => analysis ? deriveSectionCondition(design, analysis, flightCase, calculationEta) : null, [analysis, calculationEta, design, flightCase]);
  const section = useMemo(() => localAirfoilSection(design.geometry, calculationEta, Math.max(40, calculationPanelCount / 2)), [calculationEta, calculationPanelCount, design.geometry]);
  const solution = useMemo(() => condition ? solveAirfoilSectionPotentialFlow(section, condition.localIncidenceDeg, flightCase.velocityMps, calculationPanelCount) : null, [calculationPanelCount, condition, flightCase.velocityMps, section]);
  const polar = useMemo(() => condition ? evaluateSectionPolar(design.geometry, condition.eta, condition.reynoldsNumber, condition.localIncidenceDeg) : null, [condition, design.geometry]);
  const tableRows = useMemo(() => solution?.surface.map((point, index) => <tr key={`${point.surface}-${index}`}><th scope="row">{point.surface}</th><td>{point.xOverC.toFixed(4)}</td><td>{point.zOverC.toFixed(4)}</td><td>{point.cp.toFixed(5)}</td><td>{point.tangentialVelocityRatio.toFixed(5)}</td></tr>) ?? [], [solution]);
  if (!analysis || !condition || !solution) return <div className="section-empty"><span>≈</span><p><strong>A current converged wing analysis is required.</strong><br />Run the main solver before opening the Section Flow Lab. Historical or stale results are never substituted.</p></div>;
  return (
    <section className="section-flow-lab" aria-label="Two-dimensional section flow laboratory">
      <header className="section-lab-header">
        <div><span className="eyebrow">AOA-LINKED · LOCAL SECTION FLOW</span><h3>{section.label} · η {condition.eta.toFixed(3)} · wing α {condition.wingAngleOfAttackDeg.toFixed(2)}°</h3><p>Presentation derived from immutable analysis {analysis.analysisId} · exact local contour · panel field recalculated at the displayed incidence.</p></div>
        <label>Panel resolution{previewActive && <small className="section-live-preview" role="status">Live preview · 40 panels · selected resolution resumes on release</small>}<select aria-label="Section panel resolution" value={panelCount} onChange={(event) => setPanelCount(Number(event.target.value))}><option value="40">Low · 40</option><option value="80">Standard · 80</option><option value="120">High · 120</option><option value="160">Reference · 160</option></select></label>
      </header>
      <label className="station-scrubber section-station"><span>Linked 3D station</span><input type="range" min="0" max="1" step="0.001" value={stationDraftEta} onPointerDown={(event) => { beginStationInteraction(); event.currentTarget.setPointerCapture?.(event.pointerId); }} onPointerUp={finishStationInteraction} onPointerCancel={finishStationInteraction} onLostPointerCapture={finishStationInteraction} onKeyDown={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) beginStationInteraction(); }} onKeyUp={(event) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) finishStationInteraction(); }} onBlur={finishStationInteraction} onInput={(event) => updateStationValue(Number(event.currentTarget.value))} onChange={(event) => updateStationValue(Number(event.currentTarget.value))} aria-valuetext={`eta ${stationDraftEta.toFixed(3)}`} /><strong>η {stationDraftEta.toFixed(3)}</strong></label>
      <div className="section-facts-row">
        <span><b>{format(condition.localIncidenceDeg, 2)}°</b>local incidence</span>
        <span><b>{format(condition.inducedAngleDeg, 2)}°</b>induced-flow angle · downwash +</span>
        <span><b>{format(condition.chordM, 2)} m</b>local chord</span>
        <span><b>{condition.reynoldsNumber.toExponential(2)}</b>Re · coupled polar input</span>
        <span><b>{format(solution.liftCoefficient, 3)}</b>inviscid diagnostic C<sub>l</sub></span>
        <span><b>{format(solution.momentCoefficientQuarterChord, 3)}</b>C<sub>m,c/4</sub> · nose-up +</span>
        {polar && <><span><b>{format(polar.cl, 3)}</b>coupled polar C<sub>l</sub></span><span><b>{format(polar.cd, 5)}</b>polar C<sub>d</sub> · {polar.state.replaceAll('_', ' ')}</span></>}
      </div>
      <div className="section-visual-grid"><SectionFlowField solution={solution} sectionLabel={section.label} interactive={previewActive} /><CpPlot solution={solution} sectionLabel={section.label} /></div>
      <div className="section-validation-strip"><span>Kutta residual <b>{Math.abs(solution.kuttaResidualMps).toExponential(2)} m/s</b></span><span>Panel source-flux residual <b>{Math.abs(solution.sourceFluxResidualM2ps).toExponential(2)} m²/s</b></span><span>Numerical inviscid C<sub>d</sub> residual <b>{solution.dragCoefficientNumerical.toExponential(2)}</b></span></div>
      <p className="scientific-warning"><strong>Two-dimensional inviscid attached potential-flow diagnostic.</strong> The wind-axis view keeps U∞ horizontal and rotates the section by its solved local incidence. Streamlines use adaptive integration through the panel solution&apos;s total-velocity field. This is not CFD: it cannot predict boundary layers, separation, stall, or a viscous wake, so attached lines at high AoA are not evidence that real flow remains attached. The diagnostic does not alter the main wing analysis; profile drag comes only from the disclosed SectionPolar source. Local incidence = selected wing AoA + geometric twist + elastic twist − signed induced-flow angle; positive induced angle means downwash.</p>
      <details className="section-data-table"><summary>Accessible Cp table</summary><div><table><caption>Surface pressure coefficients for analysis {condition.analysisId}</caption><thead><tr><th scope="col">Surface</th><th scope="col">x/c</th><th scope="col">z/c</th><th scope="col">Cp</th><th scope="col">Vt/V∞</th></tr></thead><tbody>{tableRows}</tbody></table></div></details>
    </section>
  );
}
