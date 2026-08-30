import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/lib/domain/defaults';
import { sha256 } from '@/lib/domain/ids';
import { SOLVER_SETTINGS } from '@/lib/domain/limits';
import { designInputFingerprint } from '@/lib/domain/validation';
import type { DesignId } from '@/lib/domain/types';

describe('canonical physics fingerprint', () => {
  it('implements the SHA-256 reference digest', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('excludes concurrency revisions while retaining physics', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const first = designInputFingerprint(state, design, 'standard');
    design.revision += 1;
    state.flightCase.revision += 1;
    state.constraints.revision += 1;
    expect(designInputFingerprint(state, design, 'standard')).toBe(first);
    design.geometry.spanM += 0.1;
    expect(designInputFingerprint(state, design, 'standard')).not.toBe(first);
  });

  it('includes the selected Baseline identity and revision in every candidate comparison fingerprint', () => {
    const state = createDefaultProject();
    const baseline = state.designs[state.activeDesignId];
    const candidateId = 'des_00000000000000000000000002' as DesignId;
    state.designs[candidateId] = { ...structuredClone(baseline), designId: candidateId, kind: 'candidate', label: 'Candidate A' };
    const first = designInputFingerprint(state, state.designs[candidateId], 'standard');
    baseline.revision += 1;
    expect(designInputFingerprint(state, state.designs[candidateId], 'standard')).not.toBe(first);
  });

  it('rejects values outside canonical JSON', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    design.geometry.spanM = Number.NaN;
    expect(() => designInputFingerprint(state, design, 'standard')).toThrow(/non-finite/);
  });

  it('fingerprints every disclosed combined model-range gate', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    const baseline = designInputFingerprint(state, design, 'standard');
    const mutable = SOLVER_SETTINGS as unknown as {
      requiredTargetCl: number[];
      maxElasticTwistDeg: number;
      maxTipDeflectionSemispanFraction: number;
    };
    const original = {
      requiredTargetCl: mutable.requiredTargetCl,
      maxElasticTwistDeg: mutable.maxElasticTwistDeg,
      maxTipDeflectionSemispanFraction: mutable.maxTipDeflectionSemispanFraction,
    };
    try {
      mutable.requiredTargetCl = [0.16, 1];
      expect(designInputFingerprint(state, design, 'standard')).not.toBe(baseline);
      mutable.requiredTargetCl = original.requiredTargetCl;
      mutable.maxElasticTwistDeg = 14;
      expect(designInputFingerprint(state, design, 'standard')).not.toBe(baseline);
      mutable.maxElasticTwistDeg = original.maxElasticTwistDeg;
      mutable.maxTipDeflectionSemispanFraction = 0.09;
      expect(designInputFingerprint(state, design, 'standard')).not.toBe(baseline);
    } finally {
      mutable.requiredTargetCl = original.requiredTargetCl;
      mutable.maxElasticTwistDeg = original.maxElasticTwistDeg;
      mutable.maxTipDeflectionSemispanFraction = original.maxTipDeflectionSemispanFraction;
    }
  });
});
