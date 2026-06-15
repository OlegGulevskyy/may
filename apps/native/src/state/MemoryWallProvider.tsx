import { createContext, useContext, useMemo, type ReactNode } from "react";

import { useMemoryWall } from "../hooks/useMemoryWall";
import { useDrafts, type DraftsApi } from "../hooks/useDrafts";
import { useAppState } from "./AppState";

type MemoryWallValue = ReturnType<typeof useMemoryWall> & {
  drafts: DraftsApi;
};

const MemoryWallContext = createContext<MemoryWallValue | null>(null);

/**
 * Shares a single {@link useMemoryWall} instance (plus the local draft store)
 * across the authenticated screens — the wall and the compose page. Without
 * this, a memory queued on the compose route would only reach the wall via
 * remote sync, so it would never appear while offline, which is exactly when it
 * matters most. Drafts are shared for the same reason: the wall lists them, the
 * compose page edits them.
 *
 * The hooks are called unconditionally with empty ids until a family + member
 * are ready; in that state they read empty local storage and skip remote work,
 * then re-hydrate once the real ids arrive.
 */
export function MemoryWallProvider({ children }: { children: ReactNode }) {
  const { family, activeMemberId } = useAppState();
  const wall = useMemoryWall(family?.id ?? "", activeMemberId ?? "");
  const drafts = useDrafts(family?.id ?? "");

  const value = useMemo<MemoryWallValue>(
    () => ({ ...wall, drafts }),
    [wall, drafts],
  );

  return (
    <MemoryWallContext.Provider value={value}>
      {children}
    </MemoryWallContext.Provider>
  );
}

export function useMemoryWallContext() {
  const value = useContext(MemoryWallContext);
  if (!value) {
    throw new Error(
      "useMemoryWallContext must be used within a MemoryWallProvider.",
    );
  }
  return value;
}
