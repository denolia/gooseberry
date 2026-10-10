# Importing shared Anki vocabulary decks

Updated: 10 October 2026. Scope: vocabulary first, no imported media, and user-requested generation of missing values. The five native exercise types are the first delivery slice; APKG importing and enrichment remain planned work.

## Recommendation

Build an **APKG-to-Gooseberry vocabulary conversion**, with a preview and field mapping per Anki note type. Import supplied content without automatic AI calls. Leave missing values empty and offer explicit “Generate missing values” on demand, including a missing original or translation. Start each learner with fresh Gooseberry scheduling.

Convert notes into the five Gooseberry exercises, using their shared eligibility rules rather than reproducing arbitrary Anki templates. Omit audio/images and disclose formatting loss; media-essential content cannot become a usable exercise without a text alternative. Imported media is outside this plan. Existing user-requested synthetic pronunciation remains separate.

## What the existing system supports

- A set belongs to one user and has one source/target language pair. Items contain seven text fields; original and translation must be nonblank, while optional details already support empty strings. There is no persistent imported-media or raw-source model. See [schema](../src/db/schema.ts), [card validation](../src/app/utils/cardDraft.ts).
- Native study and APKG export share `recognition`, `production`, `word_forms`, `type_answer` and `example`. Each native exercise has its own stable card UUID, events and FSRS state; existing recognition history is preserved. Availability depends on required fields; empty forms/examples hide their exercises without deleting history. **Notes, source Anki cards and available Gooseberry exercises are different counts.** See [shared templates](../src/lib/review/templates.ts), [review architecture](native-review-architecture.md).
- Installed `ankipack@0.3.1` provides `Collection.open(bytes, SQL)`, note fields, GUIDs, tags, deck names and raw card/media data. An in-memory Basic-deck smoke check succeeded. The supplied shared deck was inspected separately as SQLite; compatibility of the dependency with that real deck still needs testing. Its eager media expansion must be avoided for this text-only scope.
- Import idempotency, source provenance, durable jobs and enrichment are new work. Existing exact-content duplicate checks and the nonunique `ankiNoteGuid` index are insufficient.

## Mapping policy

Anki stores fields on a **note type**, then uses templates to produce cards. Mapping must therefore be configured separately for each note type, with sample values and an actual Gooseberry prompt/answer preview. Field names suggest a mapping; they do not prove meaning or direction. Anki templates can add essential instructions beyond the fields. See [Anki field replacements](https://docs.ankiweb.net/manual/templates/fields).

| Gooseberry destination | Suggested Anki fields | Missing-value policy |
| --- | --- | --- |
| `original` | Word, Expression, Foreign, Front | Map/edit, or explicitly request generation from supplied meaning/context. |
| `translation` | Meaning, Definition, Native, Back | Map/edit, or explicitly request generation from supplied source/context. |
| `wordForms` | Forms, Conjugation, Gender, Plural | Empty is valid; deterministic combination allowed. |
| `sample` + `sampleTranslation` | Sentence/Example and its translation | Optional; pair explicitly, preserve unpaired examples. |
| `comments` | Usage, Grammar, Explanation, Pronunciation | Optional; combine selected fields with visible separators. |
| `tags` | Anki note tags | Preserve tags and hierarchy; keep import/source labels separate. |

Allow multiple fields to feed one destination, reordering and fixed separators; avoid arbitrary transformation code. Preserve unmapped text fields in source metadata instead of discarding them or putting everything into comments. Do not retain media payloads. Recognize Gooseberry’s own export schema as a mapping preset, without trusting embedded IDs as authorization.

Confirm the language pair and direction explicitly. Split mixed-language content into separate sets; restrict v1 to configured languages. Existing-target imports must match its pair. Same-language definitions can be accepted when intentionally selected. Do not equate “Front” with the foreign word.

Examples currently split/join on `"; "`, which can occur inside real sentences. Introduce structured example pairs before supporting multiple examples; never infer pairing from punctuation. Normalize HTML entities and line breaks into safe text, show formatting loss in preview, and flag content whose meaning would be lost, including ruby/furigana and formulas.

## Import experience

1. **Upload and inspect:** upload a downloaded `.apkg`; list decks/subdecks, note types, source note/card counts and omitted-media/compatibility warnings. No AnkiWeb account connection or synchronization is needed.
2. **Choose content and destination:** select subdecks/tags and a new or compatible existing set. For v1, flatten the selection into one set while retaining original deck paths as metadata. Anki deck membership is per card: deduplicate a note reached through several selected sibling cards.
3. **Map and preview:** configure each note type; inspect ordinary, empty and unusual examples. Show accepted, invalid, unsupported and already-imported counts, plus the resulting native-card count. Offer a downloadable issue report; nothing is silently skipped or truncated.
4. **Confirm and import:** create a retryable job with progress/cancellation. Stage incomplete writes; publish the selected ready content together. Keep unresolved notes editable in staging, with a user-requested generation action; unavailable exercises never enter the due queue. This needs explicit staging/visibility support.
5. **Study:** show the summary and start studying immediately, with optional enrichment available afterward. Provide “Remove this import” for newly created content; preserve unrelated items and explain deletion of any reviews already made on those imported cards.

Basic and vocabulary-like custom notes become the applicable Gooseberry exercises. Native typed production is available, but arbitrary Anki comparison rules, hints and template behavior are not preserved. A note can convert despite cosmetic JavaScript or unsupported siblings when mapped text still makes sense; never execute that JavaScript. Cloze/image occlusion and essential add-on behavior require separate support. Report incompatible notes rather than exposing a cloze answer or accepting media-essential content without a text alternative. Inspect template configuration as well as field names.

## Missing content and AI cost

| Strategy | Assessment |
| --- | --- |
| Leave optional fields empty | **Default.** Fast, deterministic, no generation cost; already studyable. |
| Generate automatically on first view | Avoid by default: unpredictable billing/latency and repeated or unwanted requests. |
| User-requested enrichment | **Recommended.** Generate chosen missing values, including original/translation, for selected notes. |
| Generate during import | Later opt-in background batch, with an estimate and spending cap; not part of import success. |

Missing original/translation can be resolved on explicit request from the other fields, chosen languages and context. If evidence is insufficient, ask for meaning/context rather than inventing a definite answer. Show generated required content with its AI origin and an editing action; make dependent exercises available once their values pass validation. Retain unresolved notes in staging; currently saved-card validation requires both fields, so the importer needs a separate pending-content path.

Enrichment must use all available source/meaning/context, generate only requested fields, and preserve author content and user edits. Track field origin (`imported`, `edited`, `AI`), intentional blanks/not-applicable values, generation state and content revision. Use idempotency/single-flight and revision checks to prevent repeated billing or overwriting edits. Generate from an explicit action in staging/library or study details, never automatically on viewing a card. Other ready exercises remain studyable during generation.

The existing translation endpoint generates a full response and saves translation history, so it should not be reused unchanged. Imports should not create translation-history or AI-usage entries. Enrichment needs a distinct usage operation, token accounting, rate limits and atomic budget reservations: existing usage tracking does **not** enforce quotas. Estimate from selected eligible notes and measured token usage; do not promise a fixed per-deck price. See [usage/quota investigation](admin-and-quotas.md).

## Identity, updates and scheduling

- Store an import job, mapping version/schema fingerprint and source-note metadata: original GUID/ID, note type/fields, card/template IDs, deck paths, tags and source-content hash. Use a user-owned import lineage for subsequent versions; filenames, deck names and numeric Anki IDs are not global identity.
- Enforce a database uniqueness rule for source note within import lineage and destination set. File checksum/request key prevents duplicate jobs; stable source-note identity prevents duplicates when the package changes. Do not merge by word text: homonyms, senses and examples may legitimately differ.
- V1 reimports skip existing notes and add new ones, preserving edits and review state. Later, offer a field-level update diff against the previous source snapshot, with explicit conflict resolution. Missing notes in an update must not delete local content automatically.
- Give converted notes a fresh Gooseberry export GUID and retain the original GUID separately, avoiding accidental updates to the original Anki note under a different note type. An imported “Gooseberry ID” must never grant access to another user’s record. Re-export uses the Gooseberry schema; exact Anki round-trip fidelity is outside v1.
- Shared-deck imports start fresh rather than inheriting the author's reviews, intervals or progress flags. Create all five stable exercise identities, and only queue those with usable prompt/answer fields; do not fabricate events or FSRS projections. Preserve IDs/state on retries and updates. Importing a learner's own progress, review presets, suspension and bury state is possible future work, outside the first slice; it needs explicit choices and validated conversion rather than copying due dates. See [Anki shared-deck scheduling](https://docs.ankiweb.net/manual/importing/packaged-decks).
- Large imports make every new card immediately due. The queue now prioritizes scheduled due reviews and spreads new sibling exercises across notes. Add a bounded daily introduction policy and benchmark set listing/study queues before raising import limits.

## Formats, media and operational safeguards

Support legacy and modern APKG layouts. Modern packages use Zstandard/protobuf and may contain a **dummy `collection.anki2`**; selecting the first database filename can import a warning instead of the deck. Reject unknown versions cleanly. Read the selected database/configuration without inflating unused media. Enforce actual ZIP/Zstandard expansion, memory/time, entry, field and note/card limits; a compressed-upload cap is insufficient. See [Anki format selection](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs), [package writer](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/colpkg/export.rs), [ankipack reader](https://github.com/ImGajeed76/ankipack/blob/main/src/collection/read.ts).

An 18 MiB package can be uploaded in bounded chunks, persisted under an authenticated upload ID, verified and assembled before parsing. Chunks are transport pieces, not independently parseable decks; assembly still needs the full package and bounded parser resources. Keep chunk ordering/checksums, retries and abandoned-upload cleanup. A simpler alternative is direct browser upload to private object storage, optionally multipart, followed by server-side parsing. Vercel Functions currently limit request/response payloads to 4.5 MB, so avoid a single large function request. See [Vercel limits](https://vercel.com/docs/functions/limitations), [client and multipart uploads](https://vercel.com/docs/vercel-blob/using-blob-sdk#client-uploads).

Because media is omitted, bounded inspection in a browser worker is another option: extract only the database/configuration, then send normalized text rows in batches below the request cap. The supplied deck's database is only about 1.03 MiB. The server must validate every row, language, identity and size; client normalization is not a trust boundary. Prefer a server-owned staged/private-storage pipeline, or explicitly validated text batches, rather than eager whole-archive media expansion.

Recheck ownership at upload, inspection, commit, status, enrichment and removal; use private caching, short upload retention and sanitized logs. Stage database writes in bounded atomic batches using the existing Neon HTTP approach. Delete the temporary archive after processing; retaining it indefinitely would also retain its omitted media.

Treat fields, templates, filenames and deck descriptions as untrusted input. Never execute imported JavaScript/CSS or SQL from the archive; sanitize any future rich HTML, reject traversal/unsafe attachments, and block automatic external resource fetching. Keep uploaded decks private and retain author/source/license metadata where supplied; importing does not authorize republication.

Strip sound/image references from converted text and warn about omitted content. Media-only prompts remain unresolved or excluded until a meaningful text alternative is supplied or explicitly generated. Importing media is outside scope; synthetic pronunciation remains a separate user action.

Reject `.colpkg`/legacy collection backups in v1; never replace the user’s library. CSV/TSV import, deck discovery and Anki sync can follow separately. See [Anki package/export distinctions](https://docs.ankiweb.net/manual/exporting).

## Supplied Suomen Mestari deck

Read-only inspection of `Suomen_Mestari_1_Finnish_-_Russian__-_.apkg` found a legacy SQLite package of 19,137,601 bytes (18.25 MiB), with 1,775 notes, 3,550 Anki cards, no review events and 2,882 media mappings. ZIP metadata was checked first; only the bounded database and media index were read. No recordings were extracted or retained.

All notes use the `Suomen Mestari` type; an unused Basic type is also present. Suggested Finnish → Russian mapping:

| Source field | Destination |
| --- | --- |
| `Nominatiivi` | `original` (1,775 populated) |
| `Back` | `translation` (1,775 populated) |
| `example_1_fin` / `example_1_rus` | First structured example pair (1,033 complete pairs) |
| `example_2_fin` / `example_2_rus` | Second pair (70 complete pairs; preserve unmatched text) |
| `Hint` | Optional metadata; masked initials such as `H...`, **not word forms** |
| `Sound`, `sound_example_1`, `sound_example_2` | Omit media |

There are 1,033 notes with at least one complete example pair. With no generated forms, conversion could expose 6,358 exercises: 5,325 recognition/production/typing plus 1,033 example exercises, while retaining 8,875 stable identities. This is a mapping estimate, not a completed import. The source templates include typed production and cosmetic example-hiding JavaScript, neither of which needs executing for text conversion.

## Delivery and acceptance

1. **Five native exercises:** shared template/eligibility registry, separate stable identities and scheduling, direction-specific study UI and APKG alignment. Preserve recognition history. This slice contains no importer or generation endpoint.
2. **Text import:** validate the real deck and modern packages with the reader; add upload/assembly, staging/provenance/uniqueness, mapping preview, safe conversion, retryable commit/removal and new-card pacing. No automatic AI calls or retained media.
3. **Requested enrichment:** generate selected missing values, including required text, with an editable result, budget controls and availability updates.
4. **Later extensions:** personal progress/presets/suspension/burying, cloze, generic flashcards and source-update merging. General flashcards need a model without mandatory language semantics.

Release checks: separate five-exercise schedules and preserved recognition history; conditional fields hiding/restoring the same identities; correct per-note-type mapping/direction; accents/RTL/line breaks; missing and media-only fields; mixed note types/subdecks; example pairing; matching counts; malformed/unknown packages; bounded decompression; chunk retries/assembly; ownership isolation; no duplicates or half-visible sets; fresh FSRS state; edits/reviews surviving reimport; usable large-deck study. Enrichment also needs required-value validation, concurrent-edit, failed-job and duplicate-billing checks.
