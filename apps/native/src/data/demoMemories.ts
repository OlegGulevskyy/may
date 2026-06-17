import { createId, type MemoryPost } from "@may/core";

/**
 * Optional warm sample timeline used only when a parent taps "preview with
 * sample memories" on the empty wall. A freshly created family always starts
 * empty — these are demo content, attributed to real member ids so reactions
 * and comments render correctly.
 */
export const buildSampleMemories = ({
  familyId,
  authorId,
  partnerId,
}: {
  familyId: string;
  authorId: string;
  partnerId?: string;
}): MemoryPost[] => {
  const now = Date.now();
  const other = partnerId ?? authorId;

  return [
    {
      id: createId("post"),
      familyId,
      authorId,
      body: "You fell asleep on my chest after breakfast. Tiny hand on my shirt, complete trust.",
      media: [],
      comments: [
        {
          id: createId("comment"),
          authorId: other,
          body: "I want her to read this one day.",
          createdAt: new Date(now - 1000 * 60 * 12).toISOString(),
        },
      ],
      reactions: {
        heart: partnerId ? [authorId, partnerId] : [authorId],
      },
      status: "delivered",
      createdAt: new Date(now - 1000 * 60 * 42).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 39).toISOString(),
      deliveredAt: new Date(now - 1000 * 60 * 38).toISOString(),
    },
    {
      id: createId("post"),
      familyId,
      authorId: other,
      body: "First proper laugh at the kitchen lamp. No idea why the lamp is so funny, but apparently it is.",
      media: [
        {
          id: createId("media"),
          kind: "audio",
          uri: "demo://laugh",
          durationMs: 9000,
          fileName: "first-laugh.m4a",
          mimeType: "audio/mp4",
        },
      ],
      comments: [],
      reactions: {
        heart: [authorId],
      },
      status: "delivered",
      createdAt: new Date(now - 1000 * 60 * 95).toISOString(),
      updatedAt: new Date(now - 1000 * 60 * 93).toISOString(),
      deliveredAt: new Date(now - 1000 * 60 * 92).toISOString(),
    },
  ];
};
