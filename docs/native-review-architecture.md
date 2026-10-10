# Native review architecture

## Content and review identities

`word_set` is a user-owned library grouping with a language pair.
`word_set_item` owns the editable vocabulary content: original, translation,
forms, examples, notes and tags. It corresponds to an Anki **note**, and its
`anki_note_guid` remains the stable note identity for export.

Each exercise has a separate `study_card` UUID, identified uniquely by the
item and `template_key`. Editing shared note content updates every exercise;
answering one exercise updates only that exercise's scheduling. The five
keys and their availability rules live in
[the shared template registry](../src/lib/review/templates.ts):

| Key | Prompt → answer | Required content |
| --- | --- | --- |
| `recognition` | Original → translation | Original and translation |
| `production` | Translation → original | Original and translation |
| `word_forms` | Original → word forms | Original and word forms |
| `type_answer` | Translation → typed original | Original and translation |
| `example` | Translated example → source example | Sample and sample translation |

All five identities are retained even when an exercise lacks the fields it
needs. Queries filter availability from the current content. Adding forms or
examples makes their exercises available; removing them hides those
exercises without deleting their identities or review history. Restoring
the content resumes the same cards. Deleting the item itself cascades to its
cards and reviews.

Each card has independent FSRS state and canonical events:

- `review_event` records user, study-card UUID, rating, time, optional duration
  and external identity/metadata. Events are replayed in `reviewed_at`,
  `sequence` order; application code treats them as append-only.
- `fsrs_card_state` is a replaceable projection keyed by user and study card.
  It contains FSRS state, scheduler version, projection revision and last
  event. A card without a projection is new; creating identities never
  fabricates reviews or scheduling state.

Library counts distinguish vocabulary items, available exercise cards and
due exercises. Anki note/card counts are also different: one exported item
is one note with up to five applicable sibling cards.
An item's review summary aggregates its available exercises; it does not
replace their separate schedules. Repetition/lapse counts are totals, and the
last-review timestamp is the latest across those exercises.

## Scheduling and persistence

[The FSRS adapter](../src/lib/review/fsrs.ts) wraps `ts-fsrs` in a pure,
versioned server-side module. It accepts plain state/events and returns rating
options or rebuilt state. Repositories orchestrate persistence; authenticated
API routes validate ownership and requests; React receives display-ready
cards and rating previews.

The Neon HTTP driver does not support interactive callback transactions.
The review repository reads a projection, calculates a result, then uses one
atomic Neon batch to append the event and conditionally insert/update the
projection by its `revision`. Conflicts retry after another answer wins.
Rebuilding discards the projection and replays the same card's events.

Scheduler defaults are versioned in code. Personal review presets, Anki
progress migration, suspension and sibling burying are future work; they are
not inferred from content availability. In particular, reviewing a sibling
does not currently bury the other exercises automatically. Anki's sibling
behavior is described in [its studying manual](https://docs.ankiweb.net/manual/studying).

Future imports can attach namespaced source card identities to existing
`study_card.external_source`/`external_id` fields and preserve source review
details in `review_event.source_metadata`. Template keys remain extensible;
imported/custom templates need not reuse the five built-in keys. Preserve
imported starting state and versioned scheduler presets as canonical inputs
to replay, rather than keeping the only copy in a replaceable projection.
Suspension and bury expiry belong to per-card availability state, separate
from FSRS progress and content completeness. Those later additions do not
require replacing current card UUIDs or their review histories.

Queues prioritize scheduled due reviews before new exercises, with earlier
due dates first. New exercises visit words in set order in rounds, rotating
the preferred exercise by word position so directions are mixed. Missing
fields are skipped, and answered/prefetched siblings retain their place in
the rounds. This spaces a word's exercises apart whenever other words are
available; a daily introduction limit is still future work.

## Rollout and review session

Migration `0005_native_review_foundation.sql` established the tables and
backfilled recognition identities. Apply the additive data migration
[`0008_multi_exercise_study_cards.sql`](../migrations/0008_multi_exercise_study_cards.sql)
to backfill all five keys without replacing existing recognition UUIDs,
events or FSRS projections. It changes no table structure. Idempotent,
user-scoped reconciliation also adds missing identities when querying stats
or a review queue, covering environments where schema push skipped data
migrations. New items receive all five identities in the same atomic batch
as their content; neither path resets learning progress.

The session at `/anki/[id]/review` displays the exercise direction, reveals
its answer, and preserves the introduction control for new cards and the
simple/full rating controls with interval previews and keyboard shortcuts.
Typed production compares the attempt after NFC, whitespace and
case normalization, while preserving accents and punctuation. The comparison
is feedback: the learner's selected rating determines FSRS scheduling.
Synthetic pronunciation is a separate user action, not imported audio.

Submissions advance optimistically from a prefetched queue. Request lifecycle
and durability limits are documented in
[Optimistic review updates](optimistic-review-updates.md).

The [APKG exporter](../src/lib/anki/apkgExporter.ts) shares exercise keys and
eligibility with native study. It still exports one note, not five unrelated
notes. The [Anki import plan](anki-import-plan.md) describes later text
conversion, explicit missing-value generation and fresh per-exercise progress;
no importer or enrichment endpoint is part of this extension.
