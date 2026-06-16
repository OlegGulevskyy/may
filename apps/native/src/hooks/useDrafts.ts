import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createId,
  type MemoryContentImageMap,
  type MemoryMedia,
  type MemoryRichTextDocument,
} from "@may/core";

import { getLocalString, setLocalString } from "../services/storage";

/**
 * A memory that's still being written. Drafts live only on this device so a
 * post can be picked up and refined across several sittings before it's sent.
 */
export type MemoryDraft = {
  id: string;
  body: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media: MemoryMedia[];
  updatedAt: string;
};

export type DraftInput = {
  id: string;
  body: string;
  content?: MemoryRichTextDocument;
  contentImageMap?: MemoryContentImageMap;
  media: MemoryMedia[];
};

export type DraftsApi = {
  items: MemoryDraft[];
  newDraftId: () => string;
  save: (draft: DraftInput) => void;
  remove: (id: string) => void;
};

const draftsStorageKey = (familyId: string) =>
  `may.memory-drafts.${familyId}.v1`;

const readDrafts = (key: string): MemoryDraft[] => {
  try {
    const stored = getLocalString(key);
    return stored ? (JSON.parse(stored) as MemoryDraft[]) : [];
  } catch {
    return [];
  }
};

const byNewest = (a: MemoryDraft, b: MemoryDraft) =>
  new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

/**
 * Local draft store, scoped to a family. Reads synchronously from MMKV so a
 * resumed draft is available on the very first render of the compose screen.
 */
export const useDrafts = (familyId: string): DraftsApi => {
  const storageKey = draftsStorageKey(familyId);
  const [drafts, setDrafts] = useState<MemoryDraft[]>(() =>
    readDrafts(storageKey),
  );

  // Re-hydrate when the family changes (e.g. after sign-in).
  useEffect(() => {
    setDrafts(readDrafts(storageKey));
  }, [storageKey]);

  const persist = useCallback(
    (next: MemoryDraft[]) => {
      const sorted = [...next].sort(byNewest);
      setDrafts(sorted);
      setLocalString(storageKey, JSON.stringify(sorted));
    },
    [storageKey],
  );

  const save = useCallback(
    ({ id, body, content, contentImageMap, media }: DraftInput) => {
      const draft: MemoryDraft = {
        id,
        body,
        content,
        contentImageMap,
        media,
        updatedAt: new Date().toISOString(),
      };
      persist([...readDrafts(storageKey).filter((d) => d.id !== id), draft]);
    },
    [persist, storageKey],
  );

  const remove = useCallback(
    (id: string) => {
      persist(readDrafts(storageKey).filter((d) => d.id !== id));
    },
    [persist, storageKey],
  );

  const newDraftId = useCallback(() => createId("draft"), []);

  return useMemo(
    () => ({ items: drafts, newDraftId, save, remove }),
    [drafts, newDraftId, save, remove],
  );
};
