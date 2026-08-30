import { MAX_POLAR_ROWS, MAX_POLAR_TABLES } from '@/lib/domain/limits';
import type { DomainIssue, PolarRow, SectionPolar, WingGeometry } from '@/lib/domain/types';
import { localAirfoilSection, resolvedAirfoilStations, type LocalAirfoilSection } from './airfoilSections';

export interface PolarEvaluation {
  cl: number;
  cd: number;
  cm: number;
  state: 'within_range' | 'extrapolated_alpha' | 'outside_reynolds' | 'outside_alpha' | 'analytic_estimate';
  provenance: string;
  alphaRangeDeg: readonly [number, number];
  reynoldsRange: readonly [number, number];
}

const analyticPolarCache = new WeakMap<LocalAirfoilSection, Map<number, SectionPolar>>();

function analyticCoefficients(section: LocalAirfoilSection, reynolds: number, alphaDeg: number): PolarRow {
  const alphaEffectiveRad = alphaDeg * Math.PI / 180 - section.zeroLiftAngleRad;
  const linearLift = 2 * Math.PI * alphaEffectiveRad;
  /** Smooth attached-flow cap prevents an unbounded surrogate; it is not a stall model. */
  const attachedLimit = Math.max(1.15, Math.min(1.65, 1.32 + 1.5e-8 * (reynolds - 1e6) + 0.8 * section.maximumCamberRatio));
  const cl = linearLift / (1 + (Math.abs(linearLift) / attachedLimit) ** 8) ** (1 / 8);
  const boundedReynolds = Math.max(8e4, reynolds);
  const turbulentSkinFriction = 0.455 / Math.log10(boundedReynolds) ** 2.58;
  const thickness = section.maximumThicknessRatio;
  const formFactor = 1 + 2 * thickness + 60 * thickness ** 4;
  const cd0 = 2 * turbulentSkinFriction * formFactor;
  const liftDependentProfileDrag = (0.006 + 0.01 * thickness) * cl ** 2;
  return {
    alphaDeg,
    cl,
    cd: Math.max(1e-5, cd0 + liftDependentProfileDrag),
    cm: section.quarterChordMomentCoefficient,
  };
}

export function generatedAnalyticPolar(section: LocalAirfoilSection, reynolds: number): SectionPolar {
  const cacheKey = Math.round(reynolds);
  const cached = analyticPolarCache.get(section)?.get(cacheKey);
  if (cached) return cached;
  const rows = Array.from({ length: 29 }, (_, index) => analyticCoefficients(section, reynolds, -12 + index));
  const result: SectionPolar = {
    polarId: `analytic_${section.leftStationId}_${section.rightStationId}_${Math.round(reynolds)}`,
    airfoilStationId: section.leftStationId,
    reynolds,
    mach: 0,
    transitionModel: 'fully_turbulent_flat_plate_form_factor',
    rows,
    provenance: {
      source: 'ANALYTIC_ESTIMATE',
      label: 'Aeroficiency attached-flow analytic estimate',
    },
  };
  const byReynolds = analyticPolarCache.get(section) ?? new Map<number, SectionPolar>();
  byReynolds.set(cacheKey, result);
  analyticPolarCache.set(section, byReynolds);
  return result;
}

function interpolateRows(rows: readonly PolarRow[], alphaDeg: number) {
  const first = rows[0];
  const last = rows.at(-1)!;
  let state: PolarEvaluation['state'] = 'within_range';
  let low = 0;
  let high = 1;
  if (alphaDeg < first.alphaDeg) {
    low = 0;
    high = 1;
    state = alphaDeg >= first.alphaDeg - 2 ? 'extrapolated_alpha' : 'outside_alpha';
  } else if (alphaDeg > last.alphaDeg) {
    low = rows.length - 2;
    high = rows.length - 1;
    state = alphaDeg <= last.alphaDeg + 2 ? 'extrapolated_alpha' : 'outside_alpha';
  } else {
    high = rows.findIndex((row) => row.alphaDeg >= alphaDeg);
    if (high <= 0) return { row: { ...first }, state, range: [first.alphaDeg, last.alphaDeg] as const };
    low = high - 1;
  }
  const denominator = rows[high].alphaDeg - rows[low].alphaDeg;
  const requestedFraction = denominator > 0 ? (alphaDeg - rows[low].alphaDeg) / denominator : 0;
  const fraction = state === 'outside_alpha' ? Math.max(0, Math.min(1, requestedFraction)) : requestedFraction;
  const interpolate = (field: 'cl' | 'cd' | 'cm') => rows[low][field] + fraction * (rows[high][field] - rows[low][field]);
  return {
    row: { alphaDeg, cl: interpolate('cl'), cd: Math.max(0, interpolate('cd')), cm: interpolate('cm') },
    state,
    range: [first.alphaDeg, last.alphaDeg] as const,
  };
}

function severity(state: PolarEvaluation['state']) {
  return ({ analytic_estimate: 0, within_range: 0, extrapolated_alpha: 1, outside_reynolds: 2, outside_alpha: 3 })[state];
}

function worse(left: PolarEvaluation['state'], right: PolarEvaluation['state']) {
  return severity(left) >= severity(right) ? left : right;
}

function evaluateStationTables(tables: readonly SectionPolar[], reynolds: number, alphaDeg: number): PolarEvaluation {
  const sorted = [...tables].sort((left, right) => left.reynolds - right.reynolds);
  const reynoldsRange = [sorted[0].reynolds, sorted.at(-1)!.reynolds] as const;
  let lower = 0;
  let upper = 0;
  let reynoldsState: PolarEvaluation['state'] = 'within_range';
  if (reynolds <= sorted[0].reynolds) {
    reynoldsState = reynolds < sorted[0].reynolds ? 'outside_reynolds' : 'within_range';
  } else if (reynolds >= sorted.at(-1)!.reynolds) {
    lower = sorted.length - 1;
    upper = lower;
    reynoldsState = reynolds > sorted[upper].reynolds ? 'outside_reynolds' : 'within_range';
  } else {
    upper = sorted.findIndex((table) => table.reynolds >= reynolds);
    lower = upper - 1;
  }
  const low = interpolateRows(sorted[lower].rows, alphaDeg);
  const high = interpolateRows(sorted[upper].rows, alphaDeg);
  const fraction = upper === lower ? 0 : (reynolds - sorted[lower].reynolds) / (sorted[upper].reynolds - sorted[lower].reynolds);
  const interpolate = (field: 'cl' | 'cd' | 'cm') => low.row[field] + fraction * (high.row[field] - low.row[field]);
  const alphaRange = [Math.max(low.range[0], high.range[0]), Math.min(low.range[1], high.range[1])] as const;
  const provenance = [...new Set([sorted[lower].provenance.label, sorted[upper].provenance.label])].join(' + ');
  return {
    cl: interpolate('cl'),
    cd: Math.max(0, interpolate('cd')),
    cm: interpolate('cm'),
    state: worse(reynoldsState, worse(low.state, high.state)),
    provenance,
    alphaRangeDeg: alphaRange,
    reynoldsRange,
  };
}

export function evaluateSectionPolar(geometry: WingGeometry, eta: number, reynolds: number, alphaDeg: number): PolarEvaluation {
  const section = localAirfoilSection(geometry, eta, 80);
  if (geometry.polarModel.kind === 'ANALYTIC_ATTACHED') {
    const generated = generatedAnalyticPolar(section, reynolds);
    const evaluated = interpolateRows(generated.rows, alphaDeg);
    return {
      cl: evaluated.row.cl,
      cd: evaluated.row.cd,
      cm: evaluated.row.cm,
      state: evaluated.state === 'within_range' ? 'analytic_estimate' : evaluated.state,
      provenance: generated.provenance.label,
      alphaRangeDeg: evaluated.range,
      reynoldsRange: [reynolds, reynolds],
    };
  }
  const leftTables = geometry.polarModel.tables.filter((table) => table.airfoilStationId === section.leftStationId);
  const rightTables = geometry.polarModel.tables.filter((table) => table.airfoilStationId === section.rightStationId);
  if (!leftTables.length || !rightTables.length) throw new Error('User polar tables do not cover both bracketing airfoil stations.');
  const left = evaluateStationTables(leftTables, reynolds, alphaDeg);
  const right = evaluateStationTables(rightTables, reynolds, alphaDeg);
  const fraction = section.blendFraction;
  const interpolate = (field: 'cl' | 'cd' | 'cm') => left[field] + fraction * (right[field] - left[field]);
  return {
    cl: interpolate('cl'),
    cd: Math.max(0, interpolate('cd')),
    cm: interpolate('cm'),
    state: worse(left.state, right.state),
    provenance: [...new Set([left.provenance, right.provenance])].join(' + '),
    alphaRangeDeg: [Math.max(left.alphaRangeDeg[0], right.alphaRangeDeg[0]), Math.min(left.alphaRangeDeg[1], right.alphaRangeDeg[1])],
    reynoldsRange: [Math.max(left.reynoldsRange[0], right.reynoldsRange[0]), Math.min(left.reynoldsRange[1], right.reynoldsRange[1])],
  };
}

export function validatePolarModel(geometry: WingGeometry): DomainIssue[] {
  const issues: DomainIssue[] = [];
  const model = geometry.polarModel;
  if (!model || (model.kind !== 'ANALYTIC_ATTACHED' && model.kind !== 'USER_TABLES') || !Array.isArray(model.tables)) {
    return [{ path: 'geometry.polarModel', reason: 'Use the analytic attached-flow estimate or bounded user polar tables.' }];
  }
  if (model.tables.length > MAX_POLAR_TABLES) issues.push({ path: 'geometry.polarModel.tables', reason: `At most ${MAX_POLAR_TABLES} polar tables are supported.` });
  if (model.kind === 'ANALYTIC_ATTACHED' && model.tables.length) issues.push({ path: 'geometry.polarModel.tables', reason: 'Analytic mode generates its own tables and must not retain user rows.' });
  const stationIds = new Set(resolvedAirfoilStations(geometry).map((station) => station.id));
  const polarIds = new Set<string>();
  const stationReynoldsKeys = new Set<string>();
  let commonMach: number | null = null;
  model.tables.forEach((table, tableIndex) => {
    const path = `geometry.polarModel.tables.${tableIndex}`;
    if (!/^[A-Za-z][A-Za-z0-9_-]{1,31}$/.test(table.polarId) || polarIds.has(table.polarId)) issues.push({ path: `${path}.polarId`, reason: 'Polar IDs must be unique visible identifiers of 2–32 characters.' });
    polarIds.add(table.polarId);
    if (!stationIds.has(table.airfoilStationId)) issues.push({ path: `${path}.airfoilStationId`, reason: 'Polar table must reference an existing airfoil station.' });
    if (!Number.isFinite(table.reynolds) || table.reynolds < 5e4 || table.reynolds > 5e7) issues.push({ path: `${path}.reynolds`, reason: 'Polar Reynolds number must be finite and within 50,000–50,000,000.' });
    const stationReynoldsKey = `${table.airfoilStationId}/${table.reynolds}`;
    if (stationReynoldsKeys.has(stationReynoldsKey)) issues.push({ path: `${path}.reynolds`, reason: 'Each airfoil station may provide only one table at a given Reynolds number.' });
    stationReynoldsKeys.add(stationReynoldsKey);
    if (!Number.isFinite(table.mach) || table.mach < 0 || table.mach > 0.3) issues.push({ path: `${path}.mach`, reason: 'V5 accepts only incompressible/subcritical polar metadata from Mach 0–0.30.' });
    if (commonMach === null) commonMach = table.mach;
    else if (Math.abs(commonMach - table.mach) > 1e-9) issues.push({ path: `${path}.mach`, reason: 'All user tables must use one common Mach value in the incompressible V5 model.' });
    if (table.transitionModel && (table.transitionModel.length > 80 || /[\u0000-\u001f\u007f]/.test(table.transitionModel))) issues.push({ path: `${path}.transitionModel`, reason: 'Transition-model metadata must contain at most 80 visible characters.' });
    if (!Array.isArray(table.rows) || table.rows.length < 7 || table.rows.length > MAX_POLAR_ROWS) issues.push({ path: `${path}.rows`, reason: `Polar tables require 7–${MAX_POLAR_ROWS} rows.` });
    else table.rows.forEach((row, rowIndex) => {
      if (![row.alphaDeg, row.cl, row.cd, row.cm].every(Number.isFinite) || row.cd <= 0) issues.push({ path: `${path}.rows.${rowIndex}`, reason: 'Polar rows require finite alpha, Cl, positive Cd, and Cm.' });
      if (rowIndex > 0 && !(row.alphaDeg > table.rows[rowIndex - 1].alphaDeg)) issues.push({ path: `${path}.rows.${rowIndex}.alphaDeg`, reason: 'Polar alpha values must increase strictly.' });
    });
    const provenance = table.provenance;
    if (!provenance || !['USER_IMPORT', 'XFOIL', 'EXPERIMENT'].includes(provenance.source) || !provenance.label?.trim() || provenance.label.length > 80) issues.push({ path: `${path}.provenance`, reason: 'User tables require bounded USER_IMPORT, XFOIL, or EXPERIMENT provenance.' });
    if (provenance?.licence && (provenance.licence.length > 80 || /[\u0000-\u001f\u007f]/.test(provenance.licence))) issues.push({ path: `${path}.provenance.licence`, reason: 'Polar licence metadata must contain at most 80 visible characters.' });
  });
  if (model.kind === 'USER_TABLES') {
    stationIds.forEach((id) => {
      if (!model.tables.some((table) => table.airfoilStationId === id)) issues.push({ path: 'geometry.polarModel.tables', reason: `User polar mode requires at least one table for station ${id}.` });
    });
  }
  return issues;
}
