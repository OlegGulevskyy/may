# May

May is a private family memory app POC. The native app lets parents compose
text, photo, video, and voice memories in a timeline-style wall, queue them
offline, and later sync them to a Firebase/GCP backend that can deliver the
memory to a child's Gmail/Drive account.

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `native`: a [React Native](https://reactnative.dev/) app built with [Expo](https://docs.expo.dev/)
- `web`: a [Next.js](https://nextjs.org/) app built with React DOM
- `functions`: Firebase Cloud Functions for thumbnailing and Gmail/Drive delivery
- `@repo/core`: shared memory domain types and helpers
- `@repo/ui`: a stub [React Native](https://reactnative.dev/) component library used by the native app
- `@repo/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

## Run the POC

```sh
pnpm install
pnpm --filter @repo/core build
pnpm --filter native dev
```

The native app currently runs as a local-first POC without Firebase credentials.
It persists the wall to device storage, supports a simulated offline mode, and
walks new posts through the intended delivery states.

## Firebase setup

1. Create a Firebase project in GCP.
2. Copy `.firebaserc.example` to `.firebaserc` and replace the project id.
3. Copy `apps/native/.env.example` to `apps/native/.env.local` and fill the
   Expo public Firebase web app config.
4. Copy `apps/functions/.env.example` to `apps/functions/.env.local` and fill
   the Gmail/Drive OAuth and target mailbox/folder values.
5. Deploy rules/functions when ready:

```sh
firebase deploy --only firestore:rules,storage,functions
```

The first backend iteration should replace the native simulated sync with real
Firestore document writes, Firebase Storage uploads, and a durable local upload
outbox.

### Utilities

This Turborepo has some additional tools already setup for you:

- [Expo](https://docs.expo.dev/) for native development
- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Prettier](https://prettier.io) for code formatting
