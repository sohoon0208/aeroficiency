'use client';

import { useProjectStore } from '@/store/projectStore';
import { AEROFICIENCY_TOOLS } from './tools';

export const AEROFICIENCY_TOOL_COUNT = AEROFICIENCY_TOOLS.length;

interface ModelContext {
  registerTool: (tool: unknown, options: { signal: AbortSignal }) => void | Promise<void>;
}

export function registerAeroficiencySiteTools() {
  const store = useProjectStore.getState();
  const modelContext = (document as Document & { modelContext?: ModelContext }).modelContext;
  if (!modelContext?.registerTool) {
    store.setSiteTools('unavailable');
    return () => undefined;
  }
  store.setSiteTools('checking');
  const controller = new AbortController();
  let disposed = false;

  void (async () => {
    try {
      for (const tool of AEROFICIENCY_TOOLS) {
        await modelContext.registerTool(tool, { signal: controller.signal });
        if (disposed || controller.signal.aborted) return;
      }
      if (!disposed) useProjectStore.getState().setSiteTools('ready');
    } catch {
      controller.abort();
      if (!disposed) useProjectStore.getState().setSiteTools('error');
    }
  })();

  return () => {
    disposed = true;
    controller.abort();
  };
}
