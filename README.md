# May

May is a private family memory app POC. The native app lets parents compose
text, photo, video, and voice memories in a timeline-style wall, queue them
offline, and later sync them to a Firebase/GCP backend that can deliver the
memory to a child's Gmail/Drive account.

## What's inside?

This Turborepo includes the following packages/apps:

### Apps and Packages

- `native`: a [React Native](https://reactnative.dev/) app built with [Expo](https://docs.expo.dev/)
- `functions`: Firebase Cloud Functions for thumbnailing and Gmail/Drive delivery
- `@may/core`: shared memory domain types and helpers
- `@may/ui`: a currently unused stub [React Native](https://reactnative.dev/) component library
- `@may/typescript-config`: `tsconfig.json`s used throughout the monorepo

Each package/app is 100% [TypeScript](https://www.typescriptlang.org/).

## Run the POC

```sh
pnpm install
pnpm --filter @may/core build
pnpm --filter native dev
```

The native app creates families and parent invites in Firebase when
`apps/native/.env.local` contains the Expo public Firebase config. The memory
wall is still local-first: it persists posts to device storage, supports a
simulated offline mode, and walks new posts through the intended delivery
states.

## Firebase setup

1. Create a Firebase project in GCP.
2. Copy `.firebaserc.example` to `.firebaserc` and replace the project id.
3. Copy `apps/native/.env.example` to `apps/native/.env.local` and fill the
   Expo public Firebase web app config.
4. Enable Google sign-in in Firebase Auth, then add the native app's Google
   user sign-in values to `apps/native/.env.local`:

```sh
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=your-ios-oauth-client-id.apps.googleusercontent.com
```

`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is required because Firebase signs in
with the Google ID token returned for that web OAuth client. Do not put a
Google OAuth client secret in the native app. If you do not use
`GoogleService-Info.plist`, also set `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` or
let the app config derive it from `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`.

5. Google sign-in uses native code, so run a development build instead of Expo
   Go. The project uses Expo CNG: `app.config.js` is the source of truth, and
   generated `ios/` or `android/` folders are ignored/disposable.

```sh
pnpm --filter native ios
pnpm --filter native dev:client
```

For a fully cloud-built development app with no generated native folders on
your machine, use EAS Build with the same public Google env vars configured in
EAS.

6. Copy `apps/functions/.env.example` to `apps/functions/.env.local` and fill
   the non-sensitive Gmail/Drive target values.
7. Store sensitive OAuth values in Firebase Secret Manager:

```sh
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
firebase functions:secrets:set GOOGLE_OAUTH_REFRESH_TOKEN
```

For local function emulator testing, put those same two values in
`apps/functions/.secret.local`.

8. The app uses the signed-in Firebase Auth uid as the family member id and
   stores the active family on `users/{uid}`.
9. Deploy rules/functions when ready:

```sh
firebase deploy --only firestore:may-default,storage,functions
```

The first backend iteration should replace the native simulated sync with real
Firestore document writes, Firebase Storage uploads, and a durable local upload
outbox.

### Utilities

This Turborepo has some additional tools already setup for you:

- [Expo](https://docs.expo.dev/) for native development
- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Prettier](https://prettier.io) for code formatting
