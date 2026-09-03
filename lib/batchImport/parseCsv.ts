import { BATCH_CSV_HEADERS, BATCH_IMPORT_LIMITS, type BatchCsvHeader } from './constants';
import type { BatchIssue, CsvParseResult, CsvRow } from './types';

function issue(message: string, rowNumber?: number, column?: string): BatchIssue {
  return { severity: 'error', message, ...(rowNumber === undefined ? {} : { rowNumber }), ...(column ? { column } : {}) };
}

function boundedIssues(issues: BatchIssue[]): CsvParseResult {
  return { ok: false, issues: issues.slice(0, BATCH_IMPORT_LIMITS.maxIssues) };
}

function isBlankRecord(record: CsvRow) {
  return record.values.every((value) => value.trim() === '');
}

function canonicalHeader(value: string) {
  // Headers are part of the public import contract. Do not silently turn
  // misspellings or alternate spellings into a different field.
  return value.trim();
}

/**
 * Parse a local UTF-8 CSV file without retaining the original text. This is a
 * small RFC-4180-compatible state machine rather than comma/line splitting, so
 * quoted commas, quoted newlines, and escaped quotes remain unambiguous.
 */
export function parseCandidateCsv(bytes: ArrayBuffer): CsvParseResult {
  if (bytes.byteLength > BATCH_IMPORT_LIMITS.maxFileBytes) {
    return boundedIssues([issue('CSV files must be ' + Math.round(BATCH_IMPORT_LIMITS.maxFileBytes / 1024) + ' KiB or smaller.')]);
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return boundedIssues([issue('The selected file is not valid UTF-8 text.')]);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const records: CsvRow[] = [];
  let values: string[] = [];
  let field = '';
  let inQuotes = false;
  let afterClosingQuote = false;
  let physicalLine = 1;
  let recordStartLine = 1;
  let lastWasRecordBreak = false;
  let stopped = false;

  const errors: BatchIssue[] = [];
  const fail = (message: string, row = recordStartLine) => {
    if (errors.length < BATCH_IMPORT_LIMITS.maxIssues) errors.push(issue(message, row));
  };

  const appendField = () => {
    if (field.length > BATCH_IMPORT_LIMITS.maxCellCharacters) {
      fail('A CSV cell may contain at most ' + BATCH_IMPORT_LIMITS.maxCellCharacters + ' characters.');
      stopped = true;
      return false;
    }
    if (values.length >= BATCH_IMPORT_LIMITS.maxColumns) {
      fail('Each CSV record may contain at most ' + BATCH_IMPORT_LIMITS.maxColumns + ' columns.');
      stopped = true;
      return false;
    }
    values.push(field);
    field = '';
    afterClosingQuote = false;
    return true;
  };

  const finishRecord = () => {
    if (!appendField()) return false;
    records.push({ rowNumber: recordStartLine, values });
    if (records.length > BATCH_IMPORT_LIMITS.maxRecords + 1) {
      fail('CSV files may contain at most ' + BATCH_IMPORT_LIMITS.maxRecords + ' data records plus one header record.');
      stopped = true;
      return false;
    }
    values = [];
    recordStartLine = physicalLine + 1;
    lastWasRecordBreak = true;
    return true;
  };

  for (let index = 0; index < text.length; index += 1) {
    if (stopped) break;
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
          if (field.length > BATCH_IMPORT_LIMITS.maxCellCharacters) {
            fail('A CSV cell may contain at most ' + BATCH_IMPORT_LIMITS.maxCellCharacters + ' characters.');
            stopped = true;
          }
        } else {
          inQuotes = false;
          afterClosingQuote = true;
        }
      } else {
        field += character;
        if (character === '\n') physicalLine += 1;
        else if (character === '\r') {
          if (text[index + 1] === '\n') index += 1;
          physicalLine += 1;
        }
        if (field.length > BATCH_IMPORT_LIMITS.maxCellCharacters) {
          fail('A CSV cell may contain at most ' + BATCH_IMPORT_LIMITS.maxCellCharacters + ' characters.');
          stopped = true;
        }
      }
      lastWasRecordBreak = false;
      continue;
    }

    if (afterClosingQuote) {
      if (character === ',') {
        appendField();
        lastWasRecordBreak = false;
        continue;
      }
      if (character === '\n') {
        finishRecord();
        physicalLine += 1;
        continue;
      }
      if (character === '\r') {
        if (text[index + 1] === '\n') index += 1;
        finishRecord();
        physicalLine += 1;
        continue;
      }
      fail('Only a comma or line break may follow a quoted CSV cell.');
      stopped = true;
      continue;
    }

    if (character === '"') {
      if (field.length !== 0) {
        fail('A quoted CSV cell must begin at the start of a field.');
        stopped = true;
      } else {
        inQuotes = true;
      }
      lastWasRecordBreak = false;
      continue;
    }
    if (character === ',') {
      appendField();
      lastWasRecordBreak = false;
      continue;
    }
    if (character === '\n') {
      finishRecord();
      physicalLine += 1;
      continue;
    }
    if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      finishRecord();
      physicalLine += 1;
      continue;
    }
    field += character;
    if (field.length > BATCH_IMPORT_LIMITS.maxCellCharacters) {
      fail('A CSV cell may contain at most ' + BATCH_IMPORT_LIMITS.maxCellCharacters + ' characters.');
      stopped = true;
    }
    lastWasRecordBreak = false;
  }

  if (inQuotes && !errors.length) fail('The CSV contains an unterminated quoted cell.');
  else if (!stopped && !lastWasRecordBreak && (field.length > 0 || values.length > 0)) finishRecord();

  if (errors.length) return boundedIssues(errors);
  while (records.length && isBlankRecord(records.at(-1)!)) records.pop();
  if (!records.length) return boundedIssues([issue('Choose a CSV file containing a header row and at least one candidate row.')]);

  const headerRecord = records[0];
  if (isBlankRecord(headerRecord)) return boundedIssues([issue('The CSV cannot begin with a blank row; the first row must be the header.', headerRecord.rowNumber)]);
  const headers = headerRecord.values.map(canonicalHeader);
  const headerIssues: BatchIssue[] = [];
  const allowed = new Set<string>(BATCH_CSV_HEADERS);
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) headerIssues.push(issue('CSV headers cannot be empty.', headerRecord.rowNumber, 'column ' + (index + 1)));
    else if (!allowed.has(header)) headerIssues.push(issue('Unknown CSV header “' + header + '”.', headerRecord.rowNumber, header));
    else if (seen.has(header)) headerIssues.push(issue('CSV header “' + header + '” is duplicated.', headerRecord.rowNumber, header));
    seen.add(header);
  });
  BATCH_CSV_HEADERS.forEach((required) => {
    if (!seen.has(required)) headerIssues.push(issue('CSV is missing required header “' + required + '”.', headerRecord.rowNumber, required));
  });
  if (headers.length !== BATCH_CSV_HEADERS.length) headerIssues.push(issue('The CSV header must contain exactly ' + BATCH_CSV_HEADERS.length + ' columns.', headerRecord.rowNumber));
  if (headerIssues.length) return boundedIssues(headerIssues);

  const dataRows = records.slice(1);
  const rows: CsvRow[] = [];
  dataRows.forEach((record) => {
    if (isBlankRecord(record)) {
      rows.push(record);
      return;
    }
    if (record.values.length !== headers.length) {
      headerIssues.push(issue('CSV row has ' + record.values.length + ' columns; expected ' + headers.length + '.', record.rowNumber));
      return;
    }
    rows.push(record);
  });
  if (headerIssues.length) return boundedIssues(headerIssues);

  const canonicalHeaders = headers as BatchCsvHeader[];
  return { ok: true, data: { headers: canonicalHeaders, rows } };
}
