# Native review architecture

## Notes and exercise identities

A user-owned `word_set` groups vocabulary under one language pair. A `word_set_item` holds the editable note content and its stable Anki export GUID. Each item has five `study_card` identities, unique by item and template key.

| Key           | Prompt → answer                     | Required fields             |
| ------------- | ----------------------------------- | --------------------------- |
| `recognition` | Source → translation                | Source and translation      |
| `production`  | Translation → source                | Source and translation      |
| `word_forms`  | Source → word forms                 | Source and forms            |
| `type_answer` | Translation → typed source          | Source and translation      |
| `example`     | Translated example → source example | Example and its translation |

[The shared registry](../src/lib/review/templates.ts) defines these directions and availability for native study and APKG export. Empty fields hide only dependent exercises. All identities and histories remain intact, so restoring content resumes the same cards. Deleting a note cascades to its cards and reviews.

Imported and library-edited notes retain structured example pairs, including unmatched text. The first complete pair supplies the example exercise; legacy notes without pairs use their stored example fields. Imported notes can retain an empty source/translation while awaiting an edit or explicit generation.

Library summaries distinguish words, available exercises and due exercises. Per-word review summaries aggregate available siblings; they do not replace their independent schedules.

## Scheduling and queue order

Each exercise has its own canonical `review_event` history and replaceable `fsrs_card_state` projection. Events record the learner, card UUID, rating, time and optional duration/source metadata; replay orders them by review time and sequence. Imported progress can also supply a durable `study_card_import_baseline`. Replay starts from that baseline and applies only native events; an exercise without starting progress or review history is new. Creating a card never fabricates reviews.

[The versioned FSRS adapter](../src/lib/review/fsrs.ts) calculates rating previews and state transitions on the server. Imported progress preserves the current schedule through a versioned conversion; subsequent ratings use Gooseberry's built-in settings rather than source presets. Imported suspension and unexpired burial exclude cards from queues, due counts and review submission. Reviewing one sibling does not alter the others.

Scheduled due reviews precede new exercises, earliest due first. New exercises visit words in set position order in rounds, rotating the preferred direction across words. Missing fields are skipped, and exclusions for prefetched/answered cards do not restart the rounds. This spaces siblings apart when other words are available. There is no daily new-material limit.

## Persistence and sessions

Authenticated routes validate ownership and eligible card identities. The repository reads the current projection, calculates the next state, then atomically appends its event and conditionally updates the projection by revision. Conflicts reload and retry. The Neon HTTP driver uses atomic batches rather than interactive callback transactions. Repeated submissions reuse their event UUID and do not create duplicate reviews.

The session at `/anki/[id]/review` shows the exercise direction, prompt and revealed answer. New exercises have an introduction control; existing exercises use simple/full self-rating controls, interval previews and keyboard shortcuts. Typed comparison normalizes Unicode, whitespace and case while retaining accents and punctuation. After reveal, a grapheme-level diff marks incorrect typed fragments in red with strikethrough and missing/corrected answer fragments in green with underline. It provides feedback; the learner's chosen rating controls scheduling.

Only the type-in answer field requests disabled autocomplete, autocorrection, capitalization, spellchecking and writing suggestions. These are browser/keyboard hints; device settings can override them. See the [HTML writing-suggestions specification](https://html.spec.whatwg.org/multipage/interaction.html#writing-suggestions).

The browser prefetches exercises and saves ratings in the background. Failed writes support retry/ignore. Pending writes live only in memory; see [review request handling and durability](optimistic-review-updates.md). Synthetic pronunciation is a separate user action.

## Import and content edits

[APKG import](anki-import.md) publishes notes, all five card identities and eligible converted progress in one atomic batch. Progress import defaults on, with editable source-template matches and study timezone. Due dates, intervals and counters carry over only to matching exercise types; additional modes start new. Valid source FSRS memory is reused, or SM2 interval/ease estimate it. Private source tables retain original notes/cards, schedules, review logs and collection/preset configuration separately from native events.

Reimport can seed untouched existing exercises, but a native event, projection or prior baseline prevents replacement. Undo deletes only notes created by that import; progress attached to preexisting notes remains. Deleting a projection or replaying after a scheduler-version change retains the imported baseline.

Content edits update shared note fields without replacing exercise UUIDs. A content revision protects concurrent manual/proposal saves, and field provenance records imported, generated or edited text. Requested enrichment fills only reviewed, still-empty fields; enabling an exercise does not reset sibling progress.

APKG export writes one Gooseberry note with applicable sibling templates. Its historical template ordinals are stable. The export GUID is separate from an imported source GUID; export does not reproduce arbitrary source templates or imported progress.

## Database requirements

Migration `0005` establishes review tables and recognition identities. Migration [`0008_multi_exercise_study_cards.sql`](../migrations/0008_multi_exercise_study_cards.sql) backfills the other directions while preserving existing recognition UUIDs, events and schedules. Owner-scoped reconciliation also creates missing identities when statistics/queues are read, without generating FSRS state.

Import/content metadata requires [`0009`](../migrations/0009_anki_text_import.sql); requested enrichment requires [`0010`](../migrations/0010_requested_enrichment.sql). Migration [`0011`](../migrations/0011_imported_study_progress.sql) adds imported baselines, progress options, suspension and burial. It does not convert previously imported notes automatically; reimport into their existing set to recover untouched progress. New notes receive all five identities in the same atomic batch as their content. Development/build/test commands do not apply these migrations to remote databases.
