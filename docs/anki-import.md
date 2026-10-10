# Anki vocabulary import

Gooseberry imports vocabulary from `.apkg` files into its own editable notes and independently scheduled exercises. Import is text-only and makes no AI calls. **Keep Anki learning progress** is enabled by default; matching exercises continue from converted source progress, while additional exercise types start new.

## Import and mapping

**Import Anki deck** in the set library opens `/anki/import`. The learner selects a local package, chooses decks/subdecks, confirms the language pair, and selects a new or compatible existing set. Anki deck membership belongs to cards; a note selected through several sibling cards is imported once.

Each note type has its own mapping and preview. Suggested field names are editable, and several fields can be combined with a chosen separator.

| Destination               | Stored content                                              |
| ------------------------- | ----------------------------------------------------------- |
| Source word / translation | The vocabulary and its meaning in the chosen languages      |
| Word forms                | Optional grammar/forms text                                 |
| Examples                  | Explicit source/translation pairs, including unmatched text |
| Usage notes               | Optional context assembled from selected fields             |
| Tags                      | Anki note tags                                              |

The preview shows source notes/cards, resulting exercises, missing content, excluded note types and omitted media. An issues report is downloadable. Audio/images are omitted, HTML becomes plain text, and imported scripts/templates are never executed. Cloze and image-occlusion notes are excluded. Arbitrary Anki template behavior is not reproduced.

Missing fields remain empty and editable. An exercise becomes available only when its prompt and answer exist. All example pairs remain in the library; the first complete pair supplies the example exercise and the exported canonical example. Re-export uses the Gooseberry note type and does not reproduce the original deck exactly.

## Learning progress

Each source card template has a suggested, editable exercise match. Template ordinals alone do not identify an exercise: the Suomen Mestari deck's second template is typed production. Unmatched templates retain their source data without transferring progress; two source templates cannot supply progress to the same native exercise. The preview reports matched studied cards and unsupported scheduling data. Turning off progress import leaves newly added exercises new; existing Gooseberry progress is preserved on reimport.

Matching exercises carry their due dates, intervals, review/lapse counters and learning state. Existing Anki FSRS stability/difficulty are reused when valid; otherwise interval and ease estimate FSRS memory at historical retention 0.9. This conversion preserves the current schedule, rather than recreating Anki's scheduler. Presets remain source data, and subsequent ratings use Gooseberry's built-in FSRS settings and learning steps.

The editable study timezone defaults to the browser timezone. Anki supplies an offset rather than an IANA timezone: newer scheduler day numbers use the collection's creation offset and local rollover to identify calendar dates, including daylight-saving changes. Learning timestamps remain absolute. Imported suspension is respected; burial expires at the rollover following the source card's modification time, so stale burial does not hide a card for another day.

A versioned, durable import baseline anchors the native schedule. Rebuilding a projection starts from this baseline and applies only real Gooseberry ratings. Original Anki review logs remain private source evidence; they are never manufactured into native review events or copied to additional exercise types.

## Storage, retries and removal

Inspection runs in a browser worker using local SQL.js WASM. The reader supports legacy and modern APKG layouts, including Zstandard/protobuf packages, and chooses the actual database rather than a compatibility placeholder. Media is not expanded, and the archive is not uploaded or stored.

Only selected text records and package metadata reach the server in requests below **3 MiB**, measured as UTF-8 JSON. Reading is cancellable and time-limited. The reader bounds file/database expansion, rows and text; the server independently validates mappings, references, languages, ownership and cumulative sizes.

Import jobs stage private rows until one atomic commit publishes notes and all five exercise identities. Request keys, ordered batch hashes and source GUID uniqueness make retries safe and reject conflicting replays. After a reload, browser recovery asks for the same file again and resumes the saved job.

Reimport into the same set skips existing source GUIDs, preserving local content edits, and adds new notes. It can recover Anki progress for an untouched existing exercise, but never overwrites a native review, projection or import baseline. A new destination set intentionally creates another copy. Undo removes words added by that import and their Gooseberry reviews, while preserving preexisting notes, their progress and later manual additions. An import-created set is deleted only when empty. Cancellation/undo deletes the job's source snapshots.

Private source tables retain original note fields/GUIDs, source cards and their scheduling data, review logs, note types, deck paths and collection/preset configuration. Converted items have fresh Gooseberry export GUIDs, import ownership, structured examples, field provenance and a content revision. Raw source records remain separate from native events, converted baselines and FSRS projections.

## Missing-content generation

**Generate missing content** in a word's actions lets the learner choose empty fields, including source word or translation. Generation uses the language pair, existing vocabulary and imported source context. It produces an editable proposal; insufficient context can produce no suggestion. Nothing is saved until the learner accepts selected values.

Saving fills only requested, still-empty fields and checks the content revision to protect concurrent edits. Field provenance distinguishes imported, AI-generated and edited text. Newly usable exercises retain their stable identities and become available without resetting other progress.

Requests reserve usage atomically before contacting the provider. The same request key recovers its status/proposal without another paid call. Interrupted requests become failed after ten minutes when checked; a new paid attempt requires an explicit action. Failed/unknown attempts retain their reservation because they can be billable. Generation creates AI usage records, not translation history. See [AI usage and limits](admin-and-quotas.md).

## Current limits and deployment

- The browser accepts archives up to 100 MiB, databases up to 32 MiB and total extracted text up to 16 MiB. Server validation can impose tighter field/model limits.
- A conservative 3 MiB visible-content estimate, including the existing destination, bounds import publication because the library returns a whole set. Later manual edits/additions can still grow it. Source staging has a separate 64 MiB per-job ceiling.
- Progress transfers only to matched, supported exercise types; extra exercises start new. Source scheduler presets are retained but not applied. Imported media, arbitrary templates, collection backups and AnkiWeb sync are unsupported.
- Native suspension controls are absent. Keeping progress also keeps source suspension; turning off progress import creates active, new exercises.
- Abandoned staging remains private until cancelled. Automatic pruning and a total per-user storage quota are absent.
- Enrichment defaults to 5 requests/minute, 20/hour and 100,000 reserved tokens/user/UTC day. `ENRICHMENT_DAILY_TOKEN_LIMIT` changes the daily ceiling; zero disables new generation. `OPENAI_ENRICHMENT_MODEL` overrides `OPENAI_TRANSLATION_MODEL`, otherwise `gpt-5-mini` is used.

The application requires migrations [`0009_anki_text_import.sql`](../migrations/0009_anki_text_import.sql), [`0010_requested_enrichment.sql`](../migrations/0010_requested_enrichment.sql) and [`0011_imported_study_progress.sql`](../migrations/0011_imported_study_progress.sql), after the existing migrations. Migration 0011 adds progress storage and availability flags without automatically converting earlier imports; reimport into the existing set to recover eligible untouched progress. Install/dev/build prepares the worker's local WASM. Development, build and test commands do not apply remote database migrations.

The supplied Suomen Mestari decks contain 1,775 notes and map to 6,358 usable exercises, with 8,875 stable identities. Local import fixtures produce a library response of about 2.3 MB. The personal export's 124 studied cards and 531 reviews are described in the [source analysis](anki-personal-export-analysis.md). The archives are not tracked in Git.
