# Anki vocabulary import

Gooseberry imports vocabulary from `.apkg` files into its own editable notes and independently scheduled exercises. Import is text-only and makes no AI calls. Imported exercises start with fresh Gooseberry progress; source Anki schedules, reviews and presets are retained privately but do not control study.

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

## Storage, retries and removal

Inspection runs in a browser worker using local SQL.js WASM. The reader supports legacy and modern APKG layouts, including Zstandard/protobuf packages, and chooses the actual database rather than a compatibility placeholder. Media is not expanded, and the archive is not uploaded or stored.

Only selected text records and package metadata reach the server in requests below **3 MiB**, measured as UTF-8 JSON. Reading is cancellable and time-limited. The reader bounds file/database expansion, rows and text; the server independently validates mappings, references, languages, ownership and cumulative sizes.

Import jobs stage private rows until one atomic commit publishes notes and all five exercise identities. Request keys, ordered batch hashes and source GUID uniqueness make retries safe and reject conflicting replays. After a reload, browser recovery asks for the same file again and resumes the saved job.

Reimport into the same set skips existing source GUIDs, preserving local edits and progress, and adds new notes. A new destination set intentionally creates another copy. Undo removes words added by that import and their Gooseberry reviews, while preserving preexisting duplicates and later manual additions. An import-created set is deleted only when empty. Cancellation/undo deletes the job's source snapshots.

Private source tables retain original note fields/GUIDs, source cards and their scheduling data, review logs, note types, deck paths and collection/preset configuration. Converted items have fresh Gooseberry export GUIDs, import ownership, structured examples, field provenance and a content revision. Source records remain separate from native review events and FSRS projections.

## Missing-content generation

**Generate missing content** in a word's actions lets the learner choose empty fields, including source word or translation. Generation uses the language pair, existing vocabulary and imported source context. It produces an editable proposal; insufficient context can produce no suggestion. Nothing is saved until the learner accepts selected values.

Saving fills only requested, still-empty fields and checks the content revision to protect concurrent edits. Field provenance distinguishes imported, AI-generated and edited text. Newly usable exercises retain their stable identities and become available without resetting other progress.

Requests reserve usage atomically before contacting the provider. The same request key recovers its status/proposal without another paid call. Interrupted requests become failed after ten minutes when checked; a new paid attempt requires an explicit action. Failed/unknown attempts retain their reservation because they can be billable. Generation creates AI usage records, not translation history. See [AI usage and limits](admin-and-quotas.md).

## Current limits and deployment

- The browser accepts archives up to 100 MiB, databases up to 32 MiB and total extracted text up to 16 MiB. Server validation can impose tighter field/model limits.
- A conservative 3 MiB visible-content estimate, including the existing destination, bounds import publication because the library returns a whole set. Later manual edits/additions can still grow it. Source staging has a separate 64 MiB per-job ceiling.
- Source progress, scheduler presets, suspension and bury state are preserved as source data; they are not applied to Gooseberry exercises. Imported media, arbitrary templates, collection backups and AnkiWeb sync are unsupported.
- Abandoned staging remains private until cancelled. Automatic pruning and a total per-user storage quota are absent.
- Enrichment defaults to 5 requests/minute, 20/hour and 100,000 reserved tokens/user/UTC day. `ENRICHMENT_DAILY_TOKEN_LIMIT` changes the daily ceiling; zero disables new generation. `OPENAI_ENRICHMENT_MODEL` overrides `OPENAI_TRANSLATION_MODEL`, otherwise `gpt-5-mini` is used.

The application requires migrations [`0009_anki_text_import.sql`](../migrations/0009_anki_text_import.sql) and [`0010_requested_enrichment.sql`](../migrations/0010_requested_enrichment.sql), after the existing migrations. Install/dev/build prepares the worker's local WASM. Development, build and test commands do not apply remote database migrations.

The supplied Suomen Mestari decks contain 1,775 notes and map to 6,358 usable exercises, with 8,875 stable identities. Local import fixtures produce a library response of about 2.3 MB. The personal export's 124 studied cards and 531 reviews are described in the [source analysis](anki-personal-export-analysis.md). The archives are not tracked in Git.
