import { SOLVER_VERSION } from './domain/limits';

const buildCommit = typeof process !== 'undefined' ? process.env.NEXT_PUBLIC_AEROFICIENCY_COMMIT?.trim() : undefined;

export const RELEASE_IDENTITY = {
  appVersion: '0.6.0',
  solverVersion: SOLVER_VERSION,
  toolSchemaVersion: 'aeroficiency-webmcp-1.5',
  buildCommit: buildCommit || 'local',
} as const;
