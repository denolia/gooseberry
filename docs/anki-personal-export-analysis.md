# Personal Anki export: Suomen Mestari 1

Read-only inspection on 10 October 2026 of `FI - Suomen Mestari 1.apkg`. The file is a personal export with real progress, unlike the supplied shared deck. Neither archive is tracked in Git.

| Data                            | Result                                                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Notes / Anki cards              | 1,775 / 3,550                                                                                                   |
| Studied cards                   | 124, currently in review                                                                                        |
| New cards                       | 3,426                                                                                                           |
| Review-log entries              | 531: 349 learning, 149 review, 33 relearning                                                                    |
| History range                   | 5 September–7 October 2026 (Europe/Berlin)                                                                      |
| Largest current review interval | 37 days                                                                                                         |
| Suspended / buried cards        | None in this sample                                                                                             |
| Flags                           | All zero                                                                                                        |
| Scheduler configuration         | `schedVer: 2`, `sched2021: true`                                                                                |
| Presets                         | One Default preset: 20 new/day, 200 reviews/day; learning 1/10 minutes; lapse 10 minutes; desired retention 0.9 |
| FSRS parameter arrays           | Empty; the file does not establish an active personalized FSRS model                                            |

## Source cards and exercise mapping

The used note type is **Suomen Mestari** (`1353667455730`). Its fields include `Nominatiivi`, `Sound`, `Back`, `Hint` and two Finnish/Russian example pairs. `Hint` contains recall hints rather than grammatical forms.

| Source template   | Tested prompt → answer   | Gooseberry exercise | Review / new cards | Source logs |
| ----------------- | ------------------------ | ------------------- | ------------------ | ----------- |
| Ordinal 0, Card 1 | Nominatiivi → Back       | Recognition         | 69 / 1,706         | 265         |
| Ordinal 1, Card 2 | Back → typed Nominatiivi | Typed production    | 55 / 1,720         | 266         |

The second template uses Anki's `{{type:Nominatiivi}}`; treating it as ordinary production would attach progress to the wrong exercise. Audio, hints and displayed examples are supporting content, not evidence of separate forms/example reviews. The importer suggests these two matches and lets the learner edit them.

Only 69 notes have studied cards: 55 have progress on both siblings and 14 on recognition only. Source logs total **531**, while card review counters total **505**; 22 cards have more logs than their current counters. Conversion preserves both records independently rather than requiring equality.

This is a legacy-v2 package: the real schema-11 database is `collection.anki21`; `collection.anki2` is a compatibility placeholder. The importer must select the real database from the package format, rather than pick the first filename.

## Implemented progress continuation

With progress import enabled, the 124 studied source cards seed their matching native exercises. Additional ordinary production and example exercises start new; forms remain unavailable until supplied. Copying history to these additional exercises would invent learning evidence. The shared export contains the same 1,775 notes and 3,550 cards without review history; mapped content yields 6,358 usable native exercises and 8,875 stable identities.

Every studied card has `card.data` keys `pos` and `lrt`, with no FSRS `s`/`d` memory. FSRS is not enabled in the collection configuration. Conversion therefore estimates FSRS stability/difficulty from the existing SM2 interval/ease at historical retention 0.9, while retaining due dates and counters. Valid source FSRS memory is reusable in other packages. Future ratings use Gooseberry's scheduler, not the preserved Anki preset.

Source IDs, schedules, logs and configuration remain private snapshots. A versioned import baseline anchors native replay; only subsequent Gooseberry ratings become native review events. Earlier text-only imports need reimport into the same set to recover untouched progress after migration 0011. Existing native reviews, projections or baselines prevent replacement.

## Due dates and source metadata

Collection creation is `1738638000` (**4 February 2025, 03:00 UTC**). `creationOffset: -120` means UTC+02, establishing a creation calendar date of 4 February. No IANA timezone or rollover is stored; scheduler V2 defaults rollover to 04:00. The import timezone defaults to the browser and is editable because an offset cannot establish the original timezone.

For **Europe/Berlin**, source day 610 becomes **7 October 2026, 04:00 CEST / 02:00 UTC**; day 640 becomes **6 November, 04:00 CET / 03:00 UTC**. Adding fixed 24-hour intervals to the creation timestamp would miss local rollover/DST. On 10 October after rollover, 66 source reviews are overdue, one is due that day and 57 are future.

Anki `due` can instead be a new-card position or a learning timestamp. Filtered cards retain their original due coordinate separately. Suspension and burial are separate availability controls; burial uses source modification time to avoid renewing an already expired hide. This sample contains no suspended, buried, filtered or currently learning cards, so it does not demonstrate those conversion branches.

The source meanings follow Anki's [card model](https://github.com/ankitects/anki/blob/main/rslib/src/card/mod.rs), [review-log model](https://github.com/ankitects/anki/blob/main/rslib/src/revlog/mod.rs), [card-data storage](https://github.com/ankitects/anki/blob/main/rslib/src/storage/card/data.rs), [scheduler timing](https://github.com/ankitects/anki/blob/main/rslib/src/scheduler/timing.rs) and [FSRS configuration default](https://github.com/ankitects/anki/blob/main/rslib/src/config/bool.rs). The SM2 memory estimate follows the [FSRS bridge](https://github.com/open-spaced-repetition/fsrs-rs/blob/main/src/model_v6.rs).
