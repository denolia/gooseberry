# Study flow: implementation state

Updated **12 November 2026**. All four revision steps are implemented. This document describes the current contract and deployment requirements; superseded proposals and historical validation checkpoints have been removed.

## Implementation checklist

1. [x] Recognition first, production second.
2. [x] Note exposure and the 2 am repetition gate, with immediate client transitions.
3. [x] Study one, selected, or all sets; due-only filtering.
4. [x] Leaves, durable daily activity, history, streaks, and completion messaging.

## Step 1 — Introduction order

A genuinely new note starts with recognition (source → target). Its first saved introduction unlocks production (target → source); saving production unlocks typing, forms, and examples. These introductions may happen on the same day. A due Learning return can appear before the next New introduction; recognition need not graduate before production is introduced.

Queues, counts, and submissions enforce saved prerequisites before batching or exclusions. Missing content, suspension, burial, and short batches cannot bypass them. Existing studied/imported exercises retain their progress. Native history and import baselines restore projections without inventing reviews. A refill requested during an older fetch runs after it finishes so newly unlocked siblings appear promptly.

Implementation: [policy](../src/lib/review/policy.ts), [SQL prerequisites](../src/db/studyPolicy.ts), [scheduler repository](../src/db/reviewRepo.ts), [regressions](../tests/studyIntroduction.test.mjs).

## Step 2 — Exposure and immediate transitions

Every displayed card attempts to record note exposure. Only recognition, production, and typing in Review/Relearning defer after any prior exposure of that note in the current study day. New/Learning and forms/examples bypass the gate but still contribute exposure. A 10-minute Learning return stays eligible; a sensitive Review → Again/Relearning return waits until the next day. Stored FSRS due dates remain unchanged. Effective availability also respects burial and exposure reset.

The note's `last_exposed_at` is the eligibility source. Minimal `study_exposure` receipts authorize one saved completion per presentation and identify retries. Prefetch does not mark exposure. The browser displays buffered prompts immediately, filters waiting sensitive siblings locally, and records displays in the background. Reading, typing, reveal, rating, and advancement never wait for exposure confirmation. Late responses never replace a prompt or clear input. Focus and rollover refresh eligibility while preserving the answer.

Cross-device exclusion of already-buffered cards is best effort. A stale display still records actual exposure. A grade can create its missing presentation receipt without consulting prior exposure, while ownership, prerequisites, due/state, allowance, presentation consumption, and revision checks still protect saves. Confirmed exposure survives abandoned/failed grades. An unconfirmed ungraded display can be lost on close.

Implementation: [day resolution](../src/db/studyDay.ts), [SQL gate](../src/db/studyExposurePolicy.ts), [persistence](../src/db/studyExposureRepo.ts), [client hook](../src/components/review/useStudyExposure.ts), [regressions](../tests/studyExposure.test.mjs).

## Step 3 — One, selected, or all sets

The shared [study page](../src/app/study/page.tsx) and [handlers](../src/lib/review/routes.ts) use the same scheduler for every scope:

```ts
type StudyScope = { kind: "all" } | { kind: "sets"; setIds: string[] };
type StudyFilter = "all_available" | "due_only";
```

- `/study?scope=all` includes all owned sets across language pairs.
- `/study?scope=sets&set=<uuid>&set=<uuid>` studies a selection. One ID is single-set study.
- `filter=due_only` excludes missing or persisted FSRS New projections; due Learning/Review/Relearning remain eligible.
- `GET /api/study/queue` returns up to 20 cards with effective timing and day metadata.
- `POST /api/study/activate` records presentations; `/api/study/reviews` saves ratings. Both derive the owned set from the card.
- Legacy `/anki/[id]/review` pages and single-set APIs remain wrappers; legacy mutations keep their set constraint.

Explicit selections require 1–100 UUIDs, with the cap before case-insensitive deduplication. Invalid/empty selections return 400; foreign, missing, or deleted selected sets return 404. Valid empty sets return an empty queue. An empty selection never widens to all. Exclusions require UUIDs and are capped at 100.

One candidate query applies ownership, content, suspension/burial, prerequisites, due time, independent per-set allowances, and exposure before LIMIT. Scheduled work is globally ordered by due time; New work follows fair rounds of each set's introduction/word order with stable tie breakers. Ranking and unseen cohorts precede exclusions. Five fresh sets can still admit 100 words at the default 20 per set; there is no user-wide new-word allowance.

The library has Study all, Repeat all, and Custom study alongside import/create actions. Custom study uses the native modal and searchable checkbox picker, lists all owned sets, preserves selection during search, and requires a nonempty selection. Cancel/Escape return focus to the trigger. The reviewer preserves scope/filter and the current prompt on refills, shows the current set/direction, and uses each card's source language for audio. Note UUIDs retain their schedules, exposure, and history in every scope. Identical text saved as separate notes remains independent.

Implementation: [scope contract](../src/lib/review/scope.ts), [ownership](../src/db/studyScope.ts), [queue](../src/db/reviewRepo.ts), [library controls](../src/components/anki/StudyScopeActions.tsx), [dialog](../src/components/anki/CustomStudyDialog.tsx), [scope regressions](../tests/studyScopes.test.mjs).

## Step 4 — Leaves and durable activity

| Item                  | Implemented rule                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Completion            | One successfully committed native review/introduction, across all sets and exercise types             |
| Included              | New-card Ok, Again/No, every other saved rating, genuinely due repeats                                |
| Excluded              | Fetch/reveal/display alone, rolled-back writes, duplicate retries, imported logs, projection rebuilds |
| Leaf size             | 20 completions                                                                                        |
| Daily leaves/progress | `floor(todayCompletions / 20)` and `todayCompletions % 20`                                            |
| Scope                 | User-wide across sets, selections, sessions, and devices                                              |
| Partial chunks        | Reset when the credited calendar date advances; no carryover                                          |
| Streak qualification  | Any saved completion; no full leaf required                                                           |
| Spending              | Earned totals only; no wallet                                                                         |

Twelve saves in set A plus fifteen in B yield 27 today: one leaf and 7/20 toward the next. Again counts effort. Earned full leaves remain in the lifetime total after rollover. Partial days appear in history and qualify for streaks.

`study_activity` stores one immutable receipt per original review UUID, with user, server-accepted completion time, credited date, time-zone snapshot, template, and content-attribution UUID snapshots. Content UUIDs have no foreign keys: deleting or moving notes/sets cannot revoke credit. Account deletion cascades. The activity insert, native event, FSRS update, receipt consumption, and renewed exposure commit in the same Neon HTTP batch. Thresholds are derived from receipt counts, so concurrent saves cannot create duplicate awards or a second wallet balance.

Both native save APIs require stable `reviewId` and `reviewedAt`. First writes accept scheduler timestamps up to 24 hours old or 5 minutes ahead of server time. Credit always uses server acceptance time. Already-committed UUID retries are checked before this window and retain their original credit indefinitely, including after rollover. A changed card/rating/timestamp on the same review UUID conflicts. The response includes the original `activityCredit`; replay never creates activity.

### One shared day and time-zone changes

Exposure, new-word allowances, rewards, and streaks use resolved **2 am in the saved study time zone**, default UTC. PostgreSQL moves nonexistent spring 2 am past the gap and uses the later occurrence of ambiguous fall 2 am. The allowance uses accepted activity time for new saves, with native review time as a fallback for legacy history.

A requested time-zone change takes effect at the current day's next boundary. Until then the previous zone and active day start remain effective. At transition, the new day starts at that boundary and ends at the next resolved 2 am in the new zone. The transition day can be shorter. Repeated preference saves do not postpone a pending change; successive changes preserve a clipped active day.

Credited dates use the effective zone's local calendar date associated with its resolved 2 am. Existing receipts never move. Travel can repeat a date, which merges counts without granting an extra streak day, or skip a date, which breaks calendar continuity. On a repeated date, partial progress remains associated with that date. Streaks use unique credited dates; if today is empty but yesterday was active, the current streak lasts until today ends. Future dates from earlier travel do not extend today's streak. Lifetime leaves still include all credited dates.

### API and UI

`GET /api/study/activity?days=365` requires authentication and accepts 1–365 dates, default 365. It returns a bounded, zero-filled calendar, today's completions/leaves/partial progress, lifetime earned leaves, current/longest streaks, and the shared study-day context. The response is private and uncached. SQL computes lifetime summaries from indexed receipts; no daily aggregate table or wallet is needed.

The library shows saved daily progress and an expandable history view. Heatmap intensity uses completions, with date/count tooltips and a keyboard-accessible daily table including zero days. The reviewer shows confirmed global progress in a compact header HUD: a prominent green leaf counter, `n / 20` above a short thin progress bar, and an icon/count for the streak. Routine explanatory copy is hidden from the visual HUD; localized accessible names and hover labels retain its meaning. On narrow screens the HUD occupies a second header row. Confirmed progress advances with a short transform transition. A newly observed leaf increase gets a brief, local counter pulse, with gentler reduced-motion feedback. No milestone banner or Continue/Finish prompt interrupts studying. HUD dimensions stay reserved during loading and counter changes; a new leaf/day resets the bar without animating backwards. Loading/error states do not invent rewards. English and Russian catalogs cover the new UI.

Successful saves invalidate readiness and `studyActivity`; displays invalidate only readiness. Activity refreshes on focus and rollover. Routine saves stay silent in the background, with no saving message, completion-heading swap, exit hold, or unload prompt. Buffered-card advancement never awaits saving. Failed saves retain a fixed Retry/Ignore notice; activity errors also appear outside document flow, so notices cannot push the card down. Ignoring an unconfirmed response does not undo a write that actually committed. The completion screen distinguishes due-only exclusions, exposure deferral, future due times, exhausted new-word allowances, and partial effort.

Implementation: [migration/backfill](../migrations/0016_study_activity.sql), [activity repository](../src/db/studyActivityRepo.ts), [endpoint](../src/app/api/study/activity/route.ts), [query hook](../src/components/review/useStudyActivity.ts), [history/progress](../src/components/review/StudyActivityPanel.tsx), [reviewer](../src/components/review/ReviewSession.tsx), [database regressions](../tests/studyActivity.test.mjs), [UI regressions](../tests/studyActivityPanel.test.mjs).

## Exercise and scheduling contract

| Key           | Prompt → answer                     | Required content       |
| ------------- | ----------------------------------- | ---------------------- |
| `recognition` | Source word → translation           | Source and translation |
| `production`  | Translation → source word           | Source and translation |
| `type_answer` | Translation → typed source word     | Source and translation |
| `word_forms`  | Source word → word forms            | Source and forms       |
| `example`     | Translated example → source example | Both example sentences |

Each exercise has independent FSRS memory/history. Missing content hides exercises without deleting identities. Typing comparison provides feedback; the learner chooses the rating. Forms, examples, and answer context can expose related content, so all displayed types contribute note exposure. Due work precedes New introductions. Learning/Review/Relearning use global due-time order without extra short-step priority. All-available never pulls future work forward.

## Deployment

Apply **all of [0016_study_activity.sql](../migrations/0016_study_activity.sql)** before deploying step 4. A schema-only push omits its native-history backfill. The backfill is idempotent, includes only retained native reviews owned by the note owner, and resolves historical 2 am using the saved zone at migration time. Historical zone snapshots and deleted reviews are unavailable, so those credits are approximate/incomplete. Imports, source logs, and ungraded displays earn nothing.

Earlier prerequisites remain: complete [0013](../migrations/0013_study_exposure.sql), including its exposure backfill, and intervening migrations. No external database was migrated during implementation.

## Separate follow-ups

- Define presentation-receipt retry/resume retention before timed cleanup; preserve pending attempts and idempotency.
- Measure production latency, query plans, and activity-query cost before adding caches, indexes, or daily aggregates. No production throughput benchmark exists.
- A persistent browser outbox remains separate. Background requests, `keepalive`, and in-memory retries cannot guarantee delivery after close.
- User-wide word allowances, cross-set text deduplication, preferential short-step scheduling, typing/production merging, and spending wallets require separate decisions.

## Verification

Step 4 validation: **585 tests passed**, TypeScript checking and the standard Turbopack production build passed, and English/Russian translation validation, changed-file lint, formatting and whitespace checks passed. Subsequent focused checks also cover westward travel preserving the lifetime longest streak while excluding future dates from the current streak. Database regressions run real migrations and production SQL in isolated PGlite; no external database is used. Component checks run in Node without browser automation.

Repository-wide lint still reports the existing errors in `TranslationSelector.tsx` and `WordInput.tsx`; the existing Profile image warning also remains. Browser/UI verification is performed by the user.

### Manual handoff

1. After applying migration 0016, save exercises across two sets and study scopes. Check 19 → 20 → 21 and 39 → 40: leaves and partial progress must match globally and survive reload.
2. Slow down save requests and keep rating buffered cards: advancement stays immediate with no saving message, disabled exit, or shifting header/card. A failed save shows a fixed Retry/Ignore notice. At 9 → 10 and 19 → 20 completions, verify stable HUD dimensions, a gentle fill advance, and a small counter pulse on earning the leaf. Reloading existing progress and rolling over to a new date must not replay the celebration; reduced-motion mode removes spatial motion.
3. Open Study history with keyboard navigation. Confirm partial and zero days, date/count tooltips, daily table, current/longest streak, and English/Russian text at narrow and wide widths.
4. Delete a studied set: its saved activity and leaves remain. Import a deck or rebuild projections: activity does not grow.
5. Verify completion messages for due-only mode, future repetitions, exposure deferral, exhausted allowance, and partial daily effort. Refocusing or reloading restores server-confirmed totals.
6. Check 2 am rollover and a saved time-zone change: exposure/allowance/progress share the boundary; the changed zone becomes active at the next boundary. Today may remain empty while yesterday preserves the streak.
