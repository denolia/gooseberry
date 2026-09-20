# Native review architecture

## Existing system

- `word_set` is the user-owned deck/library grouping and stores its language
  pair.
- `word_set_item` is the editable study-content record. It behaves like an
  Anki note: one item contains the word, translation, forms, examples, notes,
  and tags. `anki_note_guid` is already its stable Anki note identity.
- There is no persisted card, review, due-date, or scheduling model. The
  `stability` field in text analysis is a linguistic phrase score and is not
  scheduling state.
- APKG export maps each enabled item to one note. `ankipack` then generates up
  to five sibling Anki cards from static templates. Those exported cards do
  not exist as Gooseberry records.
- The UI uses the Next.js App Router, React client components, NextAuth,
  TanStack Query, CSS modules, and a persistent tab panel for the current
  `/anki` set library. The set-detail screen is `/anki/[id]`.
- Tests use Node's test runner. Pure modules are imported directly; route and
  repository tests transpile TypeScript and inject small dependency mocks.

## Smallest compatible model

Keep `word_set` and `word_set_item` unchanged. They already model deck
membership and note content well. Add three scheduling-side entities:

1. `study_card` gives a prompt a stable internal UUID. It points to a
   `word_set_item` and has a flexible `template_key`. Native review initially
   creates only `recognition`; this does not make Gooseberry mirror Anki's five
   export templates. Nullable external source/ID fields leave room for an
   imported Anki card ID without using that ID as Gooseberry's primary key.
2. `review_event` is the canonical history. It records user, card, rating,
   review time, optional duration, and namespaced external identity/metadata.
   Events are replayed in `reviewed_at`, `sequence` order. Application code
   treats this table as append-only.
3. `fsrs_card_state` is a replaceable projection of the event history. It
   holds the fields required by the FSRS card type plus the scheduler version
   and last projected event. It is never the sole source of a review.

A study card with no projection row is a new, immediately due card. This keeps
the migration from inventing review events or scheduler state for existing
content.

For the initial release, the versioned scheduler defaults in code are another
input to a rebuild. If retention or FSRS weights become user-editable, add a
canonical versioned review-preset record; do not store the only copy of those
settings in `fsrs_card_state`.

`word_set_item.is_enabled` remains a content-availability switch. Disabled
items are omitted from both export and native review selection; it is not an
FSRS suspended state.

## FSRS boundary

FSRS should live in a pure server-side module under `src/lib/review`, wrapping
the maintained `ts-fsrs` package. It should accept plain card state and review
events and return the next state/options. Persistence orchestration belongs in
a review repository; authentication and validation belong in thin API routes;
React should receive display-ready cards and rating previews. This keeps the
scheduler out of components, route handlers, and database triggers.

Gooseberry currently uses Drizzle's Neon HTTP driver, which does not support
interactive callback transactions. The review repository therefore reads a
projection, calculates the result, then uses one atomic Neon batch to append
the event and conditionally insert or update the projection by its `revision`.
It retries if another answer won that compare-and-swap. A rebuild operation
discards a projection and replays its history, which is also the path an Anki
importer can use.

## Migration and rollout

Migration `0005_native_review_foundation.sql` creates the three tables and
backfills one `recognition` study card for every existing item. New item
creation writes the item and its card identity in one atomic Neon batch. It
does not create FSRS state or change current routes/UI, so it is safe to deploy
before the scheduler.

## Implemented slices

The native reviewer now consists of four independently committed slices:

1. The inert data foundation: schema, backfill, atomic card creation, shared
   rating/state constants, and tests.
2. A deterministic, versioned `ts-fsrs` adapter that can schedule or replay
   canonical review history.
3. Due-card queries and an authenticated, atomic answer API with optimistic
   projection concurrency control.
4. A browser review session at `/anki/[id]/review`, linked from each set. It
   supports reveal, four FSRS ratings, preview intervals, keyboard controls,
   completion/error states, and review-duration recording. Review submissions
   advance optimistically from a prefetched queue; the request lifecycle and
   current durability limits are documented in
   [Optimistic review updates](optimistic-review-updates.md).

APKG importing remains later. It can populate the external identity and
metadata fields, import canonical events, then replay history into the same
projection.
