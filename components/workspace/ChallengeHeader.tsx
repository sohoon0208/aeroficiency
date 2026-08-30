'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { MODEL_SCOPE_SECTIONS, MODEL_VALIDITY_STATUS } from '@/lib/domain/modelValidity';
import { CANONICAL_AGENT_TASK } from '@/lib/presentation/copy';
import type { ImmutableResultState } from '@/lib/presentation/status';
import type { SiteToolsState } from '@/store/projectStore';

function useModalFocus(open: boolean, close: () => void, dialogRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const focusable = () => [...(dialog?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex="-1"])') ?? [])];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [close, dialogRef, open]);
}

interface ChallengeHeaderProps {
  analysisState: ImmutableResultState;
  activeDesignLabel: string;
  activeDesignRevision: number;
  candidateCount: number;
  toolCount: number;
  siteTools: SiteToolsState;
  running: boolean;
  onRun: () => void;
  onCancel: () => void;
  onReset: () => void;
}

export function ChallengeHeader({ analysisState, activeDesignLabel, activeDesignRevision, candidateCount, toolCount, siteTools, running, onRun, onCancel, onReset }: ChallengeHeaderProps) {
  const [scopeOpen, setScopeOpen] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const scopeDialogRef = useRef<HTMLElement>(null);
  const closeScope = useCallback(() => setScopeOpen(false), []);
  useModalFocus(scopeOpen, closeScope, scopeDialogRef);

  const copyTask = async () => {
    try {
      await navigator.clipboard.writeText(CANONICAL_AGENT_TASK);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const toolCopy = siteTools === 'ready'
    ? `${toolCount} Site Tools ready`
    : siteTools === 'checking'
      ? `Checking ${toolCount} Site Tools`
      : siteTools === 'error'
        ? 'Site Tools error · manual UI ready'
        : 'Site Tools unavailable · manual UI ready';
  const comparisonReady = candidateCount > 0;

  return (
    <>
      <header className="challenge-header">
        <div className="brand-lockup">
          <Image className="brand-logo" src="/aeroficiency-logo-white.svg" alt="Aeroficiency" width={1065} height={189} priority unoptimized />
        </div>

        <section className="challenge-mission" aria-label="Reference challenge objective">
          <p><b>CASE</b> Reference Wing — 31.6 kN target lift at 64 m/s</p>
          <p><b>OBJECTIVE</b> Reduce modeled wall mass ≥5% · all 5 checks · wake drag no worse</p>
          <div>
            <span className="baseline-chip">BASELINE EDITABLE</span>
            <span className={`candidate-readiness-chip ${comparisonReady ? 'ready' : 'warning'}`}>{comparisonReady ? `${candidateCount} CANDIDATE${candidateCount === 1 ? '' : 'S'} AVAILABLE` : '1 CANDIDATE REQUIRED'}</span>
            <span className={`analysis-chip ${analysisState.key}`}>{analysisState.label}</span>
            <span className="validity-chip">{MODEL_VALIDITY_STATUS} · key omissions disclosed</span>
            <span className="active-design-chip">{activeDesignLabel} · r{activeDesignRevision}</span>
          </div>
        </section>

        <div className={`trade-study-compact ${comparisonReady ? 'ready' : 'warning'}`} aria-label="Trade study readiness">
          <span aria-hidden="true">{comparisonReady ? '●' : '⚠'}</span>
          {comparisonReady ? `${candidateCount} CANDIDATE${candidateCount === 1 ? '' : 'S'} · COMPARISON AVAILABLE` : 'CREATE 1 CANDIDATE TO COMPARE'}
        </div>

        <div className="challenge-actions">
          <span className={`tools-status ${siteTools}`}><i />{toolCopy}</span>
          <button className="button compact" type="button" onClick={copyTask}>{copyState === 'copied' ? 'Agent task copied' : 'Copy agent task'}</button>
          <button className="button compact" type="button" onClick={() => setScopeOpen(true)}>Model scope</button>
          <button className="button compact reset-reference" type="button" onClick={onReset}>Reset reference case</button>
          {running && <button className="button compact cancel-run" type="button" onClick={onCancel}>Cancel</button>}
          <button className="button primary compact" type="button" disabled={running} onClick={onRun}>{running ? 'Solving…' : 'Run analysis'}</button>
        </div>
      </header>

      <span className="sr-only" role="status" aria-live="polite">{copyState === 'copied' ? 'Canonical agent task copied to clipboard.' : copyState === 'failed' ? 'Could not copy the agent task. Clipboard access is unavailable.' : ''}</span>

      {scopeOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeScope(); }}>
          <section ref={scopeDialogRef} className="scope-dialog" role="dialog" aria-modal="true" aria-labelledby="scope-title" aria-describedby="scope-summary">
            <div className="dialog-heading">
              <div><span className="eyebrow">MODEL VALIDITY</span><h2 id="scope-title">Supported model scope</h2></div>
              <button type="button" aria-label="Close model scope" onClick={closeScope}>×</button>
            </div>
            <p id="scope-summary">Preliminary educational and early concept-design evidence only. It is not a certification analysis or a substitute for higher-fidelity engineering review.</p>
            {MODEL_SCOPE_SECTIONS.map((section) => (
              <section className="scope-section" key={section.title}>
                <h3>{section.title}</h3>
                <ul>{section.items.map((item) => <li key={item}>{item}</li>)}</ul>
              </section>
            ))}
            <div className="dialog-actions"><button type="button" className="button primary" onClick={closeScope}>Close</button></div>
          </section>
        </div>
      )}
    </>
  );
}
