# Vocabulary capture and library

## Saving and editing

The translation result has one **Save card** action. It uses the last compatible set saved by this account/language pair in the browser. Without a compatible set, it opens set creation. After saving, the action becomes **Edit**, which opens destination controls and the shared inline card editor.

The editor keeps examples paired with their translations and exposes forms, usage notes and tags in a disclosure. Library edits store structured pairs, preserve unmatched examples and use the first complete pair for study/export. Legacy notes fall back to semicolon-separated examples; ambiguity in old serialized text remains. Translation capture uses its existing field serialization.

Direct saves validate content and the destination language pair on the server. They recognize an exact existing entry; this content-based duplicate check is sequential rather than a concurrency uniqueness guarantee. History-based saves use the recorded language pair. Old browser history without language metadata requires a new translation before saving.

## Sets and study

The set library supports search, creation, renaming, editing, deletion, history-based additions, APKG import and export. Each saved word is one note with five independently scheduled exercises. Counts distinguish notes from available/due exercises. Missing fields hide dependent exercises while retaining their identities and histories.

Study presents recognition, production, word forms, typed production and example recall. Due reviews come first; new exercises rotate directions across words in set order. Typed comparison provides feedback and the learner self-rates recall. See [native review architecture](native-review-architecture.md).

## Import and enrichment

**Import Anki deck** opens local package inspection, deck selection, language confirmation, field mapping and prompt/answer previews. Import is text-only and starts fresh Gooseberry progress. Missing imported fields remain editable. Same-set reimport skips source GUIDs and preserves edits/progress; undo removes only notes created by that import. See [Anki import](anki-import.md).

A word's actions include **Generate missing content** when fields are empty. The learner chooses fields, requests a proposal, edits it and saves selected values. Existing fields are preserved, content revisions protect concurrent edits, and AI-origin content is labeled. Opening, importing or studying a note never automatically triggers enrichment.

## Export

APKG export uses the Gooseberry vocabulary note type and applicable sibling templates, with stable note identities. Imported markup is escaped as text. Notes with no usable exercise require completion before APKG export; CSV retains incomplete rows and explicitly declares plain-text fields. User-requested synthetic pronunciation is separate from omitted Anki media.
