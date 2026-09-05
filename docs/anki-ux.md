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
- Existing storage and export use semicolon-separated example fields. The editor pairs those legacy fields, preserving unmatched entries; new translation drafts use the original structured examples. Ambiguous semicolons in old data remain a legacy limitation.
- The existing APKG exporter generates several study directions per entry as independent notes. No export or database migration is included.
- Exact-content duplicate detection is sequential, not a database uniqueness guarantee under concurrent requests.

Validation: production build, TypeScript, and `node --test tests/cardDraft.test.mjs`. Browser interaction checks use intercepted fixture responses, leaving real user data untouched; they do not validate a live authenticated database round trip.
