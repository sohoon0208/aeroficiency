import { parseNaca4 } from '@/lib/solver/naca';
import type { AirfoilStation, WingGeometry, WingStructure } from '@/lib/domain/types';
import { BATCH_CSV_HEADERS, type BatchCsvHeader } from './constants';
import type { BatchIssue, CsvDocument, NormalizedCandidateInput } from './types';

const NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const CODE_PATTERN = /^[A-Z0-9_-]{1,32}$/;
const MAX_ISSUES = 50;

const GEOMETRY_FIELDS: ReadonlyArray<readonly [BatchCsvHeader, keyof WingGeometry]> = [
  ['span_m', 'spanM'],
  ['root_chord_m', 'rootChordM'],
  ['tip_chord_m', 'tipChordM'],
  ['tip_twist_deg', 'tipTwistDeg'],
];

const STRUCTURE_FIELDS: ReadonlyArray<readonly [BatchCsvHeader, keyof WingStructure]> = [
  ['skin_mm', 'skinThicknessMm'],
  ['front_web_mm', 'frontWebThicknessMm'],
  ['rear_web_mm', 'rearWebThicknessMm'],
  ['elastic_axis_xc', 'elasticAxisXOverC'],
];

function error(message: string, rowNumber?: number, column?: string, candidateCode?: string): BatchIssue {
  return {
    severity: 'error',
    message,
    ...(rowNumber === undefined ? {} : { rowNumber }),
    ...(column ? { column } : {}),
    ...(candidateCode ? { candidateCode } : {}),
  };
}

function warning(message: string, rowNumber?: number, column?: string, candidateCode?: string): BatchIssue {
  return {
    severity: 'warning',
    message,
    ...(rowNumber === undefined ? {} : { rowNumber }),
    ...(column ? { column } : {}),
    ...(candidateCode ? { candidateCode } : {}),
  };
}

function normalizeCode(value: string) {
  const normalized = value.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeLabel(value: string) {
  const normalized = value.trim().normalize('NFC');
  if (!normalized || normalized.length > 48 || /[\u0000-\u001f\u007f]/.test(normalized)) return null;
  return normalized;
}

function parseNumber(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (!NUMBER_PATTERN.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseNacaCode(value: string) {
  const match = /^(?:NACA\s*)?(\d{4})$/i.exec(value.trim());
  if (!match) return null;
  const code = match[1];
  try {
    parseNaca4(code);
    return code;
  } catch {
    return null;
  }
}

function parseBlend(value: string): AirfoilStation['blendToNext'] | null | undefined {
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!normalized) return undefined;
  if (normalized === 'linear' || normalized === 'linear_camber_thickness' || normalized === 'true') return 'LINEAR_CAMBER_THICKNESS';
  if (normalized === 'hold' || normalized === 'false') return 'HOLD';
  return null;
}

function cell(row: { values: string[] }, headers: BatchCsvHeader[], name: BatchCsvHeader) {
  const index = headers.indexOf(name);
  return index < 0 ? '' : row.values[index] ?? '';
}

function distinctNonblank<T>(values: Array<{ value: T | undefined; rowNumber: number; raw: string }>, equals: (left: T, right: T) => boolean) {
  const first = values.find((item) => item.value !== undefined);
  if (!first) return { value: undefined as T | undefined, conflict: null as { rowNumber: number } | null };
  const conflict = values.find((item) => item.value !== undefined && !equals(first.value as T, item.value));
  return { value: first.value, conflict: conflict ? { rowNumber: conflict.rowNumber } : null };
}

export type CandidateNormalizationResult =
  | { ok: true; candidates: NormalizedCandidateInput[]; warnings: BatchIssue[] }
  | { ok: false; issues: BatchIssue[] };

/** Convert parsed cells to bounded domain patches. No raw CSV text is retained. */
export function normalizeCandidateCsv(document: CsvDocument): CandidateNormalizationResult {
  const issues: BatchIssue[] = [];
  const warnings: BatchIssue[] = [];
  const headers = document.headers as BatchCsvHeader[];
  const groups = new Map<string, Array<{ rowNumber: number; values: string[] }>>();

  for (const row of document.rows) {
    if (row.values.every((value) => value.trim() === '')) {
      issues.push(error('Blank rows are only allowed at the end of the CSV.', row.rowNumber));
      continue;
    }
    const rawCode = cell(row, headers, 'candidate_code');
    const candidateCode = normalizeCode(rawCode);
    if (!candidateCode) {
      issues.push(error('Candidate code must be 1–32 ASCII letters, numbers, underscores, or hyphens.', row.rowNumber, 'candidate_code'));
      continue;
    }
    const group = groups.get(candidateCode) ?? [];
    group.push({ rowNumber: row.rowNumber, values: row.values });
    groups.set(candidateCode, group);
  }

  if (groups.size === 0 && issues.length === 0) issues.push(error('Add at least one candidate row to the CSV.'));

  const candidates: NormalizedCandidateInput[] = [];
  for (const [candidateCode, rows] of groups) {
    const candidateErrorsBefore = issues.length;
    const candidateWarnings: BatchIssue[] = [];
    const labelValues = rows.map((row) => {
      const raw = cell(row, headers, 'candidate_label');
      const parsed = raw.trim() ? normalizeLabel(raw) : undefined;
      if (raw.trim() && parsed === null) issues.push(error('Candidate label must contain 1–48 visible characters.', row.rowNumber, 'candidate_label', candidateCode));
      return { value: parsed, rowNumber: row.rowNumber, raw };
    });
    const label = distinctNonblank(labelValues, (left, right) => left === right);
    if (label.conflict) issues.push(error('Repeated candidate labels must match across rows.', label.conflict.rowNumber, 'candidate_label', candidateCode));
    const candidateLabel = label.value ?? `Candidate ${candidateCode}`;

    const geometryPatch: Partial<WingGeometry> = {};
    for (const [column, field] of GEOMETRY_FIELDS) {
      const values = rows.map((row) => {
        const raw = cell(row, headers, column);
        const parsed = parseNumber(raw);
        if (parsed === null) issues.push(error('Use a finite decimal number (scientific notation is allowed).', row.rowNumber, column, candidateCode));
        return { value: parsed, rowNumber: row.rowNumber, raw };
      });
      const result = distinctNonblank(values, (left, right) => left === right);
      if (result.conflict) issues.push(error('Repeated candidate values must match across rows.', result.conflict.rowNumber, column, candidateCode));
      if (result.value !== undefined) Object.assign(geometryPatch, { [field]: result.value });
    }
    const structurePatch: Partial<WingStructure> = {};
    for (const [column, field] of STRUCTURE_FIELDS) {
      const values = rows.map((row) => {
        const raw = cell(row, headers, column);
        const parsed = parseNumber(raw);
        if (parsed === null) issues.push(error('Use a finite decimal number (scientific notation is allowed).', row.rowNumber, column, candidateCode));
        return { value: parsed, rowNumber: row.rowNumber, raw };
      });
      const result = distinctNonblank(values, (left, right) => left === right);
      if (result.conflict) issues.push(error('Repeated candidate values must match across rows.', result.conflict.rowNumber, column, candidateCode));
      if (result.value !== undefined) Object.assign(structurePatch, { [field]: result.value });
    }

    const stationColumns: BatchCsvHeader[] = ['station_eta', 'naca_code', 'blend_to_next'];
    const stationRows = rows.filter((row) => stationColumns.some((column) => cell(row, headers, column).trim() !== ''));
    let stationMode: NormalizedCandidateInput['stationMode'] = 'inherit';
    let stations: AirfoilStation[] | null = null;
    if (stationRows.length > 0) {
      stationMode = 'replace';
      if (stationRows.length !== rows.length) {
        issues.push(error('Every row for a station replacement must include station_eta, naca_code, and blend_to_next data; mixed row shapes are not allowed.', rows.find((row) => !stationRows.includes(row))?.rowNumber ?? rows[0].rowNumber, 'station_eta', candidateCode));
      }
      stations = [];
      stationRows.forEach((row, index) => {
        const etaRaw = cell(row, headers, 'station_eta');
        const eta = parseNumber(etaRaw);
        if (eta === null || eta === undefined) issues.push(error('Station rows require a finite station_eta value.', row.rowNumber, 'station_eta', candidateCode));
        const nacaRaw = cell(row, headers, 'naca_code');
        const naca = nacaRaw.trim() ? parseNacaCode(nacaRaw) : null;
        if (!naca) issues.push(error('Station rows require a supported NACA four-digit code.', row.rowNumber, 'naca_code', candidateCode));
        const blend = parseBlend(cell(row, headers, 'blend_to_next'));
        if (blend === null) issues.push(error('blend_to_next must be linear, hold, true, or false.', row.rowNumber, 'blend_to_next', candidateCode));
        if (eta !== null && eta !== undefined && naca && blend !== null) {
          stations!.push({
            id: `afs_batch_${index + 1}`,
            eta,
            airfoil: { kind: 'NACA4', code: naca },
            blendToNext: blend ?? (index === stationRows.length - 1 ? 'HOLD' : 'LINEAR_CAMBER_THICKNESS'),
          });
        }
      });
      if (stations.length > 0 && stations.at(-1)!.blendToNext !== 'HOLD') {
        const final = stations.at(-1)!;
        final.blendToNext = 'HOLD';
        const source = stationRows.at(-1)!;
        candidateWarnings.push(warning('The final station blend was forced to HOLD because no outboard section exists.', source.rowNumber, 'blend_to_next', candidateCode));
      }
      if (stations.length < 2 || stations.length > 6) issues.push(error('Station replacement requires 2–6 complete station rows.', rows[0].rowNumber, 'station_eta', candidateCode));
      if (stations.length >= 2) {
        if (Math.abs(stations[0].eta) > 1e-9) issues.push(error('The first station must be at eta 0.', stationRows[0].rowNumber, 'station_eta', candidateCode));
        if (Math.abs(stations.at(-1)!.eta - 1) > 1e-9) issues.push(error('The final station must be at eta 1.', stationRows.at(-1)!.rowNumber, 'station_eta', candidateCode));
        for (let index = 1; index < stations.length; index += 1) {
          if (stations[index].eta <= stations[index - 1].eta || stations[index].eta - stations[index - 1].eta < 0.05 - 1e-12) {
            issues.push(error('Stations must be strictly increasing and at least 0.05 eta apart.', stationRows[index].rowNumber, 'station_eta', candidateCode));
          }
        }
        geometryPatch.airfoilStations = stations;
        geometryPatch.nacaCode = stations[0].airfoil.kind === 'NACA4' ? stations[0].airfoil.code : undefined;
        geometryPatch.polarModel = { kind: 'ANALYTIC_ATTACHED', tables: [] };
      }
    } else if (rows.length !== 1) {
      issues.push(error('A candidate without station data must use exactly one row.', rows[0].rowNumber, 'candidate_code', candidateCode));
    }

    if (issues.length === candidateErrorsBefore) {
      candidates.push({
        candidateCode,
        candidateLabel,
        sourceRows: rows.map((row) => row.rowNumber),
        geometryPatch,
        structurePatch,
        stationMode,
        stations,
        warnings: candidateWarnings,
      });
      warnings.push(...candidateWarnings);
    }
  }

  if (issues.length) return { ok: false, issues: issues.slice(0, MAX_ISSUES) };
  return { ok: true, candidates, warnings };
}

export function batchFieldLabel(field: string) {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (character) => character.toUpperCase())
    .replace(/M$/, ' (m)')
    .replace(/Mm$/, ' (mm)');
}

export { BATCH_CSV_HEADERS };
