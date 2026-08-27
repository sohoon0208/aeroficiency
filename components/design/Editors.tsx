'use client';

import { useId, useMemo, useState } from 'react';
import type { Actor, DesignConstraints, DomainResult, FlightCase, WingDesign, WingGeometry, WingStructure } from '@/lib/domain/types';
import { sampleNaca4 } from '@/lib/solver/naca';

interface NumberInputProps {
  label: string; value: number; unit: string; min: number; max: number; step: number; disabled: boolean; changedBy?: Actor | null; onCommit: (value: number) => DomainResult<unknown>;
}

function mutationLabel(actor: Actor | null | undefined) {
  return actor === 'agent' ? 'Agent' : actor === 'human' ? 'You' : actor === 'solver' ? 'Solver' : 'System';
}

function NumberInput({ label, value, unit, min, max, step, disabled, changedBy, onCommit }: NumberInputProps) {
  const [draft, setDraft] = useState(String(value));
  const [error, setError] = useState('');
  const errorId = useId();
  const commit = () => {
    const next = Number(draft);
    if (!Number.isFinite(next) || next < min || next > max) {
      setError(`Use ${min}–${max} ${unit}`);
      setDraft(String(value));
      return;
    }
    if (next === value) { setError(''); setDraft(String(value)); return; }
    const result = onCommit(next);
    if (!result.ok) {
      setError(result.error.issues?.[0]?.reason ?? result.error.message);
      setDraft(String(value));
      return;
    }
    setError('');
  };
  return (
    <label className={`number-field ${changedBy ? 'field-changed' : ''}`}>
      <span>{label}{changedBy && <b className={`agent-chip actor-${changedBy}`}>{mutationLabel(changedBy)}</b>}</span>
      <span className="field-shell">
        <input aria-label={`${label} in ${unit}`} aria-describedby={error ? errorId : undefined} type="number" inputMode="decimal" value={draft} min={min} max={max} step={step} disabled={disabled} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setError(''); setDraft(String(value)); event.currentTarget.blur(); } }} aria-invalid={Boolean(error)} />
        <b>{unit}</b>
      </span>
      {error && <small id={errorId} className="field-error" role="alert">{error}</small>}
    </label>
  );
}

function AirfoilPreview({ code }: { code: string }) {
  const path = useMemo(() => {
    const points = sampleNaca4(code, 64);
    const upper = points.map((point) => `${point.xUpper},${-point.zUpper}`);
    const lower = [...points].reverse().map((point) => `${point.xLower},${-point.zLower}`);
    return `M ${[...upper, ...lower].join(' L ')} Z`;
  }, [code]);
  return (
    <div className="airfoil-preview">
      <svg viewBox="-0.03 -0.14 1.06 0.28" role="img" aria-label={`NACA ${code} airfoil section`} preserveAspectRatio="none"><line x1="0" x2="1" y1="0" y2="0" /><path d={path} /></svg>
      <small>{Number(code.slice(2))}% thickness · {Number(code[0])}% camber</small>
    </div>
  );
}

export function GeometryEditor({ design, editable, changedFields, changedActor, onUpdate }: { design: WingDesign; editable: boolean; changedFields: string[]; changedActor: Actor | null; onUpdate: (patch: Partial<WingGeometry>) => DomainResult<unknown> }) {
  const [naca, setNaca] = useState(design.geometry.nacaCode);
  const [nacaError, setNacaError] = useState('');
  const nacaErrorId = useId();
  const changed = (field: string) => changedFields.includes(`geometry.${field}`);
  const commitNaca = () => {
    const normalized = naca.trim();
    if (!/^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/.test(normalized)) {
      setNacaError('Use a supported four-digit NACA code with 6–24% thickness.');
      setNaca(design.geometry.nacaCode);
      return;
    }
    if (normalized === design.geometry.nacaCode) { setNacaError(''); return; }
    const result = onUpdate({ nacaCode: normalized });
    if (!result.ok) {
      setNacaError(result.error.issues?.[0]?.reason ?? result.error.message);
      setNaca(design.geometry.nacaCode);
      return;
    }
    setNacaError('');
  };
  return (
    <div className="editor-stack">
      <section className="control-group">
        <div className="group-heading"><h3>Wing geometry</h3><span>Validated range</span></div>
        <div className="control-grid">
          <NumberInput label="Projected span" value={design.geometry.spanM} unit="m" min={4} max={16} step={0.1} disabled={!editable} changedBy={changed('spanM') ? changedActor : null} onCommit={(spanM) => onUpdate({ spanM })} />
          <NumberInput label="Root chord" value={design.geometry.rootChordM} unit="m" min={0.8} max={4} step={0.01} disabled={!editable} changedBy={changed('rootChordM') ? changedActor : null} onCommit={(rootChordM) => onUpdate({ rootChordM })} />
          <NumberInput label="Tip chord" value={design.geometry.tipChordM} unit="m" min={0.3} max={3} step={0.01} disabled={!editable} changedBy={changed('tipChordM') ? changedActor : null} onCommit={(tipChordM) => onUpdate({ tipChordM })} />
          <NumberInput label="Tip twist" value={design.geometry.tipTwistDeg} unit="deg" min={-6} max={3} step={0.1} disabled={!editable} changedBy={changed('tipTwistDeg') ? changedActor : null} onCommit={(tipTwistDeg) => onUpdate({ tipTwistDeg })} />
        </div>
      </section>
      <section className="control-group">
        <div className="group-heading"><h3>Airfoil section</h3><span>Single section</span></div>
        <label className={`naca-field ${changed('nacaCode') ? 'field-changed' : ''}`}><span>NACA four-digit{changed('nacaCode') && changedActor && <b className={`agent-chip actor-${changedActor}`}>{mutationLabel(changedActor)}</b>}</span><input aria-label="NACA four-digit code" aria-describedby={nacaError ? nacaErrorId : undefined} aria-invalid={Boolean(nacaError)} value={naca} maxLength={4} disabled={!editable} onChange={(event) => { setNacaError(''); setNaca(event.target.value.replace(/\D/g, '')); }} onBlur={commitNaca} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { setNacaError(''); setNaca(design.geometry.nacaCode); event.currentTarget.blur(); } }} />{nacaError && <small id={nacaErrorId} className="field-error" role="alert">{nacaError}</small>}</label>
        <AirfoilPreview code={design.geometry.nacaCode} />
      </section>
      {!editable && <div className="protected-note"><span aria-hidden="true">◆</span><p><strong>Baseline is protected.</strong><br />Create a candidate to edit geometry.</p></div>}
    </div>
  );
}

export function StructureEditor({ design, editable, changedFields, changedActor, onUpdate }: { design: WingDesign; editable: boolean; changedFields: string[]; changedActor: Actor | null; onUpdate: (patch: Partial<WingStructure>) => DomainResult<unknown> }) {
  const changed = (field: string) => changedFields.includes(`structure.${field}`);
  return (
    <div className="editor-stack">
      <section className="control-group">
        <div className="group-heading"><h3>Closed wing box</h3><span>Al 2024-T3</span></div>
        <div className="control-grid">
          <NumberInput label="Skin gauge" value={design.structure.skinThicknessMm} unit="mm" min={1.2} max={6} step={0.1} disabled={!editable} changedBy={changed('skinThicknessMm') ? changedActor : null} onCommit={(skinThicknessMm) => onUpdate({ skinThicknessMm })} />
          <NumberInput label="Front web" value={design.structure.frontWebThicknessMm} unit="mm" min={1.5} max={8} step={0.1} disabled={!editable} changedBy={changed('frontWebThicknessMm') ? changedActor : null} onCommit={(frontWebThicknessMm) => onUpdate({ frontWebThicknessMm })} />
          <NumberInput label="Rear web" value={design.structure.rearWebThicknessMm} unit="mm" min={1.5} max={8} step={0.1} disabled={!editable} changedBy={changed('rearWebThicknessMm') ? changedActor : null} onCommit={(rearWebThicknessMm) => onUpdate({ rearWebThicknessMm })} />
          <NumberInput label="Elastic axis" value={design.structure.elasticAxisXOverC} unit="x/c" min={0.21} max={0.55} step={0.01} disabled={!editable} changedBy={changed('elasticAxisXOverC') ? changedActor : null} onCommit={(elasticAxisXOverC) => onUpdate({ elasticAxisXOverC })} />
        </div>
      </section>
      <section className="section-facts" aria-label="Fixed structural assumptions"><div><span>Front spar</span><strong>0.20 c</strong></div><div><span>Rear spar</span><strong>0.65 c</strong></div><div><span>Young&apos;s modulus</span><strong>73.1 GPa</strong></div><div><span>Yield strength</span><strong>345 MPa</strong></div></section>
      <div className="model-note"><span>i</span><p><strong>Yield model only</strong><br />Buckling, fatigue, local failure, and certification loads are not evaluated.</p></div>
      {!editable && <div className="protected-note"><span aria-hidden="true">◆</span><p><strong>Baseline is protected.</strong><br />Create a candidate to edit structure.</p></div>}
    </div>
  );
}

export function CaseEditor({ flightCase, constraints }: { flightCase: FlightCase; constraints: DesignConstraints }) {
  return (
    <div className="editor-stack">
      <section className="control-group"><div className="group-heading"><h3>Target-lift case</h3><span>Revision {flightCase.revision}</span></div><div className="section-facts"><div><span>Target lift</span><strong>{(flightCase.targetLiftN / 1000).toFixed(1)} kN</strong></div><div><span>Velocity</span><strong>{flightCase.velocityMps.toFixed(1)} m/s</strong></div><div><span>Air density</span><strong>{flightCase.airDensityKgM3.toFixed(3)} kg/m³</strong></div><div><span>Altitude</span><strong>{flightCase.altitudeM.toFixed(0)} m</strong></div></div></section>
      <section className="control-group"><div className="group-heading"><h3>Acceptance constraints</h3><span>Revision {constraints.revision}</span></div><div className="section-facts"><div><span>Mass reduction</span><strong>≥ {constraints.minMassReductionPct.toFixed(1)}%</strong></div><div><span>Yield margin</span><strong>≥ {constraints.minYieldMargin.toFixed(2)}×</strong></div><div><span>Tip deflection</span><strong>≤ {constraints.maxTipDeflectionM.toFixed(2)} m</strong></div><div><span>Induced drag</span><strong>≤ baseline</strong></div></div></section>
      <div className="locked-case"><span aria-hidden="true">◇</span><p>The shared reference case is fixed for the deterministic challenge trade study.</p></div>
    </div>
  );
}
