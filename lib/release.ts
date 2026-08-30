import { SOLVER_VERSION } from './domain/limits';

const buildCommit = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_AEROFICIENCY_COMMIT?.trim() : undefined;

export const RELEASE_IDENTITY = {
  appVersion: '0.5.0',
  solverVersion: SOLVER_VERSION,
  toolSchemaVersion: 'aeroficiency-webmcp-1.3',
  buildCommit: buildCommit || 'local',
} as const;
