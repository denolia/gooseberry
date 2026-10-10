# Importing Anki vocabulary decks

Updated: 10 October 2026. The first three slices are implemented: five independently scheduled exercises, text-only APKG import, and explicit missing-content generation. Vocabulary is the supported use case; personal progress migration is still future work.

## Import flow

Open **Import Anki deck** from the set library (`/anki/import`). Choose a downloaded `.apkg`, select decks/subdecks, confirm source/target languages, then map each note type into a new or compatible existing set. Deck membership is per Anki card; notes reached through selected siblings are deduplicated. Names suggest mappings but never establish language direction by themselves.

The preview shows source notes/cards, resulting exercises, missing required content, unsupported note types and omitted media. Multiple source fields can feed one destination with a chosen separator. Examples are mapped as explicit pairs, with unmatched text retained; no pairing is inferred from semicolons. An issues report is downloadable. Cloze and image-occlusion notes are excluded with an explanation. Arbitrary template JavaScript, CSS, hints, comparison rules and add-on behavior are not reproduced.

| Gooseberry field      | Typical source fields              | Empty behavior                                       |
| --------------------- | ---------------------------------- | ---------------------------------------------------- |
| Source word           | Word, Expression, Foreign, Front   | Keep editable; dependent exercises wait for content. |
| Translation           | Meaning, Definition, Native, Back  | Keep editable; dependent exercises wait for content. |
| Word forms            | Forms, Conjugation, Gender, Plural | Forms exercise remains unavailable.                  |
| Example / translation | Explicit sentence pairs            | Example exercise uses the first complete pair.       |
| Usage notes           | Usage, Grammar, Explanation        | Optional; combine chosen fields visibly.             |
| Tags                  | Anki note tags                     | Preserve tags; import identity is separate metadata. |

Incomplete imported notes are saved in the library and marked as needing attention. Edit them manually or request generation afterward. All usable exercises can be studied immediately. Imports never call AI, create translation history, or inherit another learner's progress. Source audio/images are omitted; synthetic pronunciation remains a separate user action.

Reimport into the **same destination set** skips matching source GUIDs and adds new notes, preserving local edits, card UUIDs and review state. Importing into a new set intentionally creates another copy. Source updates are not merged automatically. Undo removes words created by that import and their Gooseberry reviews; existing duplicates and later manually added words remain. A newly created set is removed only when it becomes empty. Import cancellation/removal also deletes the job's private source snapshots.

## Transport and limits

The archive stays in the browser. A worker reads legacy and modern APKG databases, including Zstandard/protobuf packages, without inflating media. It chooses the real database rather than a compatibility-placeholder `collection.anki2`. Local SQL.js WASM is prepared during install/dev/build; no external WASM download is required.

Only selected notes, source cards/reviews and package configuration reach authenticated server routes. Text is split by actual UTF-8 JSON size into requests below the server's **3 MiB** limit, leaving room below Vercel's [4.5 MB function payload limit](https://vercel.com/docs/functions/limitations). The supplied 18.25 MiB shared archive produces 21 batches, the largest under 283 KB. Binary chunk assembly or object storage is unnecessary for this text-only version.

The reader bounds archive/database expansion, Zstandard windows/output, entries, rows and total text; it rejects malformed/unknown formats and unsafe SQLite schemas. The worker can be cancelled and has a timeout. The server independently validates sizes, supported languages, mappings, references and ownership; browser parsing is not a trust boundary. Server ceilings include 20,000 notes, 100,000 cards, 1,000,000 review rows, 2,000 batches and 64 MiB cumulative staged text. A conservative 3 MiB visible-content estimate also prevents publishing an oversized set through the currently unpaginated library endpoint; select fewer decks/fields if exceeded. Later manual additions/edits can still grow a set. These ceilings are safeguards, not a promise that every deck near them fits browser memory.

Field conversion strips HTML, scripts and media references into plain text. Imported templates/SQL are never executed, and external resources are never fetched. Native rendering escapes text; APKG export HTML-escapes it, and CSV explicitly declares plain-text fields. Raw source snapshots are private, bounded and accessible only through owner-checked reads. No media payload or uploaded archive is stored.

## Persistence and recovery

`anki_import_job` records the user, request key/hash, file checksum, language pair, mapping, package configuration, destination and counts. `anki_import_batch` records ordered batch hashes. Repeating the same begin/batch/commit is safe; conflicting reuse is rejected. Browser recovery stores only the job/selection/mapping metadata and asks for the same file again after reload. Staged rows are invisible to study/library queries until one atomic PostgreSQL commit publishes the content and five card identities. Incomplete references never publish a partial set.

`import_source_note`, `import_source_card` and `import_source_review` preserve source GUIDs/IDs, template ordinals, fields/tags, raw schedules and logs. Deck/configuration/model snapshots remain in the job, including undecoded protobuf data where necessary. A source note links to its converted item; source Anki cards are not assumed to correspond one-to-one to the five Gooseberry exercises.

`word_set_item` stores `source_note_key`, import ownership, structured `example_pairs`, `content_revision` and field provenance. It receives a fresh Gooseberry export GUID, preserving the source GUID separately. Exporting uses the Gooseberry note type and canonical example pair; additional pairs remain editable in the library and raw source. Exact Anki round-trip fidelity is outside this release. APKG export asks the learner to complete notes with no usable exercise before exporting; CSV can retain those incomplete rows.

Each converted note gets all five stable `study_card` UUIDs, with no fabricated `review_event` or FSRS projection. Availability follows current content. Removing/restoring optional content hides/resumes the same exercise and history. New exercises run in rounds over set word order with rotating directions; scheduled due reviews take priority. Automatic sibling burying and a daily introduction limit remain future work.

## Requested enrichment

**Generate missing content** in a word's library details lets the learner select missing fields, including source word or translation. Generation uses the chosen languages, existing vocabulary and private source context. It returns an editable proposal; saving fills only requested, still-empty fields. Insufficient evidence can produce no suggestion. Existing author content is preserved, and a content-revision comparison prevents overwriting concurrent edits. Structured example pairs retain unpaired source examples. Field origin records distinguish imported, AI-generated and manually edited content.

The dedicated endpoint creates no translation-history rows. It reserves usage atomically before contacting OpenAI, disables SDK retries, and recovers a request by its idempotency key. Completed results are stored before returning. Reloading/checking status never makes a paid call. Requests still pending after ten minutes become failed during recovery; another paid attempt requires an explicit new request. Failed/unknown calls retain their reservation because provider spend may already have occurred. Unaccepted local attempts can retry the same key safely, and proposals can be discarded.

Limits are **5 requests/minute, 20/hour and 100,000 reserved tokens/user/UTC day** by default. `ENRICHMENT_DAILY_TOKEN_LIMIT` configures the daily ceiling (zero disables new generation). Reservations conservatively cover prompt bytes, output and framing; actual token usage is recorded separately. `OPENAI_ENRICHMENT_MODEL` overrides the existing translation-model default. No bulk enrichment, automatic first-view generation or guaranteed per-deck price is offered. See [AI usage and quotas](admin-and-quotas.md).

## Supplied decks and future progress migration

Both supplied Suomen Mestari files parse as 1,775 notes and 3,550 Anki cards. `Nominatiivi` maps to source, `Back` to translation, and the two Finnish/Russian example fields map to explicit pairs. `Hint` contains masked initials, not word forms. There are 1,033 notes with a complete example, giving **6,358 usable exercises** and **8,875 stable card identities**, without generated forms. The shared archive contains no reviews; the personal export contains 124 studied cards and 531 review records. Neither archive is tracked in Git. See the [personal export analysis](anki-personal-export-analysis.md).

Later progress migration must explicitly match source template/card to Gooseberry exercise before replaying history; never copy one source card's reviews to all five exercises. Queue-dependent due units, negative learning intervals, collection day boundaries and scheduler presets require validated conversion. Suspension and temporary burying belong to per-card availability, separate from FSRS. Preserve imported starting state/presets as canonical inputs rather than only a replaceable projection. This sample has no suspended/buried cards; synthetic fixtures cover raw preservation, not full migration behavior.

Next slices: source-update diffs/conflict resolution, paginated large libraries and daily new-material pacing, personal progress/presets/suspension/burying, then cloze/general flashcards and CSV import. General flashcards need a model without mandatory vocabulary-language semantics. AnkiWeb sync, deck discovery and `.colpkg` collection replacement are outside scope.

Abandoned staging remains private until cancelled; automatic retention/pruning and per-user storage allowances remain operational follow-ups. Individual import size limits do not impose a total library storage quota.

## Rollout and verification

Apply additive migrations [`0009_anki_text_import.sql`](../migrations/0009_anki_text_import.sql) and [`0010_requested_enrichment.sql`](../migrations/0010_requested_enrichment.sql), after the existing migrations, **before deploying this application version**. These add tables/columns and do not reset native progress. Repository changes do not apply migrations to a remote database automatically.

Automated checks exercise real SQLite packages and local PostgreSQL semantics: malformed/decompression limits, modern/legacy selection, safe mapping and examples, byte-bounded batches, ownership, atomic publication/rollback, idempotent concurrent retries, reimport/removal, independent schedules, quota reservations, interrupted recovery, and stale proposal/manual edits. Both supplied files were parsed/mapped locally. No live import, paid generation or remote migration was performed. Responsive browser/focus QA remains a manual release check because browser inspection stalled during the isolated preview.

Format references: Anki's [package metadata](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs), [field replacements](https://docs.ankiweb.net/manual/templates/fields), and [packaged-deck import behavior](https://docs.ankiweb.net/manual/importing/packaged-decks).
