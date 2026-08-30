'use client';

import { useMemo } from 'react';
import type { AnalysisSnapshot, WingDesign } from '@/lib/domain/types';
import type { ViewMode } from '@/components/viewport/WingViewport';

interface Point { eta: number; value: number | null }
interface Series { label: string; unit: string; color: string; points: Point[]; limit?: number; zeroFloor?: boolean }

function geometrySeries(design: WingDesign): Series[] {
  const eta = Array.from({ length: 17 }, (_, index) => index / 16);
  return [
    { label: 'Local chord', unit: 'm', color: '#58d0ff', zeroFloor: true, points: eta.map((value) => ({ eta: value, value: design.geometry.rootChordM + (design.geometry.tipChordM - design.geometry.rootChordM) * value })) },
    { label: 'Geometric twist', unit: 'deg', color: '#b89cff', points: eta.map((value) => ({ eta: value, value: design.geometry.rootTwistDeg + (design.geometry.tipTwistDeg - design.geometry.rootTwistDeg) * value })) },
  ];
}

function analysisSeries(mode: ViewMode, analysis: AnalysisSnapshot | null): Series[] {
  if (!analysis) return [];
  if (mode === 'aero') return [
    { label: 'Lift per span', unit: 'N/m', color: '#58d0ff', zeroFloor: true, points: analysis.stations.map((station) => ({ eta: station.eta, value: station.liftPerSpanNpm })) },
    { label: 'Elastic twist', unit: 'deg', color: '#b89cff', points: analysis.stations.map((station) => ({ eta: station.eta, value: station.elasticTwistDeg })) },
  ];
  if (mode === 'structure') return [
    { label: 'Vertical deflection', unit: 'm', color: '#f2b866', zeroFloor: true, points: analysis.stations.map((station) => ({ eta: station.eta, value: station.deflectionM })) },
    { label: 'Modeled yield ratio', unit: '×', color: '#46d39a', limit: 1.5, zeroFloor: true, points: analysis.stations.map((station) => ({ eta: station.eta, value: station.yieldMargin })) },
  ];
  return [];
}

function EngineeringPlot({ series, selectedEta, onSelect }: { series: Series; selectedEta: number; onSelect: (eta: number) => void }) {
  const width = 420;
  const height = 116;
  const bounds = useMemo(() => {
    const values = series.points.flatMap((point) => point.value === null ? [] : [point.value]);
    if (series.limit !== undefined) values.push(series.limit);
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    const padding = Math.max((maximum - minimum) * 0.1, Math.max(Math.abs(minimum), Math.abs(maximum), 1) * 0.05, 1e-6);
    minimum = series.zeroFloor ? Math.max(0, minimum - padding) : minimum - padding;
    maximum += padding;
    return { minimum, maximum };
  }, [series]);
  const x = (eta: number) => 38 + eta * (width - 52);
  const y = (value: number) => 8 + (bounds.maximum - value) / (bounds.maximum - bounds.minimum) * (height - 30);
  const points = series.points.filter((point): point is { eta: number; value: number } => point.value !== null).map((point) => `${x(point.eta)},${y(point.value)}`).join(' ');
  return (
    <div className="engineering-plot">
      <div className="plot-label"><strong>{series.label}</strong><span>{series.unit}</span></div>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${series.label} across normalized right semispan`} onPointerDown={(event) => { const box = event.currentTarget.getBoundingClientRect(); onSelect(Math.max(0, Math.min(1, ((event.clientX - box.left) / box.width * width - 38) / (width - 52)))); }}>
        {[0, 0.5, 1].map((eta) => <line key={`x${eta}`} className="grid-line" x1={x(eta)} x2={x(eta)} y1="8" y2={height - 22} />)}
        {[0, 0.5, 1].map((fraction) => <line key={`y${fraction}`} className="grid-line" x1="38" x2={width - 14} y1={8 + fraction * (height - 30)} y2={8 + fraction * (height - 30)} />)}
        {series.limit !== undefined && <line className="limit-line" x1="38" x2={width - 14} y1={y(series.limit)} y2={y(series.limit)} />}
        <polyline points={points} fill="none" stroke={series.color} strokeWidth="2" vectorEffect="non-scaling-stroke" /><line className="crosshair" x1={x(selectedEta)} x2={x(selectedEta)} y1="8" y2={height - 22} />
        <text x="38" y={height - 6}>ROOT · η 0</text><text textAnchor="end" x={width - 14} y={height - 6}>TIP · η 1</text><text x="2" y="14">{bounds.maximum.toPrecision(3)}</text><text x="2" y={height - 25}>{bounds.minimum.toPrecision(3)}</text>
      </svg>
    </div>
  );
}

export function SpanwiseCharts({ mode, design, analysis, selectedEta, onSelect }: { mode: ViewMode; design: WingDesign; analysis: AnalysisSnapshot | null; selectedEta: number; onSelect: (eta: number) => void }) {
  const series = mode === 'geometry' ? geometrySeries(design) : analysisSeries(mode, analysis);
  if (!series.length) return <div className="chart-empty"><span>∿</span><p><strong>No current converged analysis for this revision.</strong><br />Run the solver to populate {mode === 'aero' ? 'aerodynamic load and twist' : 'deflection and modeled-yield-ratio'} plots.</p></div>;
  return (
    <div className="chart-deck">
      <div className="chart-grid">{series.map((item) => <EngineeringPlot key={item.label} series={item} selectedEta={selectedEta} onSelect={onSelect} />)}</div>
      <details className="chart-table"><summary>Table alternative</summary><div><table><caption>Right-semispan values for {series.map((item) => item.label).join(' and ')}</caption><thead><tr><th scope="col">η</th>{series.map((item) => <th scope="col" key={item.label}>{item.label} ({item.unit})</th>)}</tr></thead><tbody>{series[0].points.map((point, index) => <tr key={point.eta}><th scope="row">{point.eta.toFixed(3)}</th>{series.map((item) => <td key={item.label}>{item.points[index]?.value === null || item.points[index]?.value === undefined ? '—' : item.points[index].value!.toPrecision(5)}</td>)}</tr>)}</tbody></table></div></details>
    </div>
  );
}
