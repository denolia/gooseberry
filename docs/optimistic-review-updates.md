# Optimistic review updates

The browser reviewer lets the learner move to the next card without waiting
for the previous review to reach the database. This is an optimistic UI
update: the browser advances its in-memory session queue immediately, while
the server remains the source of truth for review history and FSRS state.

## Loading the session queue

The review API returns up to 20 due cards at a time. The browser keeps those
cards in memory and starts loading another batch when five cards remain.

Queue-refill requests exclude:

- cards already waiting in the browser queue;
- cards whose review requests are still pending;
- cards whose review requests exhausted their automatic retries; and
- failed cards the learner chose to ignore for the rest of this session.

These exclusions prevent a card from appearing twice while its database write
is still in flight.

## Answering a card

When the learner chooses a rating, the browser synchronously:

1. creates a review submission with a new UUID, the rating, the time of the
   choice, and the time spent on the card;
2. removes the answered card from the in-memory queue;
3. reveals the next prefetched card; and
4. starts the review API request in the background.

The browser does not calculate or persist a new FSRS projection itself. The
server validates the card, appends the canonical `review_event`, and updates
the materialized `fsrs_card_state` in one atomic database batch.

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
session. An ignored review is not saved, so the card can appear again in a
later session.

## Navigating away

Review POST requests use the Fetch API's `keepalive` option. This gives a
small in-flight request a better chance of completing when the learner leaves
the review page. It is not a delivery guarantee: closing the browser, losing
the network, or terminating the page can still prevent the write. JavaScript
retry timers also stop when the page is destroyed.

## Current limitation and possible next step

Pending and failed submissions currently live only in memory. Gooseberry does
not store an outbox in local storage, IndexedDB, or another persistent browser
store, and it does not resume unsent reviews the next time the browser opens.
Losing an occasional repetition is acceptable for the current release; the
card simply remains due on the server and can be reviewed again later.

A possible next step is a persistent browser outbox. Each submission could be
stored before the UI advances, removed after server confirmation, and replayed
after the same user opens Gooseberry again. The existing review UUID makes
that replay safe. Local storage could support a small, simple queue; IndexedDB
would be a better fit if the outbox grows or needs more robust transactional
handling. Any implementation should scope entries to the signed-in account
and discard them after logout or successful synchronization.
