import type { PersistedSessionEnvelope, ReviewSession } from "../types";

export const SESSION_SNAPSHOT_KEY = "localReviewForAi.sessionSnapshot";
export const SESSION_SCHEMA_VERSION = 1;

export interface WorkspaceStateLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
}

export async function saveSessionSnapshot(
  workspaceState: WorkspaceStateLike,
  session: ReviewSession,
): Promise<void> {
  const envelope: PersistedSessionEnvelope = {
    version: SESSION_SCHEMA_VERSION,
    session,
  };
  await workspaceState.update(SESSION_SNAPSHOT_KEY, envelope);
}

function isValidSession(session: unknown): boolean {
  if (!session || typeof session !== "object") {
    return false;
  }
  const s = session as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    typeof s.repoRoot === "string" &&
    typeof s.repoName === "string" &&
    typeof s.startedAt === "string" &&
    typeof s.state === "string" &&
    Array.isArray(s.comments) &&
    typeof s.nextSequence === "number"
  );
}

export function loadSessionSnapshot(
  workspaceState: WorkspaceStateLike,
): PersistedSessionEnvelope | undefined {
  const envelope = workspaceState.get<PersistedSessionEnvelope>(SESSION_SNAPSHOT_KEY);
  if (!envelope || typeof envelope !== "object") {
    return undefined;
  }
  if (envelope.version !== SESSION_SCHEMA_VERSION) {
    return undefined;
  }
  if (!isValidSession(envelope.session)) {
    return undefined;
  }
  return envelope;
}

export async function discardSessionSnapshot(workspaceState: WorkspaceStateLike): Promise<void> {
  await workspaceState.update(SESSION_SNAPSHOT_KEY, undefined);
}
