import { beforeEach, describe, expect, it } from 'vitest';
import { createDefaultProject } from '@/lib/domain/defaults';
import { createIdempotencyKey } from '@/lib/domain/ids';
import type { DesignId } from '@/lib/domain/types';
import { createEmptyPresentationFocus, useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from '@/webmcp/tools';

function tool(name: string) {
  const value = AEROFICIENCY_TOOLS.find((candidate) => candidate.name === name);
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

describe('revision-conflict recovery through the public tool contract', () => {
  beforeEach(() => useProjectStore.setState({ project: createDefaultProject(), presentation: createEmptyPresentationFocus(), analysisRun: { status: 'idle' }, commandNotice: null }));

  it('preserves the human edit, returns current revisions, and succeeds only with a fresh UUID and revision', async () => {
    const initial = useProjectStore.getState().project;
    const baseline = initial.designs[initial.activeDesignId];
    const branch = await tool('create_candidate_variant').execute({
      sourceDesignId: baseline.designId,
      expectedProjectRevision: initial.projectRevision,
      expectedSourceDesignRevision: baseline.revision,
      candidateLabel: 'Conflict candidate',
      idempotencyKey: createIdempotencyKey(),
    }) as { ok: true; data: { designId: DesignId; revision: number } };
    expect(branch.ok).toBe(true);

    const human = useProjectStore.getState().updateStructure(branch.data.designId, { skinThicknessMm: 1.7 }, 'human', createIdempotencyKey(), branch.data.revision);
    expect(human.ok).toBe(true);
    const afterHuman = structuredClone(useProjectStore.getState().project);

    const staleUuid = createIdempotencyKey();
    const conflict = await tool('update_wing_structure').execute({
      designId: branch.data.designId,
      expectedDesignRevision: branch.data.revision,
      idempotencyKey: staleUuid,
      patch: { frontWebThicknessMm: 2 },
    }) as { ok: false; error: { code: string; retryable: boolean; safeNextAction: string; current: { designRevision: number } } };
    expect(conflict.ok).toBe(false);
    expect(conflict.error).toMatchObject({ code: 'REVISION_CONFLICT', retryable: true, current: { designRevision: 2 } });
    expect(conflict.error.safeNextAction).toMatch(/Read the current design state/i);
    expect(useProjectStore.getState().project).toEqual(afterHuman);

    useProjectStore.getState().selectDesign(baseline.designId);
    const reread = await tool('get_design_state').execute({ designId: branch.data.designId }) as { ok: true; data: { activeDesign: { designId: string }; inspectedDesign: { revision: number; structure: { skinThicknessMm: number } } } };
    expect(reread.data.activeDesign.designId).toBe(baseline.designId);
    expect(reread.data.inspectedDesign.revision).toBe(2);
    expect(reread.data.inspectedDesign.structure.skinThicknessMm).toBe(1.7);

    const recovered = await tool('update_wing_structure').execute({
      designId: branch.data.designId,
      expectedDesignRevision: reread.data.inspectedDesign.revision,
      idempotencyKey: createIdempotencyKey(),
      patch: { frontWebThicknessMm: 2 },
    }) as { ok: true; data: { newDesignRevision: number } };
    expect(recovered.ok).toBe(true);
    expect(recovered.data.newDesignRevision).toBe(3);
    const finalDesign = useProjectStore.getState().project.designs[branch.data.designId];
    expect(finalDesign.structure.skinThicknessMm).toBe(1.7);
    expect(finalDesign.structure.frontWebThicknessMm).toBe(2);
    expect(useProjectStore.getState().project.activities.filter((event) => event.targetDesignId === branch.data.designId && event.operation === 'update_wing_structure')).toHaveLength(2);
  });
});
