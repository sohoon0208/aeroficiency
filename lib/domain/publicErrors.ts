import type { DomainErrorCode, DomainFailure } from './types';

export const MAX_PUBLIC_ERROR_MESSAGE_CHARS = 320;
export const MAX_PUBLIC_SAFE_ACTION_CHARS = 320;

/**
 * Treat worker, browser, and adapter exception text as untrusted. Public error
 * envelopes never need control characters or an unbounded diagnostic payload.
 */
export function boundedPublicText(value: unknown, fallback: string, maximum = MAX_PUBLIC_ERROR_MESSAGE_CHARS) {
  const source = typeof value === 'string' ? value : fallback;
  const normalized = source
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (normalized || fallback).slice(0, maximum);
}

export interface PublicAnalysisFailure {
  domainCode: DomainErrorCode;
  category: string;
  message: string;
  safeNextAction: string;
  retryable: boolean;
  runStatus: 'failed' | 'aborted';
}

const DOMAIN_ERROR_CODES = new Set<DomainErrorCode>([
  'VALIDATION_ERROR',
  'DESIGN_NOT_FOUND',
  'ANALYSIS_NOT_FOUND',
  'ANALYSIS_ALREADY_RUNNING',
  'REVISION_CONFLICT',
  'DUPLICATE_MUTATION_MISMATCH',
  'ANALYSIS_REQUIRED',
  'STALE_ANALYSIS',
  'INVALID_COMPARISON',
  'INCOMPATIBLE_ANALYSES',
  'DESIGN_LIMIT_REACHED',
  'WORKSPACE_STATE_INVALID',
  'ANALYSIS_FAILED',
  'ANALYSIS_DID_NOT_CONVERGE',
  'ABORTED',
  'TOOL_UNAVAILABLE',
]);

const trustedDomainFailures = new WeakSet<object>();

/** Marks a failure produced by Aeroficiency's own bounded domain code. */
export function trustDomainFailure(failure: DomainFailure): DomainFailure {
  trustedDomainFailures.add(failure);
  return failure;
}

/** Final egress defense for a DomainFailure returned by any injected adapter. */
export function sanitizeDomainFailure(failure: DomainFailure): DomainFailure {
  if (!trustedDomainFailures.has(failure)) {
    return trustDomainFailure({
      ok: false,
      error: {
        code: 'ANALYSIS_FAILED',
        message: 'An untrusted adapter returned an invalid failure envelope.',
        retryable: false,
        safeNextAction: 'Read the current design state before deciding whether to retry.',
        category: 'TOOL_EXECUTION_EXCEPTION',
      },
    });
  }
  const rawCode = boundedPublicText(failure.error.code, 'ANALYSIS_FAILED', 64) as DomainErrorCode;
  const code = DOMAIN_ERROR_CODES.has(rawCode) ? rawCode : 'ANALYSIS_FAILED';
  const issues = failure.error.issues?.slice(0, 6).map((issue) => ({
    path: boundedPublicText(issue.path, 'input', 180),
    reason: boundedPublicText(issue.reason, 'Invalid value.', 240),
  }));
  return trustDomainFailure({
    ok: false,
    error: {
      code,
      message: boundedPublicText(failure.error.message, 'The operation failed safely.'),
      retryable: Boolean(failure.error.retryable),
      safeNextAction: boundedPublicText(failure.error.safeNextAction, 'Read the current state before continuing.', MAX_PUBLIC_SAFE_ACTION_CHARS),
      ...(issues?.length ? { issues } : {}),
      ...(failure.error.current ? { current: {
        ...(Number.isInteger(failure.error.current.projectRevision) ? { projectRevision: failure.error.current.projectRevision } : {}),
        ...(Number.isInteger(failure.error.current.designRevision) ? { designRevision: failure.error.current.designRevision } : {}),
        ...(Number.isInteger(failure.error.current.flightCaseRevision) ? { flightCaseRevision: failure.error.current.flightCaseRevision } : {}),
        ...(Number.isInteger(failure.error.current.constraintsRevision) ? { constraintsRevision: failure.error.current.constraintsRevision } : {}),
      } } : {}),
      ...(failure.error.analysisId ? { analysisId: boundedPublicText(failure.error.analysisId, 'ana_UNAVAILABLE', 80) as DomainFailure['error']['analysisId'] } : {}),
      ...(typeof failure.error.committed === 'boolean' ? { committed: failure.error.committed } : {}),
      ...(failure.error.category ? { category: boundedPublicText(failure.error.category, 'UNCLASSIFIED_FAILURE', 64) } : {}),
    },
  });
}

function fixedFailure(
  category: string,
  message: string,
  safeNextAction: string,
  options: Partial<Pick<PublicAnalysisFailure, 'domainCode' | 'retryable' | 'runStatus'>> = {},
): PublicAnalysisFailure {
  return {
    domainCode: options.domainCode ?? 'ANALYSIS_FAILED',
    category,
    message: boundedPublicText(message, 'Analysis failed safely.'),
    safeNextAction: boundedPublicText(safeNextAction, 'Read the current state before continuing.', MAX_PUBLIC_SAFE_ACTION_CHARS),
    retryable: options.retryable ?? true,
    runStatus: options.runStatus ?? 'failed',
  };
}

/** Map internal solver/controller categories to fixed, non-sensitive recovery copy. */
export function normalizeAnalysisException(error: unknown): PublicAnalysisFailure {
  let rawCode = 'UNCLASSIFIED_ANALYSIS_FAILURE';
  try {
    if (error && typeof error === 'object' && 'code' in error) {
      rawCode = boundedPublicText(String(error.code), rawCode, 64).toUpperCase();
    }
  } catch {
    rawCode = 'UNCLASSIFIED_ANALYSIS_FAILURE';
  }

  switch (rawCode) {
    case 'ABORTED':
      return fixedFailure(
        'ABORTED',
        'Analysis was aborted before commit.',
        'Read the current state; if analysis is still needed, retry with current revisions and a new UUID.',
        { domainCode: 'ABORTED', retryable: true, runStatus: 'aborted' },
      );
    case 'TOOL_UNAVAILABLE':
      return fixedFailure(
        'TOOL_UNAVAILABLE',
        'The local analysis worker is unavailable in this browser context.',
        'Use the manual workspace in a supported browser, or reload before starting a new run.',
        { domainCode: 'TOOL_UNAVAILABLE', retryable: false },
      );
    case 'MODEL_RANGE_EXCEEDED':
      return fixedFailure(
        'MODEL_RANGE_EXCEEDED',
        'Analysis left the disclosed small-deformation model range.',
        'Change geometry or structure to reduce elastic twist or deflection, then retry with current revisions and a new UUID.',
      );
    case 'TARGET_LIFT_UNBRACKETED':
      return fixedFailure(
        'TARGET_LIFT_UNBRACKETED',
        'The fixed target lift could not be bracketed inside the disclosed trim range.',
        'Adjust the candidate geometry within supported bounds, then retry with current revisions and a new UUID.',
      );
    case 'TRIM_DID_NOT_CONVERGE':
      return fixedFailure(
        'TRIM_DID_NOT_CONVERGE',
        'The target-lift trim did not converge within the disclosed iteration limit.',
        'Adjust the candidate or use standard fidelity, then retry with current revisions and a new UUID.',
      );
    case 'VLM_SINGULAR':
      return fixedFailure(
        'VLM_SINGULAR',
        'The aerodynamic influence solve was singular or ill-conditioned.',
        'Change the candidate geometry within supported bounds; do not retry the unchanged request with the same UUID.',
      );
    case 'NUMERICAL_FAILURE':
      return fixedFailure(
        'NUMERICAL_FAILURE',
        'The coupled analysis stopped after a bounded numerical failure.',
        'Read the current state, adjust the candidate or fidelity, and retry with a new UUID.',
      );
    case 'INVALID_INPUT':
      return fixedFailure(
        'INVALID_INPUT',
        'The analysis worker rejected an input outside its supported model contract.',
        'Read the disclosed model bounds and current revisions, correct the design, and retry with a new UUID.',
      );
    default:
      return fixedFailure(
        'UNCLASSIFIED_ANALYSIS_FAILURE',
        'Analysis failed safely before a result could be committed.',
        'Read the current state and inspect the disclosed model bounds before deciding whether to retry with a new UUID.',
        { retryable: false },
      );
  }
}
