'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnalysisSnapshot, AngleSweepPoint } from '@/lib/domain/types';

const fmt = (value: number, digits = 1) => value.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const PREVIEW_INTERVAL_MS = 50;
const SETTLE_DELAY_MS = 160;

export function AngleSweepScrubber({
  analysis,
  point,
  onSelect,
  onInteractionChange = () => undefined,
}: {
  analysis: AnalysisSnapshot;
  point: AngleSweepPoint;
  onSelect: (alphaDeg: number) => void;
  onInteractionChange?: (active: boolean) => void;
}) {
  const { angleSweep } = analysis;
  const [draftAlphaDeg, setDraftAlphaDeg] = useState(point.alphaDeg);
  const latestAlphaRef = useRef(point.alphaDeg);
  const lastEmittedAlphaRef = useRef(point.alphaDeg);
  const interactionActiveRef = useRef(false);
  const previewPublishedRef = useRef(false);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectRef = useRef(onSelect);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const convergedCount = angleSweep.points.filter((item) => item.status === 'converged').length;
  const failedCount = angleSweep.points.length - convergedCount;
  const draftIsSolved = angleSweep.points.some((item) => item.status === 'converged' && Math.abs(item.alphaDeg - draftAlphaDeg) <= 1e-10);

  const beginInteraction = () => {
    if (interactionActiveRef.current) return;
    interactionActiveRef.current = true;
  };
  const publishPreview = () => {
    if (previewPublishedRef.current) return;
    previewPublishedRef.current = true;
    onInteractionChangeRef.current(true);
  };
  const emitLatest = () => {
    const alphaDeg = latestAlphaRef.current;
    if (Math.abs(alphaDeg - lastEmittedAlphaRef.current) <= 1e-10) return;
    lastEmittedAlphaRef.current = alphaDeg;
    onSelectRef.current(alphaDeg);
  };
  const finishInteraction = () => {
    if (previewTimerRef.current !== null) clearTimeout(previewTimerRef.current);
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    previewTimerRef.current = null;
    settleTimerRef.current = null;
    emitLatest();
    if (!interactionActiveRef.current) return;
    interactionActiveRef.current = false;
    if (previewPublishedRef.current) {
      previewPublishedRef.current = false;
      onInteractionChangeRef.current(false);
    }
  };
  const select = (alphaDeg: number) => {
    if (!Number.isFinite(alphaDeg) || Math.abs(alphaDeg - latestAlphaRef.current) <= 1e-10) return;
    setDraftAlphaDeg(alphaDeg);
    latestAlphaRef.current = alphaDeg;
    beginInteraction();
    if (previewTimerRef.current === null) {
      previewTimerRef.current = setTimeout(() => {
        previewTimerRef.current = null;
        publishPreview();
        emitLatest();
      }, PREVIEW_INTERVAL_MS);
    }
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
    settleTimerRef.current = setTimeout(finishInteraction, SETTLE_DELAY_MS);
  };

  useEffect(() => {
    onSelectRef.current = onSelect;
    onInteractionChangeRef.current = onInteractionChange;
  }, [onInteractionChange, onSelect]);

  useEffect(() => {
    if (interactionActiveRef.current) return;
    setDraftAlphaDeg(point.alphaDeg);
    latestAlphaRef.current = point.alphaDeg;
    lastEmittedAlphaRef.current = point.alphaDeg;
  }, [point.alphaDeg]);

  useEffect(() => () => {
    if (previewTimerRef.current !== null) clearTimeout(previewTimerRef.current);
    if (settleTimerRef.current !== null) clearTimeout(settleTimerRef.current);
  }, []);

  return <section className="angle-sweep-explorer" aria-label="Angle of attack sweep explorer">
    <div className="angle-sweep-heading"><span><b>AOA SWEEP</b></span><strong>α {fmt(draftAlphaDeg, 2)}° · {draftIsSolved ? 'SOLVED' : 'INTERPOLATED'}</strong></div>
    <label className="angle-sweep-slider"><span className="sr-only">Selected angle of attack</span><input type="range" min={angleSweep.minimumAlphaDeg} max={angleSweep.maximumAlphaDeg} step="0.01" value={draftAlphaDeg} onInput={(event) => select(Number(event.currentTarget.value))} onChange={(event) => select(Number(event.currentTarget.value))} onPointerUp={finishInteraction} onPointerCancel={finishInteraction} onKeyUp={finishInteraction} onBlur={finishInteraction} aria-valuetext={`${fmt(draftAlphaDeg, 2)} degrees angle of attack, ${draftIsSolved ? 'solved point' : 'interpolated display'}`} /></label>
    <div className="angle-sweep-markers"><span>{fmt(angleSweep.minimumAlphaDeg, 1)}°</span><span>Trim <b>{fmt(angleSweep.trimAlphaDeg, 2)}°</b></span>{angleSweep.bestLiftToDragAlphaDeg !== null && <span>Best sampled L/D <b>{fmt(angleSweep.bestLiftToDragAlphaDeg, 1)}°</b></span>}<span>{convergedCount}/{angleSweep.points.length} solved{failedCount ? ` · ${failedCount} unavailable` : ''}</span><span>{fmt(angleSweep.maximumAlphaDeg, 1)}°</span></div>
  </section>;
}
