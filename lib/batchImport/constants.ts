export const BATCH_CSV_HEADERS = [
  'candidate_code',
  'candidate_label',
  'station_eta',
  'naca_code',
  'blend_to_next',
  'span_m',
  'root_chord_m',
  'tip_chord_m',
  'tip_twist_deg',
  'skin_mm',
  'front_web_mm',
  'rear_web_mm',
  'elastic_axis_xc',
] as const;

export type BatchCsvHeader = typeof BATCH_CSV_HEADERS[number];

export const BATCH_IMPORT_LIMITS = {
  maxFileBytes: 1_048_576,
  maxRecords: 128,
  maxColumns: BATCH_CSV_HEADERS.length,
  maxCellCharacters: 256,
  maxIssues: 50,
} as const;

export const BATCH_CSV_ACCEPT = '.csv,text/csv';
