# Optimistic review updates

The browser reviewer lets the learner move to the next card without waiting
for the previous review to reach the database. This is an optimistic UI
update: the browser advances its in-memory session queue immediately, while
the server remains the source of truth for review history and FSRS state.

## Loading the session queue

The shared `GET /api/study/queue` API returns up to 20 eligible cards at a time for one, selected, or all owned sets. The scope and all-available/due-only filter remain attached to every refill; due-only excludes New exercises. Scheduled work is ordered globally across sets, then New cards follow fair rounds of each set's introduction/word order. The browser keeps those
cards in memory and starts loading another batch when five cards remain.
Twenty is a fetch size; the separate profile allowance limits new words per
day per set. See [study order and daily limits](study-order.md).

Refill responses merge against the live queue. Scheduled exercises move ahead
of waiting new exercises, while the displayed prompt remains stable. The
session refreshes when the next scheduled repetition is due and on window
focus, including while the completion screen is visible.
It also refills when five scheduled exercises remain, even if the queue still
contains many new exercises, to keep the rest of the due backlog ahead of new
material.

Queue-refill requests exclude:

- cards already waiting in the browser queue;
- cards whose review requests are still pending;
- cards whose review requests exhausted their automatic retries; and
- failed cards the learner chose to ignore for the rest of this session.

These exclusions prevent a card from appearing twice while its database write
is still in flight.

New sibling exercises become eligible only after their prerequisite introduction
is saved. If a save requests a refill while an older queue fetch is in flight,
the client runs that refill after the older fetch finishes. This prevents an
empty response from before the save from hiding newly unlocked siblings until
the next scheduled repetition.

## Answering a card

Prefetch does not mark exposure. The next prefetched card appears immediately;
the browser marks it locally and sends `POST /api/study/activate`
with `displayed: true` in the background. The same presentation UUID is reused
for background retries. Reading, typing, reveal, rating and advancement never
wait for exposure confirmation. Buttons stay enabled, and exposure failures are
silent. Late responses do not replace or remove the visible prompt or clear
the learner's input. The server records exposure and may create a receipt, but
that receipt is no longer a prerequisite for submitting the rating.

The local exposure map immediately removes blocked buffered siblings and filters
late refill responses. Exposure filtering depends on the current word's display,
not its eventual rating. Another tab can still make a buffered card stale: its
prompt remains visible even if its exposure request reports a conflict. The
endpoint records that actual display without interrupting the learner. Queues
and the local map protect future candidates; they do not guarantee strict
cross-device exclusion of already-buffered cards. Focus and the 2 am timer
refresh exposure and availability independently, including while the first
confirmation is pending, preserving the answer.

When the learner chooses a rating, the browser synchronously:

1. creates a review submission with a new UUID, the rating, the time of the
   choice, the time spent on the card, and its client-generated `exposureId`;
2. increments the account-scoped activity cache by one provisional completion;
3. removes the answered card from the in-memory queue;
4. displays the next prefetched card and starts recording its exposure; and
5. starts `POST /api/study/reviews` in the background; the server derives the owned set from the card, so mixed-set answers do not depend on a single session set ID.

The browser does not calculate or persist a new FSRS projection itself. The
server validates the card and appends the canonical `review_event`,
updates the materialized `fsrs_card_state`, consumes the receipt and renews
exposure and inserts its durable `study_activity` receipt in one atomic database batch. If the display request was lost or has
not yet arrived, the grade request creates the same presentation receipt first,
without reapplying the prior-exposure gate. The new-word allowance, introduction
prerequisites, ownership, due time, suspension/burial and revision checks remain.
A grade does not fail because its exposure confirmation is missing.
`nextAvailableAt` includes the exposure reset and burial
expiry without changing the stored FSRS due date.

## Retries and idempotency

A failed request is retried three times, after delays of 300 ms, 900 ms, and
1,800 ms. This means one initial attempt and up to three automatic retries.
The learner can continue reviewing while this happens.

Every attempt reuses the same client-generated review UUID and original review
timestamp. The server treats that UUID as the `review_event` ID. If the first
request was committed but its response was lost, a retry recognizes the
existing event and returns success instead of recording a duplicate review.

After all automatic retries fail, the reviewer shows:

> We had an issue trying to update your progress.

`Retry` sends the same idempotent submission through the automatic retry cycle
again. `Ignore` dismisses the failure and keeps that card out of the current
session. Ignoring stops retries; it does not undo a write that committed before its response was lost. A review that never committed earns no credit. Its confirmed exposure remains durable, so a
sensitive repetition still waits until the next study day.

Successful saves invalidate set readiness. The HUD projects a small UUID-keyed optimistic ledger over the last server activity snapshot, incrementing on a valid rating without awaiting either the save or a history fetch. Retrying the same review does not add another completion. Failed saves roll back only their own provisional credit. Activity reads are cancelled before new optimistic changes and wait until pending saves settle, so stale snapshots cannot erase clicks or double-count committed reviews. One refresh after a one-second quiet period replaces the projection with authoritative totals and clears its ledger. Focus and rollover refreshes use the same coordinator. Unknown initial totals stay unknown until the first load. Durable leaves, partial daily effort and streaks come from committed activity receipts across every scope/session. Twenty saves earn one leaf; every rating counts. Exposure alone earns nothing. The save response returns the original `activityCredit`, including on retries after rollover. Both APIs require a stable review UUID and timestamp; first writes accept timestamps up to 24 hours old or 5 minutes ahead, while committed retries remain valid indefinitely.

## Navigating away

Routine saves remain silent: the reviewer adds no saving message, exit hold, unload prompt, or temporary completion heading. The next buffered exercise stays immediately usable. The fixed HUD reserves its size before activity loads and across counter changes; rating clicks animate provisional progress immediately, then reconcile silently with the server. New leaves get a brief in-place pulse instead of a milestone banner or Continue/Finish prompt, with reduced-motion support. Actual failures retain a fixed Retry/Ignore notice, and activity-query errors also stay outside document flow.

Review POST requests use the Fetch API's `keepalive` option. This gives a
small in-flight request a better chance of completing when the learner leaves
the review page. It is not a delivery guarantee: closing the browser, losing
the network, or terminating the page can still prevent the write. JavaScript
retry timers also stop when the page is destroyed.

## Durability limit

Pending and failed submissions currently live only in memory. Gooseberry does
not store an outbox in local storage, IndexedDB, or another persistent browser
store, and it does not resume unsent reviews the next time the browser opens.
An unsaved review leaves its FSRS card due on the server. Exposure is persisted
separately in the background. Once confirmed, sensitive repetitions still wait
until the next study day even if their grade was never saved. Closing before
the exposure request succeeds can lose that display, just as an unsent grade
can be lost. `keepalive` and retries reduce this risk without guaranteeing delivery.
