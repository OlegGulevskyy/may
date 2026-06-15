#!/usr/bin/env node

const { existsSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const databaseId = process.env.FIRESTORE_DATABASE_ID || "may-default";
const defaultSeedCount = 100;

const readFirebaseProjectId = () => {
  const candidates = [
    resolve(process.cwd(), ".firebaserc"),
    resolve(process.cwd(), "..", "..", ".firebaserc"),
    join(__dirname, "..", "..", "..", ".firebaserc"),
  ];

  for (const filePath of candidates) {
    if (!existsSync(filePath)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    const projectId = parsed?.projects?.default;

    if (typeof projectId === "string" && projectId.length > 0) {
      return projectId;
    }
  }

  return undefined;
};

const parseArgs = (argv) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--") {
      continue;
    }

    if (token === "--yes") {
      args.yes = true;
      continue;
    }

    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const nextValue = argv[index + 1];
    const value =
      inlineValue ??
      (nextValue && !nextValue.startsWith("--") ? nextValue : "true");

    if (inlineValue === undefined && value === nextValue) {
      index += 1;
    }

    args[rawKey] = value;
  }

  return args;
};

const createId = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 9)}`;

const deepClone = (value) => {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (Array.isArray(value)) {
    return value.map(deepClone);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, deepClone(item)]),
    );
  }

  return value;
};

const parsePositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  readFirebaseProjectId();

const app = initializeApp({
  projectId,
});
const db = getFirestore(app, databaseId);

const isPermissionDenied = (error) =>
  error?.code === 7 ||
  error?.code === "permission-denied" ||
  String(error?.message ?? "").includes("PERMISSION_DENIED");

const printPermissionHelp = () => {
  const project = projectId ?? "<project-id>";

  console.error("");
  console.error(
    `Firestore permission denied for project ${project}, database ${databaseId}.`,
  );
  console.error(
    "This dev utility uses the Firebase Admin SDK, so it needs Google application-default credentials or a service account with Firestore IAM access.",
  );
  console.error("");
  console.error("Cloud Firestore auth options:");
  console.error(`  gcloud config set project ${project}`);
  console.error(`  gcloud auth application-default login --project=${project}`);
  console.error("");
  console.error("Or use a service account key:");
  console.error(
    "  GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json pnpm --filter functions dev:seed-wall -- --count 100",
  );
  console.error("");
  console.error("For the local emulator, run the command with:");
  console.error(
    "  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 pnpm --filter functions dev:seed-wall -- --count 100",
  );
  console.error("");
  console.error(
    "The credential needs a role such as Cloud Datastore Owner/Firestore Owner on the Firebase project.",
  );
};

const resolveFamilyRef = async (familyId) => {
  if (familyId) {
    const familyRef = db.collection("families").doc(familyId);
    const familySnap = await familyRef.get();

    if (!familySnap.exists) {
      throw new Error(`Family ${familyId} was not found.`);
    }

    return familyRef;
  }

  const familiesSnap = await db
    .collection("families")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  if (familiesSnap.empty) {
    throw new Error("No families found. Create a dev family first.");
  }

  return familiesSnap.docs[0].ref;
};

const getFamilyMemberIds = async (familyRef) => {
  const membersSnap = await familyRef.collection("members").get();
  return membersSnap.docs.map((doc) => doc.id);
};

const checkAccess = async () => {
  const familiesSnap = await db
    .collection("families")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();

  console.log(`Project: ${projectId ?? "(default credential project)"}`);
  console.log(`Database: ${databaseId}`);
  console.log(
    `Firestore host: ${process.env.FIRESTORE_EMULATOR_HOST ?? "cloud"}`,
  );
  console.log(`Families readable: ${familiesSnap.size}`);
  if (!familiesSnap.empty) {
    console.log(`Latest family: ${familiesSnap.docs[0].id}`);
  }
};

const seedWall = async (args) => {
  const familyRef = await resolveFamilyRef(args["family-id"]);
  const count = parsePositiveInteger(args.count, defaultSeedCount);
  const templateScanLimit = parsePositiveInteger(
    args["template-scan-limit"],
    Math.max(count + 30, 300),
  );
  const members = await getFamilyMemberIds(familyRef);

  if (members.length === 0) {
    throw new Error(
      `Family ${familyRef.id} has no members. Create or join it in the app first.`,
    );
  }

  const templateSnap = await familyRef
    .collection("posts")
    .orderBy("createdAt", "desc")
    .limit(templateScanLimit)
    .get();

  const templates = templateSnap.docs
    .map((doc) => deepClone(doc.data()))
    .filter((post) => post.devSeed !== true)
    .slice(0, 3);

  if (templates.length === 0) {
    throw new Error(
      `Family ${familyRef.id} has no posts to duplicate. Add at least one correct post first.`,
    );
  }

  const now = Date.now();
  let batch = db.batch();
  let pendingWrites = 0;

  for (let index = 0; index < count; index += 1) {
    const template = templates[index % templates.length];
    const postId = createId("dev_post");
    const createdAt = new Date(now - index * 60_000).toISOString();
    const postRef = familyRef.collection("posts").doc(postId);
    const post = {
      ...template,
      authorId:
        members.includes(template.authorId) || members.length === 0
          ? template.authorId
          : members[index % members.length],
      body: `[dev seed ${index + 1}/${count}] ${String(template.body ?? "")}`,
      createdAt,
      deliveredAt: template.deliveredAt ? createdAt : undefined,
      devSeed: true,
      familyId: familyRef.id,
      id: postId,
      updatedAt: createdAt,
    };

    batch.set(postRef, deepClone(post));
    pendingWrites += 1;

    if (pendingWrites === 450) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }
  }

  if (pendingWrites > 0) {
    await batch.commit();
  }

  console.log(
    `Seeded ${count} dev posts in families/${familyRef.id}/posts using ${templates.length} template post(s).`,
  );
};

const clearDatabase = async (args) => {
  if (!args.yes) {
    throw new Error(
      "Refusing to clear Firestore without --yes. This deletes every root collection in the configured database.",
    );
  }

  const collections = await db.listCollections();

  for (const collectionRef of collections) {
    console.log(`Deleting ${collectionRef.path}...`);
    await db.recursiveDelete(collectionRef);
  }

  console.log(`Cleared Firestore database ${databaseId}.`);
};

const main = async () => {
  const [command, ...rest] = process.argv.slice(2);
  const args = parseArgs(rest);

  switch (command) {
    case "check":
      await checkAccess();
      break;
    case "seed-wall":
      await seedWall(args);
      break;
    case "clear-db":
      await clearDatabase(args);
      break;
    default:
      console.error(`Unknown command: ${command ?? "(missing)"}`);
      console.error("");
      console.error("Usage:");
      console.error("  node scripts/dev-firestore.js check");
      console.error(
        "  node scripts/dev-firestore.js seed-wall [--family-id FAMILY_ID] [--count 100] [--template-scan-limit 300]",
      );
      console.error("  node scripts/dev-firestore.js clear-db --yes");
      process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  if (isPermissionDenied(error)) {
    printPermissionHelp();
  }
  process.exitCode = 1;
});
