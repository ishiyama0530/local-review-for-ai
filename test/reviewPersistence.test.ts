import { describe, expect, it } from "vitest";

import {
  SESSION_SCHEMA_VERSION,
  SESSION_SNAPSHOT_KEY,
  discardSessionSnapshot,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from "../src/review/reviewPersistence";
import type { PersistedSessionEnvelope } from "../src/types";
import { buildReviewSession } from "./fixtures/sessionFactory";

class MemoryWorkspaceState {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) {
      this.values.delete(key);
      return;
    }
    this.values.set(key, value);
  }
}

describe("reviewPersistence", () => {
  it("save/restore ができること", async () => {
    const workspaceState = new MemoryWorkspaceState();
    const session = buildReviewSession([]);

    await saveSessionSnapshot(workspaceState, session);
    const restored = loadSessionSnapshot(workspaceState);

    expect(restored?.version).toBe(SESSION_SCHEMA_VERSION);
    expect(restored?.session.id).toBe(session.id);
  });

  it("discard で保存済みセッションが削除されること", async () => {
    const workspaceState = new MemoryWorkspaceState();
    const session = buildReviewSession([]);
    await saveSessionSnapshot(workspaceState, session);

    await discardSessionSnapshot(workspaceState);
    const restored = loadSessionSnapshot(workspaceState);

    expect(restored).toBeUndefined();
  });

  it("データ未保存時に loadSessionSnapshot は undefined を返すこと", () => {
    const workspaceState = new MemoryWorkspaceState();
    const restored = loadSessionSnapshot(workspaceState);
    expect(restored).toBeUndefined();
  });

  it("不正なセッション構造のデータは restore されないこと", () => {
    const workspaceState = new MemoryWorkspaceState();
    void workspaceState.update(SESSION_SNAPSHOT_KEY, {
      version: SESSION_SCHEMA_VERSION,
      session: { id: "test" },
    });
    const restored = loadSessionSnapshot(workspaceState);
    expect(restored).toBeUndefined();
  });

  it("version 不一致のデータは restore されないこと", () => {
    const workspaceState = new MemoryWorkspaceState();
    const invalidEnvelope: PersistedSessionEnvelope = {
      version: SESSION_SCHEMA_VERSION + 1,
      session: buildReviewSession([]),
    };
    void workspaceState.update(SESSION_SNAPSHOT_KEY, invalidEnvelope);

    const restored = loadSessionSnapshot(workspaceState);
    expect(restored).toBeUndefined();
  });
});
