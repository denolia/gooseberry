# Personal Anki export: Suomen Mestari 1

Read-only inspection on 10 October 2026 of `FI - Suomen Mestari 1.apkg`. The file is a personal export with real progress, unlike the supplied shared deck. Neither archive is tracked in Git.

| Data | Result |
| --- | --- |
| Notes / Anki cards | 1,775 / 3,550 |
| Studied cards | 124, currently in review |
| New cards | 3,426 |
| Review-log entries | 531: 349 learning, 149 review, 33 relearning |
| History range | 5 September–7 October 2026 (Europe/Berlin) |
| Largest current review interval | 37 days |
| Suspended / buried cards | None in this sample |
| Flags | All zero |
| Scheduler configuration | `schedVer: 2`, `sched2021: true` |
| Presets | One Default preset: 20 new/day, 200 reviews/day; learning 1/10 minutes; lapse 10 minutes; desired retention 0.9 |
| FSRS parameter arrays | Empty; the file does not establish an active personalized FSRS model |

## Does it match the design?

Yes. Content lives on notes, while scheduling and history belong to individual source cards. Importing the two Anki siblings as five Gooseberry exercises needs an explicit source-card-to-exercise mapping before any progress migration. Copying the same history to every generated exercise would invent learning evidence.

This is a legacy-v2 package: the real schema-11 database is `collection.anki21`; `collection.anki2` is a compatibility placeholder. The importer must select the real database from the package format, rather than pick the first filename.

Preserve source IDs, template ordinals, raw card scheduling, review logs, collection creation/configuration and preset configuration. Keep those snapshots separate from Gooseberry review events and replaceable FSRS projections. The initial text import starts fresh, while retaining the evidence needed for later personal-progress conversion.

## Conversion traps

- Card `due` uses different units by queue: new-card position, Unix seconds for learning, or collection-relative day numbers for reviews. It is not uniformly a timestamp.
- Review-log intervals use days when positive and seconds when negative. Learning, review, relearning and manual/rescheduling events need distinct treatment.
- Scheduler presets and collection creation/day boundaries affect interpretation. An empty FSRS parameter list is not proof that all scheduling values are directly compatible with Gooseberry's FSRS adapter.
- Suspended and buried cards need separate availability flags and bury expiry, preserving progress underneath. This file cannot validate those branches because it contains no such cards; synthetic fixtures are needed.
- A modern compressed package may use another database filename and protobuf configuration. Preserve raw configuration blobs as well as decoded fields so later support does not require discarding source evidence.

Source interpretation follows Anki's [card model](https://github.com/ankitects/anki/blob/main/rslib/src/card/mod.rs), [review-log model](https://github.com/ankitects/anki/blob/main/rslib/src/revlog/mod.rs), and [package metadata](https://github.com/ankitects/anki/blob/main/rslib/src/import_export/package/meta.rs). These are compatibility findings, not a completed progress migration.
