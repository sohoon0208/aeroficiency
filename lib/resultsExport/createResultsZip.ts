import { RESULTS_EXPORT_LIMITS } from './constants';
import type { ResultsExportFile } from './types';

export class ResultsExportLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResultsExportLimitError';
  }
}

function validateFiles(files: readonly ResultsExportFile[]) {
  if (files.length === 0) throw new ResultsExportLimitError('The results archive has no files to download.');
  if (files.length > RESULTS_EXPORT_LIMITS.maxFiles) {
    throw new ResultsExportLimitError(`The results archive exceeds the ${RESULTS_EXPORT_LIMITS.maxFiles}-file safety limit.`);
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of files) {
    const pathParts = file.path.split('/');
    if (!file.path || file.path.startsWith('/') || file.path.includes('\\') || pathParts.some((part) => part === '..' || part === '.' || part === '')) {
      throw new ResultsExportLimitError('The results archive contains an unsafe file path.');
    }
    if (paths.has(file.path)) throw new ResultsExportLimitError(`The results archive contains a duplicate file path: ${file.path}`);
    paths.add(file.path);
    const bytes = new TextEncoder().encode(file.content).byteLength;
    if (bytes !== file.sizeBytes) throw new ResultsExportLimitError(`The results archive has an invalid byte count for ${file.path}.`);
    if (bytes > RESULTS_EXPORT_LIMITS.maxFileBytes) throw new ResultsExportLimitError(`The results archive file ${file.path} exceeds the per-file safety limit.`);
    totalBytes += bytes;
  }
  if (totalBytes > RESULTS_EXPORT_LIMITS.maxTotalUncompressedBytes) {
    throw new ResultsExportLimitError(`The results archive exceeds the ${Math.round(RESULTS_EXPORT_LIMITS.maxTotalUncompressedBytes / (1024 * 1024))} MiB uncompressed safety limit.`);
  }
}

/** Compresses an allowlisted text-file bundle without reading live application state. */
export async function createResultsZip(files: readonly ResultsExportFile[]): Promise<Uint8Array> {
  validateFiles(files);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.path] = new TextEncoder().encode(file.content);
  const { zip } = await import('fflate');
  return new Promise<Uint8Array>((resolve, reject) => {
    zip(entries, { level: 6 }, (error, data) => {
      if (error) {
        reject(new Error(`The results archive could not be compressed: ${error.message}`));
        return;
      }
      resolve(data);
    });
  });
}

export function triggerResultsDownload(bytes: Uint8Array, filename: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Browser download APIs are unavailable.');
  }
  const blobBytes = new Uint8Array(bytes.byteLength);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes.buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
