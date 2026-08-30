'use client';

import type { AnalysisSnapshot, AngleSweepPoint } from '@/lib/domain/types';

const fmt = (value: number, digits = 1) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function AngleSweepScrubber({ analysis, point, onSelect }: { analysis: AnalysisSnapshot; point: AngleSweepPoint; onSelect: (alphaDeg: number) => void }) {
  const { angleSweep } = analysis;
  const convergedCount = angleSweep.points.filter((item) => item.status === 'converged').length;
  const failedCount = angleSweep.points.length - convergedCount;
  return <section className="angle-sweep-explorer" aria-label="Angle of attack sweep explorer">
    <div className="angle-sweep-heading"><span><b>AOA SWEEP</b> precomputed aeroelastic evidence</span><strong>α {fmt(point.alphaDeg, 1)}°</strong></div>
    <label className="angle-sweep-slider"><span className="sr-only">Selected angle of attack</span><input type="range" min={angleSweep.minimumAlphaDeg} max={angleSweep.maximumAlphaDeg} step={angleSweep.stepAlphaDeg} value={point.alphaDeg} onInput={(event) => onSelect(Number(event.currentTarget.value))} onChange={(event) => onSelect(Number(event.currentTarget.value))} aria-valuetext={`${fmt(point.alphaDeg, 1)} degrees angle of attack`} /></label>
    <div className="angle-sweep-markers"><span>{fmt(angleSweep.minimumAlphaDeg, 1)}°</span><span>Trim <b>{fmt(angleSweep.trimAlphaDeg, 2)}°</b></span>{angleSweep.bestLiftToDragAlphaDeg !== null && <span>Best sampled L/D <b>{fmt(angleSweep.bestLiftToDragAlphaDeg, 1)}°</b></span>}<span>{convergedCount}/{angleSweep.points.length} solved{failedCount ? ` · ${failedCount} unavailable` : ''}</span><span>{fmt(angleSweep.maximumAlphaDeg, 1)}°</span></div>
    <p>Slider selection changes visible plots, deformation, metrics, and 2D flow only. Official candidate checks remain tied to the highlighted target-lift trim.</p>
  </section>;
}
