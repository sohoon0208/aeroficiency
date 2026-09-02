'use client';

import { useId, useMemo, useState } from 'react';
import type { Actor, AirfoilDefinition, AirfoilStation, DesignConstraints, DomainResult, FlightCase, PolarModel, WingDesign, WingGeometry, WingStructure } from '@/lib/domain/types';
import type { AngleSweepPatch } from '@/lib/domain/commands';
import { MAX_AIRFOIL_STATIONS, MIN_AIRFOIL_STATION_SEPARATION } from '@/lib/domain/limits';
import { canonicalAirfoil } from '@/lib/solver/airfoilSections';

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

function AirfoilPreview({ definition }: { definition: AirfoilDefinition }) {
  const path = useMemo(() => {
    const section = canonicalAirfoil(definition, 64);
    const upper = section.upper.map(([x, z]) => `${x},${-z}`);
    const lower = [...section.lower].reverse().map(([x, z]) => `${x},${-z}`);
    return `M ${[...upper, ...lower].join(' L ')} Z`;
  }, [definition]);
  const section = useMemo(() => canonicalAirfoil(definition, 64), [definition]);
  return (
    <div className="airfoil-preview">
      <svg viewBox="-0.03 -0.14 1.06 0.28" role="img" aria-label={`${section.label} airfoil section`} preserveAspectRatio="none"><line x1="0" x2="1" y1="0" y2="0" /><path d={path} /></svg>
      <small>{(100 * section.maximumThicknessRatio).toFixed(1)}% thickness · {(100 * section.maximumCamberRatio).toFixed(1)}% max camber</small>
    </div>
  );
}

export function GeometryEditor({ design, editable, changedFields, changedActor, onUpdate }: { design: WingDesign; editable: boolean; changedFields: string[]; changedActor: Actor | null; onUpdate: (patch: Partial<WingGeometry>) => DomainResult<unknown> }) {
  const changed = (field: string) => changedFields.includes(`geometry.${field}`);
  return (
    <div className="editor-stack">
      <section className="control-group">
        <div className="group-heading"><h3>Wing geometry</h3><span>Supported model bounds</span></div>
        <div className="control-grid">
          <NumberInput label="Projected span" value={design.geometry.spanM} unit="m" min={4} max={16} step={0.1} disabled={!editable} changedBy={changed('spanM') ? changedActor : null} onCommit={(spanM) => onUpdate({ spanM })} />
          <NumberInput label="Root chord" value={design.geometry.rootChordM} unit="m" min={0.8} max={4} step={0.01} disabled={!editable} changedBy={changed('rootChordM') ? changedActor : null} onCommit={(rootChordM) => onUpdate({ rootChordM })} />
          <NumberInput label="Tip chord" value={design.geometry.tipChordM} unit="m" min={0.3} max={3} step={0.01} disabled={!editable} changedBy={changed('tipChordM') ? changedActor : null} onCommit={(tipChordM) => onUpdate({ tipChordM })} />
          <NumberInput label="Tip twist" value={design.geometry.tipTwistDeg} unit="deg" min={-6} max={3} step={0.1} disabled={!editable} changedBy={changed('tipTwistDeg') ? changedActor : null} onCommit={(tipTwistDeg) => onUpdate({ tipTwistDeg })} />
        </div>
      </section>
      {!editable && <div className="protected-note"><span aria-hidden="true">◆</span><p><strong>This design is read-only.</strong><br />Editing is unavailable in this view.</p></div>}
    </div>
  );
}

const NACA_PATTERN = /^(00(0[6-9]|1[0-9]|2[0-4])|[1-6][1-9](0[6-9]|1[0-9]|2[0-4]))$/;

function AirfoilStationEditor({
  station,
  index,
  count,
  editable,
  minimumEta,
  maximumEta,
  onChange,
  onRemove,
}: {
  station: AirfoilStation;
  index: number;
  count: number;
  editable: boolean;
  minimumEta: number;
  maximumEta: number;
  onChange: (station: AirfoilStation) => DomainResult<unknown>;
  onRemove: () => void;
}) {
  const [nacaDraft, setNacaDraft] = useState(station.airfoil.kind === 'NACA4' ? station.airfoil.code : '2412');
  const [coordinateName, setCoordinateName] = useState(station.airfoil.kind === 'COORDINATES' ? station.airfoil.name : `${station.id} imported`);
  const [coordinateSource, setCoordinateSource] = useState(station.airfoil.kind === 'COORDINATES' ? station.airfoil.source ?? '' : '');
  const [coordinateText, setCoordinateText] = useState(station.airfoil.kind === 'COORDINATES'
    ? station.airfoil.points.map(([x, z]) => `${x} ${z}`).join('\n')
    : '');
  const [error, setError] = useState('');
  const errorId = useId();
  const endpoint = index === 0 || index === count - 1;
  const profileValue = station.airfoil.kind === 'NACA4' ? 'NACA4' : 'CUSTOM';
  const applyProfile = (value: string) => {
    setError('');
    if (value !== 'NACA4') return;
    const airfoil: AirfoilDefinition = { kind: 'NACA4', code: NACA_PATTERN.test(nacaDraft) ? nacaDraft : '2412' };
    const result = onChange({ ...station, airfoil });
    if (!result.ok) setError(result.error.issues?.[0]?.reason ?? result.error.message);
  };
  const commitNaca = () => {
    const code = nacaDraft.trim();
    if (!NACA_PATTERN.test(code)) { setError('Use a supported four-digit NACA code with 6–24% thickness.'); return; }
    if (station.airfoil.kind === 'NACA4' && code === station.airfoil.code) {
      setError('');
      setNacaDraft(station.airfoil.code);
      return;
    }
    const result = onChange({ ...station, airfoil: { kind: 'NACA4', code } });
    if (!result.ok) setError(result.error.issues?.[0]?.reason ?? result.error.message); else setError('');
  };
  const importCoordinates = () => {
    const points: Array<readonly [number, number]> = [];
    for (const line of coordinateText.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue;
      const values = trimmed.replace(/,/g, ' ').split(/\s+/).slice(0, 2).map(Number);
      if (values.length < 2 || values.some((value) => !Number.isFinite(value))) continue;
      points.push([values[0], values[1]]);
    }
    if (points.length < 24 || points.length > 161) { setError('Paste 24–161 finite x/z contour points; a text title line is allowed.'); return; }
    const definition: AirfoilDefinition = { kind: 'COORDINATES', name: coordinateName.trim(), points, ...(coordinateSource.trim() ? { source: coordinateSource.trim() } : {}) };
    const result = onChange({ ...station, airfoil: definition });
    if (!result.ok) setError(result.error.issues?.[0]?.reason ?? result.error.message); else setError('');
  };
  return (
    <article className="airfoil-station-card">
      <div className="station-card-heading"><div><span>{endpoint ? index === 0 ? 'ROOT' : 'TIP' : `STATION ${index + 1}`}</span><strong>{station.id}</strong></div><b>η {station.eta.toFixed(3)}</b>{!endpoint && <button type="button" disabled={!editable} onClick={onRemove} aria-label={`Remove airfoil station ${station.id}`}>Remove</button>}</div>
      <NumberInput label={`Station ${station.id} eta`} value={station.eta} unit="η" min={endpoint ? station.eta : minimumEta} max={endpoint ? station.eta : maximumEta} step={0.01} disabled={!editable || endpoint} onCommit={(eta) => onChange({ ...station, eta })} />
      <label className="airfoil-library-field"><span>Airfoil profile</span><select aria-label={`Airfoil profile at eta ${station.eta.toFixed(3)}`} value={profileValue} disabled={!editable} onChange={(event) => applyProfile(event.target.value)}><option value="NACA4">NACA four-digit · custom code</option>{station.airfoil.kind === 'COORDINATES' && <option value="CUSTOM">Custom imported contour</option>}</select><small>{station.airfoil.kind === 'NACA4' ? 'Parametric four-digit NACA geometry.' : 'User-supplied coordinate geometry.'}</small></label>
      {station.airfoil.kind === 'NACA4'
        ? <label className="naca-field"><span>NACA four-digit</span><input aria-label={`NACA code at eta ${station.eta.toFixed(3)}`} aria-describedby={error ? errorId : undefined} value={nacaDraft} maxLength={4} disabled={!editable} onChange={(event) => { setError(''); setNacaDraft(event.target.value.replace(/\D/g, '')); }} onBlur={commitNaca} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></label>
        : <div className="coordinate-summary"><span>Imported contour</span><strong>{station.airfoil.name}</strong><small>{station.airfoil.points.length} source points{station.airfoil.source ? ` · ${station.airfoil.source}` : ''}</small><button type="button" disabled={!editable} onClick={() => { setNacaDraft('2412'); const result = onChange({ ...station, airfoil: { kind: 'NACA4', code: '2412' } }); if (!result.ok) setError(result.error.message); }}>Replace with NACA</button></div>}
      <AirfoilPreview definition={station.airfoil} />
      {index < count - 1 && <label className="station-blend"><span>Interpolation to next station</span><select aria-label={`Blend after ${station.id}`} value={station.blendToNext} disabled={!editable} onChange={(event) => onChange({ ...station, blendToNext: event.target.value as AirfoilStation['blendToNext'] })}><option value="LINEAR_CAMBER_THICKNESS">Camber + half-thickness</option><option value="HOLD">Hold this section</option></select></label>}
      <details className="coordinate-import"><summary>{station.airfoil.kind === 'COORDINATES' ? 'Replace coordinate contour' : 'Import coordinate contour'}</summary><div><label>Name<input value={coordinateName} maxLength={40} disabled={!editable} onChange={(event) => setCoordinateName(event.target.value)} /></label><label>Source / provenance<input value={coordinateSource} maxLength={120} disabled={!editable} onChange={(event) => setCoordinateSource(event.target.value)} /></label><label>Contour points<textarea aria-label={`Coordinate contour at eta ${station.eta.toFixed(3)}`} value={coordinateText} disabled={!editable} placeholder={'Airfoil name (optional title line)\n1.0000 0.0013\n0.9500 0.0114\n…'} onChange={(event) => setCoordinateText(event.target.value)} /></label><button className="button compact" type="button" disabled={!editable} onClick={importCoordinates}>Normalize & apply contour</button></div></details>
      {error && <small id={errorId} className="field-error station-error" role="alert">{error}</small>}
    </article>
  );
}

export function AirfoilEditor({ design, editable, changedFields, changedActor, onUpdate }: { design: WingDesign; editable: boolean; changedFields: string[]; changedActor: Actor | null; onUpdate: (patch: Partial<WingGeometry>) => DomainResult<unknown> }) {
  const [polarText, setPolarText] = useState('');
  const [polarError, setPolarError] = useState('');
  const stations = design.geometry.airfoilStations;
  const userPolarsActive = design.geometry.polarModel.kind === 'USER_TABLES';
  const commitStations = (nextStations: AirfoilStation[]) => onUpdate({
    airfoilStations: [...nextStations].sort((left, right) => left.eta - right.eta),
    ...(userPolarsActive ? { polarModel: { kind: 'ANALYTIC_ATTACHED', tables: [] } as PolarModel } : {}),
  });
  const updateStation = (index: number, station: AirfoilStation) => {
    const next = structuredClone(stations);
    next[index] = station;
    return commitStations(next);
  };
  const addStation = () => {
    if (stations.length >= MAX_AIRFOIL_STATIONS) return;
    let gapIndex = 0;
    for (let index = 1; index < stations.length - 1; index += 1) {
      if (stations[index + 1].eta - stations[index].eta > stations[gapIndex + 1].eta - stations[gapIndex].eta) gapIndex = index;
    }
    const used = new Set(stations.map((station) => station.id));
    let suffix = 1;
    while (used.has(`afs_mid${suffix}`)) suffix += 1;
    const left = stations[gapIndex];
    const next = structuredClone(stations);
    next.splice(gapIndex + 1, 0, {
      id: `afs_mid${suffix}`,
      eta: (left.eta + stations[gapIndex + 1].eta) / 2,
      airfoil: structuredClone(left.airfoil),
      blendToNext: left.blendToNext,
    });
    void commitStations(next);
  };
  const applyPolarTables = () => {
    try {
      const parsed = JSON.parse(polarText) as unknown;
      const candidate = Array.isArray(parsed) ? { kind: 'USER_TABLES', tables: parsed } : parsed;
      if (!candidate || typeof candidate !== 'object') throw new Error('Paste a polar-model object or an array of SectionPolar tables.');
      const result = onUpdate({ polarModel: candidate as PolarModel });
      if (!result.ok) setPolarError(result.error.issues?.[0]?.reason ?? result.error.message); else setPolarError('');
    } catch (error) {
      setPolarError(error instanceof Error ? error.message : 'Polar JSON could not be parsed.');
    }
  };
  return (
    <div className="editor-stack airfoil-editor">
      <section className="control-group">
        <div className="group-heading"><h3>Spanwise airfoil stations</h3><span className="capability-badge">V4 · {stations.length} / {MAX_AIRFOIL_STATIONS}</span></div>
        <p className="editor-intro">Root and tip are required. Choose a supported NACA four-digit section or a custom coordinate contour at every station. Intermediate sections blend camber and half-thickness independently.</p>
        <div className="airfoil-station-list">{stations.map((station, index) => <AirfoilStationEditor key={station.id} station={station} index={index} count={stations.length} editable={editable} minimumEta={index === 0 ? 0 : stations[index - 1].eta + MIN_AIRFOIL_STATION_SEPARATION} maximumEta={index === stations.length - 1 ? 1 : stations[index + 1].eta - MIN_AIRFOIL_STATION_SEPARATION} onChange={(next) => updateStation(index, next)} onRemove={() => { const next = structuredClone(stations); next.splice(index, 1); void commitStations(next); }} />)}</div>
        <button className="candidate-button add-station" type="button" disabled={!editable || stations.length >= MAX_AIRFOIL_STATIONS} onClick={addStation}>＋ Add intermediate section</button>
        {changedFields.includes('geometry.airfoilStations') && changedActor && <p className="mutation-note"><b className={`agent-chip actor-${changedActor}`}>{mutationLabel(changedActor)}</b> updated the spanwise section definition.</p>}
        {userPolarsActive && <p className="scientific-warning"><strong>Polar consistency guard.</strong> Editing section geometry automatically returns this design to the analytic estimate so an old table cannot be silently assigned to a changed airfoil.</p>}
      </section>
      <section className="control-group polar-editor">
        <div className="group-heading"><h3>Section polar source</h3><span className={userPolarsActive ? 'success-text' : ''}>{userPolarsActive ? `${design.geometry.polarModel.tables.length} user tables` : 'Analytic estimate'}</span></div>
        <p className="editor-intro">V5 couples local Reynolds number, C<sub>l</sub>, C<sub>d</sub>, and C<sub>m</sub>. The built-in model is explicitly an attached-flow estimate; imported XFOIL or experimental tables retain provenance and range states.</p>
        <div className="polar-source-card"><span>Active source</span><strong>{userPolarsActive ? 'User section tables' : 'Aeroficiency analytic attached-flow estimate'}</strong><small>{userPolarsActive ? 'Interpolation by station, Reynolds number, and angle of attack.' : 'Not an experimental correlation and not a stall model.'}</small>{userPolarsActive && <button className="button compact" type="button" disabled={!editable} onClick={() => onUpdate({ polarModel: { kind: 'ANALYTIC_ATTACHED', tables: [] } })}>Use analytic estimate</button>}</div>
        <details className="polar-import"><summary>Import bounded SectionPolar JSON</summary><div><textarea aria-label="Section polar JSON" value={polarText} disabled={!editable} placeholder={'[{"polarId":"root_re1m","airfoilStationId":"afs_root","reynolds":1000000,"mach":0,"rows":[…],"provenance":{"source":"XFOIL","label":"XFOIL 6.99"}}, …]'} onChange={(event) => { setPolarText(event.target.value); setPolarError(''); }} /><button className="button compact" type="button" disabled={!editable || !polarText.trim()} onClick={applyPolarTables}>Validate & use tables</button>{polarError && <small className="field-error" role="alert">{polarError}</small>}</div></details>
      </section>
      {!editable && <div className="protected-note"><span aria-hidden="true">◆</span><p><strong>This design is read-only.</strong><br />Editing is unavailable in this view.</p></div>}
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
      {!editable && <div className="protected-note"><span aria-hidden="true">◆</span><p><strong>This design is read-only.</strong><br />Editing is unavailable in this view.</p></div>}
    </div>
  );
}

export function CaseEditor({ flightCase, constraints, editable, onUpdate }: { flightCase: FlightCase; constraints: DesignConstraints; editable: boolean; onUpdate: (patch: Partial<AngleSweepPatch>) => DomainResult<unknown> }) {
  const [showSweepInfo, setShowSweepInfo] = useState(false);
  const pointCount = Math.round((flightCase.sweepMaxAlphaDeg - flightCase.sweepMinAlphaDeg) / flightCase.sweepStepAlphaDeg) + 1;
  return (
    <div className="editor-stack">
      <section className="control-group"><div className="group-heading"><h3>Target-lift case</h3><span>Revision {flightCase.revision}</span></div><div className="section-facts"><div><span>Target lift</span><strong>{(flightCase.targetLiftN / 1000).toFixed(1)} kN</strong></div><div><span>Velocity</span><strong>{flightCase.velocityMps.toFixed(1)} m/s</strong></div><div><span>Air density</span><strong>{flightCase.airDensityKgM3.toFixed(3)} kg/m³</strong></div><div><span>Altitude</span><strong>{flightCase.altitudeM.toFixed(0)} m</strong></div></div></section>
      <section className="control-group angle-sweep-config"><div className="group-heading"><div className="case-heading-with-info"><h3>Angle-of-attack sweep</h3><button className="info-button" type="button" aria-label="Show angle-of-attack sweep information" aria-expanded={showSweepInfo} aria-controls="angle-sweep-info" onClick={() => setShowSweepInfo((visible) => !visible)}>i</button></div><span>{pointCount} coupled points</span></div>{showSweepInfo && <p className="editor-info" id="angle-sweep-info" role="note">Choose the shared range before running. The target-lift trim remains the official comparison point and is marked inside the completed sweep.</p>}<div className="control-grid"><NumberInput label="Minimum AoA" value={flightCase.sweepMinAlphaDeg} unit="deg" min={-8} max={flightCase.sweepMaxAlphaDeg - 2} step={0.5} disabled={!editable} onCommit={(sweepMinAlphaDeg) => onUpdate({ sweepMinAlphaDeg })} /><NumberInput label="Maximum AoA" value={flightCase.sweepMaxAlphaDeg} unit="deg" min={flightCase.sweepMinAlphaDeg + 2} max={12} step={0.5} disabled={!editable} onCommit={(sweepMaxAlphaDeg) => onUpdate({ sweepMaxAlphaDeg })} /></div><label className="sweep-step-field"><span>Calculation interval</span><select aria-label="Angle of attack sweep increment" value={flightCase.sweepStepAlphaDeg} disabled={!editable} onChange={(event) => onUpdate({ sweepStepAlphaDeg: Number(event.target.value) as FlightCase['sweepStepAlphaDeg'] })}><option value="0.5">Detailed · 0.5°</option><option value="1">Faster · 1.0°</option></select><small>Every point receives its own fixed-AoA torsion-coupled solve.</small></label></section>
      <section className="control-group"><div className="group-heading"><h3>Configured trade-study checks</h3><span>Revision {constraints.revision}</span></div><div className="section-facts"><div><span>Modeled wall-mass reduction</span><strong>≥ {constraints.minMassReductionPct.toFixed(1)}%</strong></div><div><span>Modeled yield ratio</span><strong>≥ {constraints.minYieldMargin.toFixed(2)}×</strong></div><div><span>Tip deflection</span><strong>≤ {constraints.maxTipDeflectionM.toFixed(2)} m</strong></div><div><span>Wake-drag estimate</span><strong>≤ baseline</strong></div><div><span>Static convergence</span><strong>Required</strong></div></div></section>
    </div>
  );
}
