# Optimistic review updates

The browser reviewer lets the learner move to the next card without waiting
for the previous review to reach the database. This is an optimistic UI
update: the browser advances its in-memory session queue immediately, while
the server remains the source of truth for review history and FSRS state.

## Loading the session queue

The review API returns up to 20 due cards at a time. The browser keeps those
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

Prefetch does not mark exposure. Before showing the next prompt, the browser
authorizes it through `POST /api/word-sets/[id]/review/exposure`, reusing a stable
presentation UUID for automatic/manual retries. The server atomically checks
prior exposure for sensitive Review/Relearning cards, marks exposure for every
allowed type/phase, and returns a receipt. Stale blocked cards are skipped before
display. A failed authorization shows a retry action and keeps the prompt hidden.
The local exposure map also removes blocked buffered siblings and filters late
refill responses. Focus and the 2 am timer renew an already-visible prompt using
its original receipt, preserving its revealed or typed answer.

When the learner chooses a rating, the browser synchronously:

1. creates a review submission with a new UUID, the rating, the time of the
   choice, the time spent on the card, and the authorized `exposureId`;
2. removes the answered card from the in-memory queue;
3. starts authorizing the next prefetched card; and
4. starts the review API request in the background.

The browser does not calculate or persist a new FSRS projection itself. The
server validates the card and receipt, appends the canonical `review_event`,
updates the materialized `fsrs_card_state`, consumes the receipt and renews
exposure in one atomic database batch. A grade does not fail because of its own
authorized display. `nextAvailableAt` includes the exposure reset and burial
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
session. An ignored review is not saved. Its exposure remains durable, so a
sensitive repetition still waits until the next study day.

## Navigating away

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
separately before display, so sensitive repetitions still wait until the next
study day even if their grade was never saved.
