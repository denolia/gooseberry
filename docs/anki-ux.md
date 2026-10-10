# Anki capture and library redesign

The decision to keep a word happens at translation time. The result header shows the word and meaning on the left and a single Save card button on the right. Save uses the last successfully used compatible set, remembered per account and language pair in this browser. After saving, that button becomes Edit. If there is no compatible set, Save opens the set-creation controls. Edit expands the destination controls and card editor above the word and preserves the original translation. Each example stays paired with its translation when edited or removed. Forms, notes and tags remain available in a disclosure.

Approaches considered:

- Automatic capture, as in [Readlang](https://readlang.com/): very low effort, but saves words the user may not want. Readlang's [delete while reading](https://blog.readlang.com/2023/06/09/delete-on-untranslate.html) feature illustrates the need for capture control.
- Contextual capture and editable meaning, as in [LingQ's reader](https://www.lingq.com/en/ios-app-support/): keeps vocabulary decisions close to the source.
- A modal card composer: provides space, but interrupts repeated translation. An inline editor provides that control without another navigation step.

Chosen: explicit one-click capture with an inline editor. The set library is a secondary place for search, renaming, refining entries and export. Both entry points share the same editor. Existing bulk import from history and export formats remain available.

Implementation notes:

- Direct saves accept validated card fields under the existing authenticated, ownership-checked item route. The server checks the destination language pair and recognizes an exact existing card. Editing immediately after saving updates the returned item ID.
- New history entries retain their language pair. Old browser-only history without language metadata asks for a new translation before saving.
- Imported and library-edited notes retain structured example pairs, including unmatched entries. Native study/export uses the first complete pair. The editor falls back to semicolon-separated fields for legacy notes; ambiguous semicolons in old data remain a legacy limitation. Translation capture still uses its original field serialization.
- Each saved entry is one vocabulary note. Native study and APKG export share five exercise directions: recognition, production, word forms, typed production and example recall. An APKG contains one note with applicable sibling cards, rather than independent notes for each direction.
- Each native exercise has its own stable study-card identity, review history and FSRS schedule. Existing recognition progress survives the extension. Word-forms and example exercises appear only when their required fields are present; temporarily removing those fields preserves their histories. See [Native review architecture](native-review-architecture.md) for the exact keys and eligibility rules.
- Set and item summaries distinguish vocabulary entries from available/due exercises. Typed comparison gives feedback while the learner's selected rating remains authoritative. Personal presets, suspension and automatic sibling burying are outside this slice.
- Exact-content duplicate detection is sequential, not a database uniqueness guarantee under concurrent requests.
- The set library also opens APKG import with local inspection, mapping/preview and resumable bounded text batches. Same-set reimport uses source GUID uniqueness, rather than exact text matching. Missing imported content remains editable and only its dependent exercises are unavailable. See [Anki import design](anki-import-plan.md).
- Each library word offers explicit generation of selected missing fields, followed by an editable proposal. Saving preserves existing fields and checks the content revision. AI-origin content is labeled. Opening/studying/importing a word never triggers enrichment automatically.

The original capture/editor validation covered the production build, TypeScript and `tests/cardDraft.test.mjs`. Its browser checks used intercepted fixture responses; they did not validate a live authenticated database round trip. Five-exercise validation must additionally cover direction-specific prompts/answers, conditional availability, separate schedules and preservation of existing recognition history.
