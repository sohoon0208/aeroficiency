import { describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/lib/domain/defaults';
import { sha256 } from '@/lib/domain/ids';
import { designInputFingerprint } from '@/lib/domain/validation';

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

  it('rejects values outside canonical JSON', () => {
    const state = createDefaultProject();
    const design = state.designs[state.activeDesignId];
    design.geometry.spanM = Number.NaN;
    expect(() => designInputFingerprint(state, design, 'standard')).toThrow(/non-finite/);
  });
});
