'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalysisSnapshot, AngleSweepPoint } from '@/lib/domain/types';

const fmt = (value: number, digits = 1) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const SWEEP_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function AngleSweepScrubber({ analysis, point, onSelect, onInteractionChange }: { analysis: AnalysisSnapshot; point: AngleSweepPoint; onSelect: (alphaDeg: number) => void; onInteractionChange?: (active: boolean) => void }) {
  const { angleSweep } = analysis;
  const [draftAlphaDeg, setDraftAlphaDeg] = useState(point.alphaDeg);
  const lastEmittedAlphaDeg = useRef<number | null>(null);
  const convergedCount = angleSweep.points.filter((item) => item.status === 'converged').length;
  const failedCount = angleSweep.points.length - convergedCount;
  const draftIsSolved = angleSweep.points.some((item) => item.status === 'converged' && Math.abs(item.alphaDeg - draftAlphaDeg) <= 1e-10);
  const select = (alphaDeg: number) => {
    setDraftAlphaDeg(alphaDeg);
    if (lastEmittedAlphaDeg.current === alphaDeg) return;
    lastEmittedAlphaDeg.current = alphaDeg;
    onSelect(alphaDeg);
  };
  useEffect(() => () => onInteractionChange?.(false), [onInteractionChange]);
  return <section className="angle-sweep-explorer" aria-label="Angle of attack sweep explorer">
    <div className="angle-sweep-heading"><span><b>AOA SWEEP</b></span><strong>α {fmt(draftAlphaDeg, 2)}° · {draftIsSolved ? 'SOLVED' : 'INTERPOLATED'}</strong></div>
    <label className="angle-sweep-slider"><span className="sr-only">Selected angle of attack</span><input type="range" min={angleSweep.minimumAlphaDeg} max={angleSweep.maximumAlphaDeg} step="0.01" value={draftAlphaDeg} onPointerDown={() => onInteractionChange?.(true)} onPointerUp={() => onInteractionChange?.(false)} onPointerCancel={() => onInteractionChange?.(false)} onLostPointerCapture={() => onInteractionChange?.(false)} onKeyDown={(event) => { if (SWEEP_KEYS.has(event.key)) onInteractionChange?.(true); }} onKeyUp={(event) => { if (SWEEP_KEYS.has(event.key)) onInteractionChange?.(false); }} onBlur={() => onInteractionChange?.(false)} onInput={(event) => select(Number(event.currentTarget.value))} onChange={(event) => select(Number(event.currentTarget.value))} aria-valuetext={`${fmt(draftAlphaDeg, 2)} degrees angle of attack, ${draftIsSolved ? 'solved point' : 'interpolated display'}`} /></label>
    <div className="angle-sweep-markers"><span>{fmt(angleSweep.minimumAlphaDeg, 1)}°</span><span>Trim <b>{fmt(angleSweep.trimAlphaDeg, 2)}°</b></span>{angleSweep.bestLiftToDragAlphaDeg !== null && <span>Best sampled L/D <b>{fmt(angleSweep.bestLiftToDragAlphaDeg, 1)}°</b></span>}<span>{convergedCount}/{angleSweep.points.length} solved{failedCount ? ` · ${failedCount} unavailable` : ''}</span><span>{fmt(angleSweep.maximumAlphaDeg, 1)}°</span></div>
  </section>;
}
