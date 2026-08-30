'use client';

import { useMemo } from 'react';
import type { AnalysisSnapshot, FlightCase, WingDesign } from '@/lib/domain/types';
import { interpolateStationValue } from '@/lib/domain/stations';
import { localAirfoilSection } from '@/lib/solver/airfoilSections';
import { evaluateSectionPolar } from '@/lib/solver/polars';
import { deriveSectionCondition } from '@/lib/visualization/sectionFlow';

const fmt = (value: number, digits = 2) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

interface PlotPoint { x: number; y: number }

function LinePlot({ title, subtitle, points, xLabel, yLabel, operatingPoint, zeroFloor = false }: { title: string; subtitle: string; points: PlotPoint[]; xLabel: string; yLabel: string; operatingPoint?: PlotPoint; zeroFloor?: boolean }) {
  const width = 520;
  const height = 190;
  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  if (operatingPoint) { xValues.push(operatingPoint.x); yValues.push(operatingPoint.y); }
  const xLow = Math.min(...xValues);
  const xHigh = Math.max(...xValues);
  const rawLow = Math.min(...yValues);
  const rawHigh = Math.max(...yValues);
  const padding = Math.max(1e-9, (rawHigh - rawLow) * 0.08);
  const yLow = zeroFloor ? Math.max(0, rawLow - padding) : rawLow - padding;
  const yHigh = rawHigh + padding;
  const x = (value: number) => 42 + (value - xLow) / Math.max(xHigh - xLow, 1e-9) * (width - 58);
  const y = (value: number) => 12 + (yHigh - value) / Math.max(yHigh - yLow, 1e-9) * (height - 42);
  return <figure className="performance-plot"><figcaption><strong>{title}</strong><span>{subtitle}</span></figcaption><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${subtitle}`}>
    {[0, 0.5, 1].map((fraction) => <line key={`x-${fraction}`} className="section-grid" x1={x(xLow + fraction * (xHigh - xLow))} x2={x(xLow + fraction * (xHigh - xLow))} y1="10" y2={height - 26} />)}
    {[0, 0.5, 1].map((fraction) => <g key={`y-${fraction}`}><line className="section-grid" x1="40" x2={width - 14} y1={y(yLow + fraction * (yHigh - yLow))} y2={y(yLow + fraction * (yHigh - yLow))} /><text x="3" y={y(yLow + fraction * (yHigh - yLow)) + 3}>{fmt(yLow + fraction * (yHigh - yLow), Math.abs(yHigh) < 1 ? 3 : 1)}</text></g>)}
    <polyline className="performance-line" points={points.map((point) => `${x(point.x)},${y(point.y)}`).join(' ')} />
    {operatingPoint && <circle className="operating-point" cx={x(operatingPoint.x)} cy={y(operatingPoint.y)} r="4" />}
    <text x="42" y={height - 7}>{xLabel} {fmt(xLow, 2)}</text><text textAnchor="end" x={width - 14} y={height - 7}>{fmt(xHigh, 2)}</text><text textAnchor="end" x={width - 14} y="11">{yLabel}</text>
  </svg></figure>;
}

export function PerformanceLab({ design, analysis, flightCase, selectedEta, onSelectEta }: { design: WingDesign; analysis: AnalysisSnapshot | null; flightCase: FlightCase; selectedEta: number; onSelectEta: (eta: number) => void }) {
  const condition = useMemo(() => analysis ? deriveSectionCondition(design, analysis, flightCase, selectedEta) : null, [analysis, design, flightCase, selectedEta]);
  const section = useMemo(() => localAirfoilSection(design.geometry, selectedEta, 80), [design.geometry, selectedEta]);
  const polar = useMemo(() => {
    if (!condition) return null;
    const current = evaluateSectionPolar(design.geometry, condition.eta, condition.reynoldsNumber, condition.localIncidenceDeg);
    const low = current.alphaRangeDeg[0];
    const high = current.alphaRangeDeg[1];
    return {
      current,
      points: Array.from({ length: 49 }, (_, index) => {
        const alpha = low + (high - low) * index / 48;
        return { x: alpha, y: evaluateSectionPolar(design.geometry, condition.eta, condition.reynoldsNumber, alpha).cl };
      }),
    };
  }, [condition, design.geometry]);
  if (!analysis || !condition || !polar) return <div className="section-empty"><span>∑</span><p><strong>A current converged wing analysis is required.</strong><br />Run the coupled solver to populate Reynolds, profile drag, and polar operating-point evidence.</p></div>;
  const metrics = analysis.metrics;
  const sweepPoints = analysis.angleSweep.points.filter((point) => point.status === 'converged');
  const inducedFraction = metrics.inducedDragN / metrics.combinedWingDragEstimateN;
  const profileFraction = metrics.profileDragEstimateN / metrics.combinedWingDragEstimateN;
  const localProfileDragPerSpan = Number(interpolateStationValue(analysis, condition.eta, 'profileDragPerSpanNpm'));
  const rangeIssueCount = analysis.polarDiagnostics.extrapolatedAlphaStations + analysis.polarDiagnostics.outsideAlphaStations + analysis.polarDiagnostics.outsideReynoldsStations;
  return <section className="performance-lab" aria-label="Reynolds and section-polar performance laboratory">
    <header className="performance-header"><div><span className="eyebrow">AOA SWEEP · REYNOLDS & POLAR COUPLING</span><h3>Profile + induced drag evidence at α {fmt(metrics.trimmedAlphaDeg, 1)}°</h3><p>Immutable analysis {analysis.analysisId} · {analysis.polarDiagnostics.model === 'user_section_polars' ? 'user-provided tables' : 'analytic attached-flow estimate'}</p></div><span className={`polar-validity ${rangeIssueCount ? 'warning' : 'ready'}`}>{rangeIssueCount ? `${rangeIssueCount} range flags` : 'All stations in declared range'}</span></header>
    <div className="drag-summary">
      <div><span>Induced</span><strong>{fmt(metrics.inducedDragN, 1)} N</strong><small>C<sub>Di</sub> {fmt(metrics.inducedDragCoefficientEstimate ?? 0, 5)}</small></div>
      <div><span>Profile</span><strong>{fmt(metrics.profileDragEstimateN, 1)} N</strong><small>C<sub>Dp</sub> {fmt(metrics.profileDragCoefficientEstimate, 5)}</small></div>
      <div><span>Combined wing</span><strong>{fmt(metrics.combinedWingDragEstimateN, 1)} N</strong><small>C<sub>D</sub> {fmt(metrics.combinedDragCoefficientEstimate, 5)}</small></div>
      <div><span>Estimated wing L/D</span><strong>{fmt(metrics.estimatedWingLiftToDrag, 1)}</strong><small>wing only · no fuselage/interference</small></div>
    </div>
    <div className="drag-bar" aria-label={`Drag decomposition: ${(100 * inducedFraction).toFixed(1)} percent induced and ${(100 * profileFraction).toFixed(1)} percent profile`}><i style={{ width: `${100 * inducedFraction}%` }} /><b style={{ width: `${100 * profileFraction}%` }} /></div>
    <div className="drag-legend"><span><i />Induced {(100 * inducedFraction).toFixed(1)}%</span><span><i />Profile {(100 * profileFraction).toFixed(1)}%</span></div>
    <label className="station-scrubber section-station"><span>Linked span station</span><input type="range" min="0" max="1" step="0.001" value={selectedEta} onChange={(event) => onSelectEta(Number(event.target.value))} aria-valuetext={`eta ${selectedEta.toFixed(3)}`} /><strong>η {selectedEta.toFixed(3)}</strong></label>
    <div className="performance-local-facts"><span><b>{section.label}</b>local section</span><span><b>{condition.reynoldsNumber.toExponential(3)}</b>Re</span><span><b>{fmt(polar.current.cl, 3)}</b>C<sub>l</sub></span><span><b>{fmt(polar.current.cd, 5)}</b>C<sub>d</sub></span><span><b>{fmt(polar.current.cm, 4)}</b>C<sub>m,c/4</sub></span><span><b>{polar.current.state.replaceAll('_', ' ')}</b>range state</span></div>
    <div className="performance-plots">
      <LinePlot title="Wing lift curve" subtitle="Fixed-AoA coupled sweep" points={sweepPoints.map((point) => ({ x: point.alphaDeg, y: point.metrics.liftCoefficient }))} xLabel="α (deg)" yLabel="CL" operatingPoint={{ x: metrics.trimmedAlphaDeg, y: metrics.liftCoefficient }} />
      <LinePlot title="Wing drag curve" subtitle="Profile + wake-induced estimate" points={sweepPoints.map((point) => ({ x: point.alphaDeg, y: point.metrics.combinedDragCoefficientEstimate }))} xLabel="α (deg)" yLabel="CD" operatingPoint={{ x: metrics.trimmedAlphaDeg, y: metrics.combinedDragCoefficientEstimate }} zeroFloor />
      <LinePlot title="Wing efficiency" subtitle="Estimated wing-only L/D" points={sweepPoints.map((point) => ({ x: point.alphaDeg, y: point.metrics.estimatedWingLiftToDrag }))} xLabel="α (deg)" yLabel="L/D" operatingPoint={{ x: metrics.trimmedAlphaDeg, y: metrics.estimatedWingLiftToDrag }} />
      <LinePlot title="Tip deflection response" subtitle="Fixed-AoA torsion-coupled sweep" points={sweepPoints.map((point) => ({ x: point.alphaDeg, y: point.metrics.tipDeflectionM }))} xLabel="α (deg)" yLabel="m" operatingPoint={{ x: metrics.trimmedAlphaDeg, y: metrics.tipDeflectionM }} />
      <LinePlot title="Spanwise Reynolds number" subtitle="ρVc/μ at structural stations" points={analysis.stations.map((station) => ({ x: station.eta, y: station.reynoldsNumber / 1e6 }))} xLabel="η" yLabel="Re ×10⁶" operatingPoint={{ x: condition.eta, y: condition.reynoldsNumber / 1e6 }} zeroFloor />
      <LinePlot title="Profile drag distribution" subtitle="q c Cd · semispan" points={analysis.stations.map((station) => ({ x: station.eta, y: station.profileDragPerSpanNpm }))} xLabel="η" yLabel="N/m" operatingPoint={{ x: condition.eta, y: localProfileDragPerSpan }} zeroFloor />
      <LinePlot title="Local section polar" subtitle={`${section.label} · Re ${condition.reynoldsNumber.toExponential(2)}`} points={polar.points} xLabel="α (deg)" yLabel="Cl" operatingPoint={{ x: condition.localIncidenceDeg, y: polar.current.cl }} />
    </div>
    <div className="polar-diagnostics"><span><b>{analysis.polarDiagnostics.withinRangeStations}</b> within table range</span><span><b>{analysis.polarDiagnostics.analyticEstimateStations}</b> analytic estimate</span><span><b>{analysis.polarDiagnostics.extrapolatedAlphaStations}</b> α extrapolated</span><span><b>{analysis.polarDiagnostics.outsideReynoldsStations}</b> Re outside</span><span><b>{analysis.polarDiagnostics.outsideAlphaStations}</b> α outside</span></div>
    <p className="scientific-warning"><strong>Preliminary wing-only drag estimate.</strong> Profile drag follows the active SectionPolar source. The analytic source is a transparent attached-flow surrogate, not XFOIL or experiment. Fuselage, interference, compressibility, transition prediction, separation, and first-principles stall are omitted.</p>
    <details className="polar-provenance"><summary>Polar provenance</summary><ul>{analysis.polarDiagnostics.provenance.map((value) => <li key={value}>{value}</li>)}</ul></details>
  </section>;
}
