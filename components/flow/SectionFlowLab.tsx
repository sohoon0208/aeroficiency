'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisSnapshot, FlightCase, WingDesign } from '@/lib/domain/types';
import {
  sampleSectionVelocityVectors,
  sectionPointToWindAxes,
  solveAirfoilSectionPotentialFlow,
  traceSectionStreamlines,
  type Point2,
  type SectionPotentialFlowSolution,
  type SectionStreamline,
  type SectionVelocityVector,
  type StreamlineTraceOptions,
} from '@/lib/solver/panel2d';
import { localAirfoilSection, type CanonicalAirfoil } from '@/lib/solver/airfoilSections';
import { evaluateSectionPolar } from '@/lib/solver/polars';
import { deriveSectionCondition } from '@/lib/visualization/sectionFlow';

const format = (value: number, digits = 3) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function pointsAttribute(points: readonly Point2[], x: (value: number) => number, z: (value: number) => number) {
  return points.map((point) => `${x(point.x)},${z(point.z)}`).join(' ');
}

interface SectionFlowComputation {
  scopeKey: string;
  solution: SectionPotentialFlowSolution;
  lines: SectionStreamline[];
  vectors: SectionVelocityVector[];
}

interface SectionFlowWorkerRequest {
  requestId: number;
  scopeKey: string;
  section: CanonicalAirfoil;
  incidenceDeg: number;
  freeStreamMps: number;
  panelCount: number;
  streamlineCount: number;
  traceOptions?: StreamlineTraceOptions;
}

interface SectionFlowWorkerResponse extends Partial<SectionFlowComputation> {
  requestId: number;
  scopeKey: string;
  error?: string;
}

function calculateSectionFlow(request: Omit<SectionFlowWorkerRequest, 'requestId'>): SectionFlowComputation {
  const solution = solveAirfoilSectionPotentialFlow(request.section, request.incidenceDeg, request.freeStreamMps, request.panelCount);
  return {
    scopeKey: request.scopeKey,
    solution,
    lines: traceSectionStreamlines(solution, request.streamlineCount, request.traceOptions),
    vectors: sampleSectionVelocityVectors(solution),
  };
}

function useSectionFlowComputation(request: Omit<SectionFlowWorkerRequest, 'requestId'> | null) {
  const [workerFailed, setWorkerFailed] = useState(false);
  const [workerResult, setWorkerResult] = useState<SectionFlowComputation | null>(() => request ? calculateSectionFlow(request) : null);
  const workerRef = useRef<Worker | null>(null);
  const runningRef = useRef(false);
  const queuedRequestRef = useRef<SectionFlowWorkerRequest | null>(null);
  const latestRequestIdRef = useRef(0);
  const dispatchRef = useRef<(next: SectionFlowWorkerRequest) => void>(() => undefined);
  const useWorker = typeof Worker !== 'undefined' && !workerFailed;

  const synchronousResult = useMemo(() => {
    if (useWorker || !request) return null;
    return calculateSectionFlow(request);
  }, [request, useWorker]);

  useEffect(() => {
    if (!useWorker) return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sectionFlow.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      queueMicrotask(() => setWorkerFailed(true));
      return;
    }
    workerRef.current = worker;
    dispatchRef.current = (next) => {
      runningRef.current = true;
      worker.postMessage(next);
    };
    worker.onmessage = ({ data }: MessageEvent<SectionFlowWorkerResponse>) => {
      runningRef.current = false;
      if (data.error) {
        setWorkerFailed(true);
        return;
      }
      if (data.requestId === latestRequestIdRef.current && data.solution && data.lines && data.vectors) {
        setWorkerResult({ scopeKey: data.scopeKey, solution: data.solution, lines: data.lines, vectors: data.vectors });
      }
      const queued = queuedRequestRef.current;
      queuedRequestRef.current = null;
      if (queued) dispatchRef.current(queued);
    };
    worker.onerror = () => setWorkerFailed(true);
    return () => {
      worker.terminate();
      workerRef.current = null;
      runningRef.current = false;
      queuedRequestRef.current = null;
    };
  }, [useWorker]);

  useEffect(() => {
    if (!useWorker || !workerRef.current || !request) return;
    const next = { ...request, requestId: latestRequestIdRef.current + 1 };
    latestRequestIdRef.current = next.requestId;
    if (runningRef.current) queuedRequestRef.current = next;
    else dispatchRef.current(next);
  }, [request, useWorker]);

  if (synchronousResult) return synchronousResult;
  return request && workerResult?.scopeKey === request.scopeKey ? workerResult : null;
}

function SectionFlowField({ solution, sectionLabel, lines, vectors, streamlineCount }: { solution: SectionPotentialFlowSolution; sectionLabel: string; lines: SectionStreamline[]; vectors: SectionVelocityVector[]; streamlineCount: number }) {
  const width = 660;
  const height = 270;
  const xMinimum = -0.58;
  const xMaximum = 1.72;
  const zMinimum = -0.62;
  const zMaximum = 0.62;
  const x = (value: number) => 22 + (value - xMinimum) / (xMaximum - xMinimum) * (width - 42);
  const z = (value: number) => 12 + (zMaximum - value) / (zMaximum - zMinimum) * (height - 32);
  const outline = [...solution.panels.map((panel) => panel.start), solution.panels.at(-1)!.end]
    .map((point) => sectionPointToWindAxes(point, solution.incidenceDeg));
  const leadingEdge = sectionPointToWindAxes({ x: 0, z: 0 }, solution.incidenceDeg);
  const trailingEdge = sectionPointToWindAxes({ x: 1, z: 0 }, solution.incidenceDeg);
  const stagnation = sectionPointToWindAxes({ x: solution.stagnation.xOverC, z: solution.stagnation.zOverC }, solution.incidenceDeg);
  return (
    <figure className="section-figure flow-field-figure">
      <figcaption><strong>Inviscid attached-flow streamlines</strong><span>Wind axes · horizontal U∞ · adaptive integration</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" data-reference-frame="wind" data-incidence-deg={solution.incidenceDeg.toFixed(6)} data-panel-count={solution.panels.length} data-streamline-count={streamlineCount} aria-label={`Wind-axis inviscid attached-flow streamlines and local velocity vectors around ${sectionLabel} with the airfoil at ${solution.incidenceDeg.toFixed(2)} degrees local incidence`}>
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
}

function CpPlot({ solution, sectionLabel }: { solution: SectionPotentialFlowSolution; sectionLabel: string }) {
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
}

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
  const effectivePanelCount = interactive ? Math.min(panelCount, 40) : panelCount;
  const streamlineCount = interactive ? 3 : 17;
  const traceOptions = useMemo<StreamlineTraceOptions | undefined>(() => interactive ? { maxSteps: 160, maxStep: 0.022, minStep: 0.001 } : undefined, [interactive]);
  const condition = useMemo(() => analysis ? deriveSectionCondition(design, analysis, flightCase, selectedEta) : null, [analysis, design, flightCase, selectedEta]);
  const section = useMemo(() => localAirfoilSection(design.geometry, selectedEta, Math.max(40, effectivePanelCount / 2)), [design.geometry, effectivePanelCount, selectedEta]);
  const flowRequest = useMemo<Omit<SectionFlowWorkerRequest, 'requestId'> | null>(() => condition ? ({
    scopeKey: `${condition.analysisId}:${condition.eta.toFixed(6)}:${section.label}`,
    section,
    incidenceDeg: condition.localIncidenceDeg,
    freeStreamMps: flightCase.velocityMps,
    panelCount: effectivePanelCount,
    streamlineCount,
    traceOptions,
  }) : null, [condition, effectivePanelCount, flightCase.velocityMps, section, streamlineCount, traceOptions]);
  const computation = useSectionFlowComputation(flowRequest);
  const solution = computation?.solution ?? null;
  const polar = useMemo(() => condition ? evaluateSectionPolar(design.geometry, condition.eta, condition.reynoldsNumber, condition.localIncidenceDeg) : null, [condition, design.geometry]);
  if (!analysis || !condition) return <div className="section-empty"><span>≈</span><p><strong>A current converged wing analysis is required.</strong><br />Run the main solver before opening the Section Flow Lab. Historical or stale results are never substituted.</p></div>;
  if (!solution || !computation) return <div className="section-empty"><span>≈</span><p><strong>Preparing the selected section flow.</strong></p></div>;
  return (
    <section className="section-flow-lab" aria-label="Two-dimensional section flow laboratory">
      <header className="section-lab-header">
        <div><span className="eyebrow">AOA-LINKED · LOCAL SECTION FLOW</span><h3>{section.label} · η {condition.eta.toFixed(3)} · wing α {condition.wingAngleOfAttackDeg.toFixed(2)}°</h3><p>Presentation derived from immutable analysis {analysis.analysisId} · exact local contour · panel field recalculated at the displayed incidence.</p></div>
        <label>Panel resolution<select aria-label="Section panel resolution" value={panelCount} onChange={(event) => setPanelCount(Number(event.target.value))}><option value="40">Low · 40</option><option value="80">Standard · 80</option><option value="120">High · 120</option><option value="160">Reference · 160</option></select></label>
      </header>
      <label className="station-scrubber section-station"><span>Linked 3D station</span><input type="range" min="0" max="1" step="0.001" value={selectedEta} onChange={(event) => onSelectEta(Number(event.target.value))} aria-valuetext={`eta ${selectedEta.toFixed(3)}`} /><strong>η {selectedEta.toFixed(3)}</strong></label>
      <div className="section-facts-row">
        <span><b>{format(condition.localIncidenceDeg, 2)}°</b>local incidence</span>
        <span><b>{format(condition.inducedAngleDeg, 2)}°</b>induced-flow angle · downwash +</span>
        <span><b>{format(condition.chordM, 2)} m</b>local chord</span>
        <span><b>{condition.reynoldsNumber.toExponential(2)}</b>Re · coupled polar input</span>
        <span><b>{format(solution.liftCoefficient, 3)}</b>inviscid diagnostic C<sub>l</sub></span>
        <span><b>{format(solution.momentCoefficientQuarterChord, 3)}</b>C<sub>m,c/4</sub> · nose-up +</span>
        {polar && <><span><b>{format(polar.cl, 3)}</b>coupled polar C<sub>l</sub></span><span><b>{format(polar.cd, 5)}</b>polar C<sub>d</sub> · {polar.state.replaceAll('_', ' ')}</span></>}
      </div>
      <div className="section-visual-grid"><SectionFlowField solution={solution} sectionLabel={section.label} lines={computation.lines} vectors={computation.vectors} streamlineCount={streamlineCount} /><CpPlot solution={solution} sectionLabel={section.label} /></div>
      <div className="section-validation-strip"><span>Kutta residual <b>{Math.abs(solution.kuttaResidualMps).toExponential(2)} m/s</b></span><span>Panel source-flux residual <b>{Math.abs(solution.sourceFluxResidualM2ps).toExponential(2)} m²/s</b></span><span>Numerical inviscid C<sub>d</sub> residual <b>{solution.dragCoefficientNumerical.toExponential(2)}</b></span></div>
      <p className="scientific-warning"><strong>Two-dimensional inviscid attached potential-flow diagnostic.</strong> The wind-axis view keeps U∞ horizontal and rotates the section by its solved local incidence. Streamlines use adaptive integration through the panel solution&apos;s total-velocity field. This is not CFD: it cannot predict boundary layers, separation, stall, or a viscous wake, so attached lines at high AoA are not evidence that real flow remains attached. The diagnostic does not alter the main wing analysis; profile drag comes only from the disclosed SectionPolar source. Local incidence = selected wing AoA + geometric twist + elastic twist − signed induced-flow angle; positive induced angle means downwash.</p>
      <details className="section-data-table"><summary>Accessible Cp table</summary><div><table><caption>Surface pressure coefficients for analysis {condition.analysisId}</caption><thead><tr><th scope="col">Surface</th><th scope="col">x/c</th><th scope="col">z/c</th><th scope="col">Cp</th><th scope="col">Vt/V∞</th></tr></thead><tbody>{solution.surface.map((point, index) => <tr key={`${point.surface}-${index}`}><th scope="row">{point.surface}</th><td>{point.xOverC.toFixed(4)}</td><td>{point.zOverC.toFixed(4)}</td><td>{point.cp.toFixed(5)}</td><td>{point.tangentialVelocityRatio.toFixed(5)}</td></tr>)}</tbody></table></div></details>
    </section>
  );
}
