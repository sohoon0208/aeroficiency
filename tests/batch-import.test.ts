import { describe, expect, it } from 'vitest';
import { commitAnalysisSnapshot, type CreateCandidateResult, type RunAnalysisResult, type UpdateDesignResult } from '@/lib/domain/commands';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import { MAX_DESIGNS } from '@/lib/domain/limits';
import type { ActivityId, AnalysisId, DesignId, ProjectState } from '@/lib/domain/types';
import { buildAnalysisSnapshot } from '@/lib/solver/analysis';
import { BATCH_CSV_HEADERS, BATCH_IMPORT_LIMITS } from '@/lib/batchImport/constants';
import { normalizeCandidateCsv } from '@/lib/batchImport/normalizeCandidateRows';
import { parseCandidateCsv } from '@/lib/batchImport/parseCsv';
import { preflightBatchCandidates } from '@/lib/batchImport/preflightBatchCandidates';
import { executeBatchCandidatePlan } from '@/services/batchCandidateImportController';
import type { BatchCommandPort, BatchImportPlan } from '@/lib/batchImport/types';

function bytes(value: string) {
  return new TextEncoder().encode(value).buffer;
}

function withCurrentBaseline() {
  const state = createDefaultProject();
  const design = state.designs[state.activeDesignId];
  const snapshot = buildAnalysisSnapshot(state, design, 'standard');
  const committed = commitAnalysisSnapshot(state, {
    designId: design.designId,
    expectedProjectRevision: state.projectRevision,
    expectedDesignRevision: design.revision,
    expectedFlightCaseRevision: state.flightCase.revision,
    expectedConstraintsRevision: state.constraints.revision,
    idempotencyKey: createIdempotencyKey(),
    fidelity: 'standard',
  }, snapshot, 'solver');
  if (!committed.result.ok) throw new Error(committed.result.error.message);
  return committed.state;
}

function candidateCsv() {
  return [
    BATCH_CSV_HEADERS.join(','),
    'C-001,"Thin, swept",0,2412,linear,12,2.4,1.08,-2,1.8,2.2,2.2,0.38',
    'C-001,,1,0012,hold,,,,,,,,',
  ].join('\r\n');
}

describe('CSV batch candidate import', () => {
  it('parses BOM, CRLF, quoted commas, and escaped/newline content', () => {
    const parsed = parseCandidateCsv(bytes('\ufeff' + BATCH_CSV_HEADERS.join(',') + '\nC1,\"Quoted \"\"label\nwith comma,\",0,2412,linear,,,,,,,,'));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.headers[0]).toBe('candidate_code');
    expect(parsed.data.rows[0].values[1]).toBe('Quoted \"label\nwith comma,');
  });

  it('rejects malformed quotes, unknown headers, leading blanks, and interior blank rows', () => {
    expect(parseCandidateCsv(bytes('candidate_code,candidate_label\nC1,\"open'))).toHaveProperty('ok', false);
    expect(parseCandidateCsv(bytes('candidate_code,wat\nC1,value'))).toHaveProperty('ok', false);
    expect(parseCandidateCsv(bytes('\n' + candidateCsv()))).toHaveProperty('ok', false);
    const parsed = parseCandidateCsv(bytes(candidateCsv() + '\n\n' + candidateCsv().split('\n').at(-1)));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const normalized = normalizeCandidateCsv(parsed.data);
    expect(normalized.ok).toBe(false);
    if (!normalized.ok) expect(normalized.issues.some((item) => /blank rows/i.test(item.message))).toBe(true);
  });

  it('stops at the declared cell, column, and logical-record bounds', () => {
    const header = BATCH_CSV_HEADERS.join(',');
    const longCell = 'C1,' + 'x'.repeat(BATCH_IMPORT_LIMITS.maxCellCharacters + 1) + ',' + ','.repeat(BATCH_CSV_HEADERS.length - 2);
    expect(parseCandidateCsv(bytes(header + '\n' + longCell))).toHaveProperty('ok', false);
    expect(parseCandidateCsv(bytes(header + ',extra\n' + 'C1,' + ','.repeat(BATCH_CSV_HEADERS.length - 1)))).toHaveProperty('ok', false);
    const rows = Array.from({ length: BATCH_IMPORT_LIMITS.maxRecords + 1 }, (_, index) => 'C' + index + ',Label,,,,,,,,,,,');
    const overflow = parseCandidateCsv(bytes(header + '\n' + rows.join('\n')));
    expect(overflow).toHaveProperty('ok', false);
    const exact = parseCandidateCsv(bytes(header + '\n' + rows.slice(0, BATCH_IMPORT_LIMITS.maxRecords).join('\n')));
    expect(exact.ok).toBe(true);
  });

  it('normalizes exact four-digit NACA codes, groups station rows, and preserves inherited fields', () => {
    const parsed = parseCandidateCsv(bytes(candidateCsv()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const normalized = normalizeCandidateCsv(parsed.data);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    expect(normalized.candidates).toHaveLength(1);
    expect(normalized.candidates[0].candidateCode).toBe('C-001');
    expect(normalized.candidates[0].candidateLabel).toBe('Thin, swept');
    expect(normalized.candidates[0].stations?.map((station) => station.airfoil.kind === 'NACA4' ? station.airfoil.code : '')).toEqual(['2412', '0012']);
    expect(normalized.candidates[0].geometryPatch.spanM).toBe(12);
    expect(normalized.candidates[0].structurePatch.skinThicknessMm).toBe(1.8);
  });

  it('rejects short NACA reinterpretation and mixed station row shapes', () => {
    const shortCode = BATCH_CSV_HEADERS.join(',') + '\nC1,Label,0,12,linear,,,,,,,,';
    const shortParsed = parseCandidateCsv(bytes(shortCode));
    expect(shortParsed.ok).toBe(true);
    if (shortParsed.ok) expect(normalizeCandidateCsv(shortParsed.data)).toHaveProperty('ok', false);
    const mixed = BATCH_CSV_HEADERS.join(',') + '\nC1,Label,0,2412,linear,,,,,,,,\nC1,,,,,,,,,,,,';
    const mixedParsed = parseCandidateCsv(bytes(mixed));
    expect(mixedParsed.ok).toBe(true);
    if (mixedParsed.ok) {
      const normalized = normalizeCandidateCsv(mixedParsed.data);
      expect(normalized.ok).toBe(false);
      if (!normalized.ok) expect(normalized.issues.some((item) => /mixed row shapes/i.test(item.message))).toBe(true);
    }
  });

  it('uses a deterministic label and rejects conflicting repeated values', () => {
    const parsed = parseCandidateCsv(bytes([
      BATCH_CSV_HEADERS.join(','),
      'C2,,0,2412,linear,12,,,,,,,',
      'C2,,1,2412,hold,13,,,,,,,',
    ].join('\n')));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const normalized = normalizeCandidateCsv(parsed.data);
    expect(normalized.ok).toBe(false);
    if (!normalized.ok) expect(normalized.issues.some((item) => /repeated candidate values/i.test(item.message))).toBe(true);
  });

  it('marks Baseline preparation and available capacity in the immutable preview', () => {
    const state = createDefaultProject();
    const parsed = parseCandidateCsv(bytes(candidateCsv()));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const normalized = normalizeCandidateCsv(parsed.data);
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) return;
    const preflight = preflightBatchCandidates({ project: state, baselineDesignId: state.activeDesignId, candidates: normalized.candidates, sessionId: 'batch_test' });
    expect(preflight.ok).toBe(true);
    if (preflight.ok) {
      expect(preflight.plan.baselineAnalysisRequired).toBe(true);
      expect(preflight.plan.availableSlots).toBe(MAX_DESIGNS - Object.keys(state.designs).length);
      expect(preflight.plan.fingerprint.baselineLatestAnalysisIdAtPreview).toBeNull();
      expect(preflight.plan.fingerprint.reusableStandardBaselineAnalysisId).toBeNull();
    }
  });

  it('executes a confirmed plan through create, patch, and analysis in order with exact live revisions', async () => {
    const state = withCurrentBaseline();
    let live: ProjectState = structuredClone(state);
    const baseline = live.designs[live.activeDesignId];
    const candidateId = 'des_BATCHCANDIDATE000000000001' as DesignId;
    const analysisId = 'ana_BATCHANALYSIS000000000001' as AnalysisId;
    const plan: BatchImportPlan = {
      sessionId: 'batch_test',
      baselineDesignId: baseline.designId,
      baselineAnalysisRequired: false,
      availableSlots: MAX_DESIGNS - Object.keys(state.designs).length,
      fingerprint: {
        projectRevision: state.projectRevision,
        baselineDesignId: baseline.designId,
        baselineDesignRevision: baseline.revision,
        baselineLatestAnalysisIdAtPreview: baseline.latestAnalysisId,
        reusableStandardBaselineAnalysisId: baseline.latestAnalysisId,
        flightCaseRevision: state.flightCase.revision,
        constraintsRevision: state.constraints.revision,
        solverVersion: state.solverVersion,
      },
      candidates: [{ candidateCode: 'C1', candidateLabel: 'Candidate C1', sourceRows: [2], geometryPatch: { spanM: 12.1 }, structurePatch: { skinThicknessMm: 1.8 }, stationMode: 'inherit', stations: null, warnings: [] }],
      previews: [{ candidateCode: 'C1', candidateLabel: 'Candidate C1', sourceRows: [2], stationMode: 'inherit', stationCount: 2, overriddenFields: ['geometry.spanM'], inheritedFields: [], warnings: [] }],
    };
    const calls: string[] = [];
    const port: BatchCommandPort = {
      getProjectSnapshot: () => live,
      createCandidate: (...args) => {
        calls.push('create:' + String(args[3]));
        const before = live;
        live = structuredClone(before);
        const source = live.designs[baseline.designId];
        live.projectRevision += 1;
        live.designs[candidateId] = { ...structuredClone(source), designId: candidateId, label: 'Candidate C1', kind: 'candidate', revision: 1, sourceDesignId: source.designId, sourceDesignRevision: source.revision, latestAnalysisId: null };
        live.activeDesignId = candidateId;
        live.selectedAnalysisId = null;
        const data: CreateCandidateResult = { designId: candidateId, label: 'Candidate C1', kind: 'candidate', revision: 1, sourceDesignId: source.designId, sourceDesignRevision: source.revision, projectRevision: live.projectRevision, activityId: 'act_BATCHCREATE000000000001' as ActivityId };
        return { ok: true, replayed: false, data };
      },
      updateGeometry: (...args) => {
        calls.push('geometry:' + String(args[3]));
        const design = live.designs[candidateId];
        const previous = design.revision;
        live = structuredClone(live);
        Object.assign(live.designs[candidateId].geometry, args[1]);
        live.designs[candidateId].revision = previous + 1;
        live.projectRevision += 1;
        const data: UpdateDesignResult = { outcome: 'changed', designId: candidateId, previousDesignRevision: previous, newDesignRevision: previous + 1, projectRevision: live.projectRevision, changedFields: {}, invalidatedAnalysisId: null, invalidatedComparisonDesignIds: [], analysisFreshness: 'stale', activityId: null };
        return { ok: true, replayed: false, data };
      },
      updateStructure: (...args) => {
        calls.push('structure:' + String(args[3]));
        const design = live.designs[candidateId];
        const previous = design.revision;
        live = structuredClone(live);
        Object.assign(live.designs[candidateId].structure, args[1]);
        live.designs[candidateId].revision = previous + 1;
        live.projectRevision += 1;
        const data: UpdateDesignResult = { outcome: 'changed', designId: candidateId, previousDesignRevision: previous, newDesignRevision: previous + 1, projectRevision: live.projectRevision, changedFields: {}, invalidatedAnalysisId: null, invalidatedComparisonDesignIds: [], analysisFreshness: 'stale', activityId: null };
        return { ok: true, replayed: false, data };
      },
      runAnalysis: async (...args) => {
        calls.push('analysis:' + args[0].idempotencyKey);
        live = structuredClone(live);
        const design = live.designs[candidateId];
        const snapshot = buildAnalysisSnapshot(live, design, 'standard');
        const trusted = { ...snapshot, analysisId };
        live.analyses[analysisId] = trusted;
        live.designs[candidateId].latestAnalysisId = analysisId;
        live.projectRevision += 1;
        const data: RunAnalysisResult = { analysisId, designId: candidateId, designRevision: design.revision, flightCaseRevision: live.flightCase.revision, constraintsRevision: live.constraints.revision, projectRevision: live.projectRevision, fidelity: 'standard', solverVersion: live.solverVersion, inputFingerprint: trusted.inputFingerprint, status: 'converged', iterations: trusted.convergence.iterations, metrics: trusted.metrics, allConstraintsSatisfied: true, checkSummary: {} as RunAnalysisResult['checkSummary'], warnings: trusted.warnings, activityId: 'act_BATCHANALYSIS000000000001' };
        return { ok: true, replayed: false, data };
      },
    };
    const result = await executeBatchCandidatePlan({ plan, port, signal: new AbortController().signal });
    expect(result.status).toBe('complete');
    expect(result.results[0]).toMatchObject({ status: 'succeeded', designId: candidateId, analysisId });
    expect(calls).toEqual(['create:batch_test:C1:create', 'geometry:batch_test:C1:geometry', 'structure:batch_test:C1:structure', 'analysis:batch_test:C1:analysis']);
    expect(live.projectRevision).toBe(state.projectRevision + 4);
  });
});
