import { createId, type MemoryPost } from "@repo/core";

const now = new Date();

export const demoMemories: MemoryPost[] = [
  {
    id: createId("post"),
    familyId: "family-demo",
    authorId: "dad",
    body: "You fell asleep on my chest after breakfast. Tiny hand on my shirt, complete trust.",
    media: [],
    comments: [
      {
        id: createId("comment"),
        authorId: "mom",
        body: "I want her to read this one day.",
        createdAt: new Date(now.getTime() - 1000 * 60 * 12).toISOString(),
      },
    ],
    reactions: {
      heart: ["dad", "mom"],
    },
    status: "delivered",
    createdAt: new Date(now.getTime() - 1000 * 60 * 42).toISOString(),
    updatedAt: new Date(now.getTime() - 1000 * 60 * 39).toISOString(),
    deliveredAt: new Date(now.getTime() - 1000 * 60 * 38).toISOString(),
  },
  {
    id: createId("post"),
    familyId: "family-demo",
    authorId: "mom",
    body: "First proper laugh at the kitchen lamp. No idea why the lamp is so funny, but apparently it is.",
    media: [
      {
        id: createId("media"),
        kind: "audio",
        uri: "demo://laugh",
        durationMs: 9,
        fileName: "first-laugh.m4a",
        mimeType: "audio/m4a",
      },
    ],
    comments: [],
    reactions: {
      heart: ["dad"],
    },
    status: "delivered",
    createdAt: new Date(now.getTime() - 1000 * 60 * 95).toISOString(),
    updatedAt: new Date(now.getTime() - 1000 * 60 * 93).toISOString(),
    deliveredAt: new Date(now.getTime() - 1000 * 60 * 92).toISOString(),
  },
];
