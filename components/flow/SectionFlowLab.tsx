'use client';

import { useMemo, useState } from 'react';
import type { AnalysisSnapshot, FlightCase, WingDesign } from '@/lib/domain/types';
import {
  sampleSectionVelocityVectors,
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

function SectionFlowField({ solution, sectionLabel }: { solution: SectionPotentialFlowSolution; sectionLabel: string }) {
  const width = 660;
  const height = 270;
  const xMinimum = -0.45;
  const xMaximum = 1.62;
  const zMinimum = -0.58;
  const zMaximum = 0.58;
  const x = (value: number) => 22 + (value - xMinimum) / (xMaximum - xMinimum) * (width - 42);
  const z = (value: number) => 12 + (zMaximum - value) / (zMaximum - zMinimum) * (height - 32);
  const lines = useMemo(() => traceSectionStreamlines(solution), [solution]);
  const vectors = useMemo(() => sampleSectionVelocityVectors(solution), [solution]);
  const outline = [...solution.panels.map((panel) => panel.start), solution.panels.at(-1)!.end];
  return (
    <figure className="section-figure flow-field-figure">
      <figcaption><strong>Inviscid section streamlines</strong><span>Total velocity · chord-normalized coordinates</span></figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Inviscid streamlines and local velocity vectors around ${sectionLabel} at ${solution.incidenceDeg.toFixed(2)} degrees incidence`}>
        <defs><marker id="section-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="4" markerHeight="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" /></marker></defs>
        {[0, 0.5, 1].map((value) => <line key={`x-${value}`} className="section-grid" x1={x(value)} x2={x(value)} y1="10" y2={height - 20} />)}
        {[-0.4, 0, 0.4].map((value) => <line key={`z-${value}`} className="section-grid" x1="20" x2={width - 20} y1={z(value)} y2={z(value)} />)}
        {lines.map((line) => <polyline key={line.id} className="section-streamline" points={pointsAttribute(line.points, x, z)} />)}
        {vectors.map(({ point, velocity }, index) => {
          const magnitude = Math.max(Math.hypot(velocity.x, velocity.z), 1e-9);
          const scale = 0.055;
          return <line key={`vector-${index}`} className="section-vector" x1={x(point.x)} y1={z(point.z)} x2={x(point.x + scale * velocity.x / magnitude)} y2={z(point.z + scale * velocity.z / magnitude)} markerEnd="url(#section-arrow)" />;
        })}
        <polygon className="section-airfoil" points={pointsAttribute(outline, x, z)} />
        <circle className="stagnation-point" cx={x(solution.stagnation.xOverC)} cy={z(solution.stagnation.zOverC)} r="4" />
        <text x={x(0)} y={height - 6}>LE · x/c 0</text><text textAnchor="end" x={x(1)} y={height - 6}>TE · x/c 1</text>
      </svg>
      <div className="section-legend"><span><i className="legend-stream" />Streamline</span><span><i className="legend-vector" />Velocity direction</span><span><i className="legend-stagnation" />Approx. surface stagnation</span></div>
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
}: {
  design: WingDesign;
  analysis: AnalysisSnapshot | null;
  flightCase: FlightCase;
  selectedEta: number;
  onSelectEta: (eta: number) => void;
}) {
  const [panelCount, setPanelCount] = useState(120);
  const condition = useMemo(() => analysis ? deriveSectionCondition(design, analysis, flightCase, selectedEta) : null, [analysis, design, flightCase, selectedEta]);
  const section = useMemo(() => localAirfoilSection(design.geometry, selectedEta, Math.max(40, panelCount / 2)), [design.geometry, panelCount, selectedEta]);
  const solution = useMemo(() => condition ? solveAirfoilSectionPotentialFlow(section, condition.localIncidenceDeg, flightCase.velocityMps, panelCount) : null, [condition, flightCase.velocityMps, panelCount, section]);
  const polar = useMemo(() => condition ? evaluateSectionPolar(design.geometry, condition.eta, condition.reynoldsNumber, condition.localIncidenceDeg) : null, [condition, design.geometry]);
  if (!analysis || !condition || !solution) return <div className="section-empty"><span>≈</span><p><strong>A current converged wing analysis is required.</strong><br />Run the main solver before opening the Section Flow Lab. Historical or stale results are never substituted.</p></div>;
  return (
    <section className="section-flow-lab" aria-label="Two-dimensional section flow laboratory">
      <header className="section-lab-header">
        <div><span className="eyebrow">AOA-LINKED · LOCAL SECTION FLOW</span><h3>{section.label} · η {condition.eta.toFixed(3)} · wing α {condition.wingAngleOfAttackDeg.toFixed(1)}°</h3><p>Immutable analysis {analysis.analysisId} · selected precomputed sweep point · exact interpolated local contour.</p></div>
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
      <div className="section-visual-grid"><SectionFlowField solution={solution} sectionLabel={section.label} /><CpPlot solution={solution} sectionLabel={section.label} /></div>
      <div className="section-validation-strip"><span>Kutta residual <b>{Math.abs(solution.kuttaResidualMps).toExponential(2)} m/s</b></span><span>Panel source-flux residual <b>{Math.abs(solution.sourceFluxResidualM2ps).toExponential(2)} m²/s</b></span><span>Numerical inviscid C<sub>d</sub> residual <b>{solution.dragCoefficientNumerical.toExponential(2)}</b></span></div>
      <p className="scientific-warning"><strong>Two-dimensional inviscid attached potential-flow diagnostic.</strong> This diagnostic does not alter the main wing analysis. Its Cp and streamline field do not supply viscous drag to the wing solver. Profile drag comes only from the disclosed SectionPolar source. Local incidence = selected wing AoA + geometric twist + elastic twist − signed induced-flow angle; positive induced angle means downwash.</p>
      <details className="section-data-table"><summary>Accessible Cp table</summary><div><table><caption>Surface pressure coefficients for analysis {condition.analysisId}</caption><thead><tr><th scope="col">Surface</th><th scope="col">x/c</th><th scope="col">z/c</th><th scope="col">Cp</th><th scope="col">Vt/V∞</th></tr></thead><tbody>{solution.surface.map((point, index) => <tr key={`${point.surface}-${index}`}><th scope="row">{point.surface}</th><td>{point.xOverC.toFixed(4)}</td><td>{point.zOverC.toFixed(4)}</td><td>{point.cp.toFixed(5)}</td><td>{point.tangentialVelocityRatio.toFixed(5)}</td></tr>)}</tbody></table></div></details>
    </section>
  );
}
