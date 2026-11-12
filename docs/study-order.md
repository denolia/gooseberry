# Study order, daily limits, and reviews

This describes the implemented flow. See the [revision state](study-flow-revision-plan.md) for deployment requirements and the manual handoff.

## Independent exercises and saved introductions

Each vocabulary note owns five stable exercise identities:

| Exercise        | Prompt → answer                     | Required content       |
| --------------- | ----------------------------------- | ---------------------- |
| Recognition     | Source word → translation           | Source and translation |
| Production      | Translation → source word           | Source and translation |
| Type the source | Translation → typed source word     | Source and translation |
| Word forms      | Source word → forms                 | Source and forms       |
| Example recall  | Translated example → source example | Both example sentences |

Each exercise has independent FSRS memory, due time, and native review history. Missing content hides only dependent exercises and preserves their identities/history. A basic note offers three exercises; a complete note can offer five.

A genuinely new note starts with recognition. Saving it unlocks production; saving production unlocks typing, forms, and examples, in that order. Introductions can happen on the same day. These are server prerequisites, enforced before queue batching/exclusions and on submission. A missing/paused recognition cannot introduce an unseen word through optional content. Existing studied/imported directions retain their schedules even if an earlier type has never been studied. History and imported baselines preserve progress across projection rebuilds.

## Shared queue and returning exercises

`/study` handles one, selected, or all owned sets across language pairs. Due-only excludes New exercises while retaining due Learning/Review/Relearning. Existing single-set URLs remain supported.

Queues reconcile identities/projections, then apply ownership, content, suspension/burial, introduction prerequisites, due time, allowances, and exposure before LIMIT. Scheduled work is globally earliest-due-first. Learning steps do not get an extra priority over overdue reviews. New work follows fair rounds of each set's eligible introduction/word order. Stable set/card tie breakers and ranking before exclusions keep refills predictable.

Twenty is a network batch size. The client refills when five cards remain, or when the remaining scheduled buffer is low. Newly due scheduled cards move ahead of waiting New cards, preserving the active prompt. Refreshes run at the next due time, on focus, and at the day boundary. A post-save refill requested during an older fetch runs after that fetch, so unlocked siblings do not wait for a later timer.

The FSRS adapter uses 90% desired retention, 1- and 10-minute learning steps, a 10-minute relearning step, and no interval fuzz. New exercises have Ok (Good); Simple mode maps No/Yes to Again/Good, and Full mode exposes all four ratings. Typed comparison gives feedback; the learner chooses the rating. Future exercises are never pulled forward merely to fill a batch.

## Exposure and the shared 2 am day

Every displayed card attempts to record note exposure in the background. Recognition, production, and typing in Review/Relearning defer after any earlier exposure since resolved 2 am in the effective study zone. New/Learning and forms/examples bypass the gate but still record exposure. This permits 10-minute Learning returns while sensitive Again/Relearning returns wait until the next study day. FSRS due dates remain unchanged.

Prompts, typing, revealing, rating and advancement never wait for exposure confirmation. Server queue filtering and a local buffer guard protect future candidates; already-buffered cross-device displays remain best effort. Prefetch alone records nothing. See [exposure behavior and persistence](native-review-architecture.md#exposure-and-the-2-am-reset).

Exposure, allowances, rewards and streaks share one day context. The default zone is UTC. PostgreSQL moves nonexistent spring 2 am past the gap and uses the later ambiguous fall 2 am. A requested zone change takes effect at the current day's next boundary; the transition day ends at the new zone's next 2 am and can be short. Earlier activity dates/zones are immutable. Travel can repeat a date (counts merge) or skip one (calendar streak continuity breaks).

## New-word allowance

Profile sets **new words per day per set**, default 20, configurable from 0 to 1,000. Zero pauses wholly unseen words. Each set has its own allowance: five fresh sets can admit 100 words at the default limit.

A word consumes a slot when its first native completion is saved. New saves use accepted activity time, with native review time as a fallback for legacy history. Prefetch and exposure do not consume slots. Eligible unseen words are chosen in position/UUID order before card batching and exclusions. Refills cannot open another cohort; unused allowance does not accumulate.

Already-started words retain unlocked siblings and due repetitions, including when the setting is zero. Imported studied progress marks a word as started without spending allowance. Canonical history and imported baselines preserve this across projection rebuilds. Unavailable recognition cannot reserve an unseen slot. Up to five exercises can eventually be introduced per admitted word; this is a word allowance, not an exercise cap.

## Leaves, history and streaks

Every successfully committed native exercise counts globally, including New Ok, No/Again, and every other saved rating. Twenty completions earn one leaf. Twelve saves in one set and fifteen in another yield one leaf plus 7/20. Partial progress resets when the credited date advances; earned full leaves remain in the lifetime total. Any saved completion qualifies for a streak; yesterday preserves the current streak while today is still empty.

Activity receipts survive content deletion and are unique by review UUID. Imports, projection rebuilds, displays, failed transactions and duplicate retries earn nothing. A retry after rollover returns its original credited date. Historical backfill includes retained native reviews only, using the saved zone as an approximation where historical snapshots are unavailable.

The library shows daily progress and expandable history. Heatmap shading reflects saved completions, including partial days; tooltips and a daily table provide date/count equivalents. The reviewer shows confirmed progress in a stable header HUD, gently animates the bar, and briefly pulses the leaf counter when a leaf is earned. Reduced-motion preferences are respected. Routine saves stay silent and never hold advancement or exit. Actual failures retain a fixed Retry/Ignore notice without shifting the exercise. Background saves still have no persistent browser outbox.

Completion messages identify due-only exclusions, exposure deferral, future due times, exhausted allowances, and partial daily effort. See [optimistic review updates](optimistic-review-updates.md).

Implementation: [queue/save](../src/db/reviewRepo.ts), [allowances](../src/db/studyAllowance.ts), [day](../src/db/studyDay.ts), [activity](../src/db/studyActivityRepo.ts), [reviewer](../src/components/review/ReviewSession.tsx). Regression checks cover [introductions](../tests/studyIntroduction.test.mjs), [scopes](../tests/studyScopes.test.mjs), [exposure](../tests/studyExposure.test.mjs), [allowances](../tests/studyAllowance.test.mjs), [activity](../tests/studyActivity.test.mjs), and [session behavior](../tests/reviewSession.test.mjs).
