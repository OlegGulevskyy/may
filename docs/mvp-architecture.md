# May MVP Architecture

## Current POC

- `apps/native` contains the parent-facing Expo app.
- `packages/core` defines shared memory types, delivery statuses, and helpers.
- `apps/functions` contains Firebase Functions scaffolding for media processing
  and Gmail/Drive delivery.
- `firestore.rules` and `storage.rules` define a family-member-only security
  model.

## Data Flow

1. A parent creates a post with text and optional image, video, or audio media.
2. The app stores the post locally immediately as a cache/outbox.
3. When online, the app writes the post document to Firestore at
   `families/{familyId}/posts/{postId}`. Media upload will later write original
   files to Firebase Storage under:

```txt
families/{familyId}/posts/{postId}/media/{mediaId}/original
```

4. Storage functions will generate canonical image thumbnails.
5. A delivery function copies/summarizes the post into the author's Google
   Drive and sends a Gmail message from the author's account to the child's
   inbox.
6. Firestore post snapshots drive realtime UI updates for both parents.

## Delivery Statuses

- `local`: created on-device
- `queued`: waiting for network or upload worker
- `synced`: saved to Firestore
- `uploading`: media upload in progress
- `stored`: media has reached cloud storage and is ready for delivery
- `emailing`: backend is delivering to Gmail/Drive
- `delivered`: Gmail/Drive delivery succeeded
- `failed`: retryable failure

## Next Backend Step

Extend the native sync repository so it:

- uploads each local media file to Firebase Storage
- stores upload progress and retry state in a durable local outbox
- requests each parent's Gmail/Drive consent needed for delivery from their own
  Google account
- keeps the local cache/outbox behavior as the fallback when Firebase is
  unavailable
