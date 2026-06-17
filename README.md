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
wall writes post/comment/reaction documents to Firestore and keeps device
storage as a local cache/outbox for offline sends. Media file uploads and
Gmail/Drive delivery are still backend follow-up work.

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

For TestFlight or any EAS cloud build, `apps/native/.env.local` is not enough
because it is ignored locally. Store the public client ids in the matching EAS
environment before building:

```sh
cd apps/native
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value your-web-oauth-client-id.apps.googleusercontent.com
eas env:create --environment production --visibility plaintext --name EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID --value your-ios-oauth-client-id.apps.googleusercontent.com
```

6. Copy `apps/functions/.env.example` to `apps/functions/.env.local` and set
   the backend web OAuth client id:

```sh
GOOGLE_OAUTH_CLIENT_ID=your-web-oauth-client-id.apps.googleusercontent.com
```

Use the same web OAuth client id as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; the
client secret must stay server-side.

7. Store the web OAuth client secret in Firebase Secret Manager:

```sh
firebase functions:secrets:set GOOGLE_OAUTH_CLIENT_SECRET
```

For local function emulator testing, put the same value in
`apps/functions/.secret.local`.

The Settings screen asks parents to grant only
`https://www.googleapis.com/auth/gmail.send` and
`https://www.googleapis.com/auth/drive.file`. The app writes a one-time
Firestore grant request, and a Firestore-triggered function exchanges the
Google server auth code and stores the refresh token under
`families/{familyId}/private/googleDelivery`; only sanitized connection
metadata is mirrored onto the family document for the app UI.
When a wall post is synced to Firestore, `deliverMemoryPostToGoogle` refreshes
the Google access token, uploads any media files to the connected Drive account,
shares those files with the child email, sends the child a Gmail message, and
marks the post `delivered`.

8. The app uses the signed-in Firebase Auth uid as the family member id and
   stores the active family on `users/{uid}`.
9. Deploy rules/functions when ready:

```sh
firebase deploy --only firestore:may-default,storage,functions
```

The next backend iteration should add richer email templates and a dedicated
Drive folder for May uploads.

### Utilities

This Turborepo has some additional tools already setup for you:

- [Expo](https://docs.expo.dev/) for native development
- [TypeScript](https://www.typescriptlang.org/) for static type checking
- [Prettier](https://prettier.io) for code formatting

### Dev Firestore data

The functions package has a dev-only Admin SDK utility for wall stress data.
It targets the `may-default` database by default and uses application-default
credentials or the Firestore emulator when `FIRESTORE_EMULATOR_HOST` is set.

```sh
pnpm --filter functions dev:check-db
pnpm --filter functions dev:seed-wall -- --count 100
pnpm --filter functions dev:seed-wall -- --family-id family_abc --count 100
pnpm --filter functions dev:clear-db -- --yes
```

`dev:seed-wall` duplicates the latest three posts in the selected family,
including their existing media storage references. `dev:clear-db -- --yes`
recursively deletes every root collection in the configured Firestore database.
For cloud Firestore, authenticate the Admin SDK with
`gcloud auth application-default login --project <project-id>` or set
`GOOGLE_APPLICATION_CREDENTIALS` to a service account key with Firestore IAM
access. For the local emulator, set `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`.
