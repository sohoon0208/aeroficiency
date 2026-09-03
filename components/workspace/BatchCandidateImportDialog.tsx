'use client';

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { DesignId } from '@/lib/domain/types';
import type { BatchCandidateExecutionResult } from '@/lib/batchImport/types';
import { BATCH_CSV_ACCEPT, BATCH_IMPORT_LIMITS } from '@/lib/batchImport/constants';
import { useBatchCandidateImport } from './useBatchCandidateImport';

interface BatchCandidateImportDialogProps {
  open: boolean;
  baselineDesignId: DesignId;
  triggerRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  onOpenResult: (result: BatchCandidateExecutionResult) => void;
}

function issueLabel(issue: { rowNumber?: number; column?: string; candidateCode?: string }) {
  return [issue.candidateCode, issue.rowNumber === undefined ? null : 'row ' + issue.rowNumber, issue.column].filter(Boolean).join(' · ');
}

function statusLabel(status: BatchCandidateExecutionResult['status']) {
  return status === 'succeeded' ? 'Succeeded' : status === 'failed' ? 'Failed' : 'Skipped';
}

export function BatchCandidateImportDialog({ open, baselineDesignId, triggerRef, onClose, onOpenResult }: BatchCandidateImportDialogProps) {
  const { state, loadFile, execute, cancel, reset } = useBatchCandidateImport(baselineDesignId);
  const dialogRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeAllowed = state.phase !== 'running';

  const closeDialog = useCallback(() => {
    if (!closeAllowed) return;
    reset();
    onClose();
  }, [closeAllowed, onClose, reset]);

  const openResult = useCallback((result: BatchCandidateExecutionResult) => {
    reset();
    onOpenResult(result);
  }, [onOpenResult, reset]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    dialogRef.current?.focus();
    return () => trigger?.focus();
  }, [open, triggerRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDialog();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]'));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, open]);

  if (!open) return null;

  const plan = state.plan;
  const progress = state.progress;
  const progressPercent = progress?.phase === 'preparing-baseline'
    ? 7
    : progress
      ? ((progress.candidateIndex + (progress.phase === 'succeeded' ? 1 : 0.35)) / Math.max(progress.candidateCount, 1)) * 100
      : 0;
  const progressValue = Math.round(Math.max(0, Math.min(100, progressPercent)));
  const terminal = state.phase === 'complete' || state.phase === 'cancelled' || state.phase === 'stopped';

  return (
    <div className="modal-backdrop batch-import-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section ref={dialogRef} className="batch-import-dialog" role="dialog" aria-modal="true" aria-labelledby="batch-import-title" aria-describedby="batch-import-description" tabIndex={-1}>
        <div className="dialog-heading">
          <div><span className="eyebrow">LOCAL BATCH IMPORT</span><h2 id="batch-import-title">Import candidates</h2></div>
          <button type="button" aria-label="Close import dialog" disabled={!closeAllowed} onClick={closeDialog}>×</button>
        </div>
        <p id="batch-import-description" className="batch-import-intro">Choose and read a local CSV to preview bounded candidate changes, then create and analyze each candidate sequentially through the normal revision-checked workflow.</p>

        <div className="batch-import-guidance">
          <span>Processed locally in your browser · not uploaded or persisted · CSV only · max {Math.round(BATCH_IMPORT_LIMITS.maxFileBytes / 1024)} KiB</span>
          <a href="/templates/aeroficiency-candidate-import.csv" download>Download CSV template</a>
        </div>
        <label className="batch-file-input" htmlFor="batch-candidate-file">
          <span>Choose candidate CSV</span>
          <input ref={fileInputRef} id="batch-candidate-file" type="file" accept={BATCH_CSV_ACCEPT} disabled={state.phase === 'running'} onChange={(event) => { void loadFile(event.target.files?.[0] ?? null); event.currentTarget.value = ''; }} aria-describedby={state.phase === 'invalid' ? 'batch-import-errors' : undefined} aria-busy={state.phase === 'parsing'} />
        </label>

        {state.phase === 'parsing' && <p className="batch-import-status" role="status">Reading and validating the selected CSV…</p>}
        {state.phase === 'ready' && state.message && <p className="batch-import-status" role="status">{state.message}</p>}
        {state.phase === 'invalid' && <section id="batch-import-errors" className="batch-import-issues" role="alert"><div className="group-heading"><h3>Review import issues</h3><span>{state.issues.length} shown</span></div><ul>{state.issues.map((item, index) => <li key={item.message + '-' + index}><strong>{issueLabel(item) || 'File'}</strong><span>{item.message}</span></li>)}</ul></section>}

        {plan && (state.phase === 'ready' || state.phase === 'running' || terminal) && <section className="batch-import-preview" aria-label="Candidate import preview">
          <div className="group-heading"><h3>Preview</h3><span>{plan.candidates.length} candidate{plan.candidates.length === 1 ? '' : 's'} · {plan.availableSlots} slot{plan.availableSlots === 1 ? '' : 's'} available</span></div>
          <p className="batch-import-notice">Baseline geometry and structure values are inherited when a CSV cell is blank. Station rows replace the full normalized station set and use the analytic attached-flow polar. {plan.baselineAnalysisRequired ? 'A current standard Baseline analysis will be prepared before the first candidate.' : 'The current standard Baseline analysis will be reused.'} Created candidates and completed analyses remain after cancellation; there is no automatic rollback.</p>
          <div className="batch-preview-table-wrap"><table className="batch-preview-table"><thead><tr><th>Candidate</th><th>Stations</th><th>Overrides</th><th>Inherited</th></tr></thead><tbody>{plan.previews.map((preview) => <tr key={preview.candidateCode}><th scope="row"><strong>{preview.candidateLabel}</strong><small>{preview.candidateCode} · rows {preview.sourceRows.join(', ')}</small></th><td>{preview.stationMode === 'replace' ? 'Replace · ' + preview.stationCount : 'Inherit · ' + preview.stationCount}</td><td>{preview.overriddenFields.length ? preview.overriddenFields.map((field) => field.replace(/^(geometry|structure)\./, '')).join(', ') : 'None'}</td><td>{preview.inheritedFields.length ? preview.inheritedFields.length + ' fields' : 'None'}</td></tr>)}</tbody></table></div>
          {plan.previews.some((preview) => preview.warnings.length) && <ul className="batch-import-warnings">{plan.previews.flatMap((preview) => preview.warnings).map((item, index) => <li key={item.message + '-' + index}>{item.message}</li>)}</ul>}
        </section>}

        {state.phase === 'running' && <section className="batch-import-progress" aria-live="polite" aria-atomic="true"><div className="group-heading"><h3>{progress?.phase === 'preparing-baseline' ? 'Preparing Baseline' : 'Importing candidates'}</h3><span>{progress?.phase === 'preparing-baseline' ? 'Baseline' : progress ? progress.candidateIndex + 1 + ' / ' + progress.candidateCount : 'Starting'}</span></div><p>{progress?.message ?? 'Preparing the first candidate…'}</p><div className="batch-progress-bar" role="progressbar" aria-label="Batch import progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressValue}><span aria-hidden="true" style={{ width: progressValue + '%' }} /></div></section>}

        {terminal && <section className="batch-import-results" aria-live="polite"><div className="group-heading"><h3>{state.phase === 'cancelled' ? 'Batch cancelled' : state.phase === 'stopped' ? 'Batch stopped' : 'Batch complete'}</h3><span>{state.results.filter((result) => result.status === 'succeeded').length} succeeded</span></div><p>{state.message}</p><div className="batch-result-list">{state.results.map((result) => <div key={result.candidateCode + '-' + (result.designId ?? 'none')}><span className={'batch-result-status ' + result.status}>{statusLabel(result.status)}</span><p><strong>{result.candidateLabel}</strong><small>{result.message}</small></p>{result.designId && <button type="button" className="button compact" onClick={() => openResult(result)}>Open</button>}</div>)}</div></section>}

        <div className="dialog-actions batch-dialog-actions">
          {state.phase === 'running'
            ? <button type="button" className="button danger" disabled={state.cancelRequested} onClick={cancel}>{state.cancelRequested ? 'Cancelling…' : 'Cancel batch'}</button>
            : <><button type="button" className="button quiet" onClick={terminal ? reset : closeDialog}>{terminal ? 'Import another file' : 'Close'}</button>{state.phase === 'ready' && <button type="button" className="button primary" onClick={() => { void execute(); }}>Create and analyze</button>}</>}
        </div>
      </section>
    </div>
  );
}
