# Undo during study

Every rating and New-card Ok in the current open study session can be undone,
one at a time, newest first. There is no fixed step limit. Undo is available in
the exercise toolbar and on the completion screen. Ctrl/Cmd+Z invokes it outside
editable fields; input fields retain their native text undo.

Undo returns the exercise with its answer revealed and the submitted text
restored. An interrupted exercise keeps its draft and presentation permission.
Resumed exercises retain their order ahead of ordinary queue refills. If an
undone introduction removes a sibling's prerequisites, that sibling is fetched
again once the prerequisite is saved; its draft remains in memory. Repeated
occurrences of one exercise are merged into its restored scheduling state.

History is local to the mounted reviewer and spans all sets in its study scope,
including the completion screen and the 2 am boundary. Ending the session,
navigating away, reloading, or changing scope/filter clears it. Answer reveal,
typing and audio are not separate study undo steps. Correcting an undone answer
creates a new review UUID and a new history entry.

## Persistence and concurrency

Apply migration `0017_study_undo.sql` before deploying. No historical backfill
is needed. The `study_review_undo` table retains cancellation records keyed by
the original review UUID, with the session and original/replacement presentation
UUIDs. These records have an account foreign key but no content foreign keys.
They must survive content deletion, just like reversed activity receipts.

Undo validates ownership and the exact original submission. It locks the note,
records the cancellation, replaces its FSRS projection from remaining native
history and any imported baseline, and issues a replacement presentation in an
atomic Neon HTTP batch. Projection revisions remain monotonic. A later active
review of that note must be undone first; incompatible concurrent changes return
a conflict without partially reversing progress.

Grade writes take the same note lock and check cancellation and introduction
prerequisites again inside their batch. Undo can arrive before either the display
or grade POST. Late saves, duplicate requests, and a new review UUID using the
cancelled presentation cannot restore the original answer. Retried undo requests
return the same replacement receipt without reversing anything again.

Review and activity receipts are retained. Scheduling replay, introduction
prerequisites, daily allowance, activity totals, leaves and streaks exclude
cancelled reviews. Rebuilding a missing or outdated projection cannot resurrect
them. Undo removes credit from the original credited day; a corrected answer
earns credit on its own server acceptance day. Deleting content does not revoke
other, valid completion receipts.

Actual word exposure remains recorded. The replacement presentation permits the
specific corrected answer without reopening the daily exposure gate generally.
The local queue discards responses started before undo and removes stale siblings.

Grading remains immediate during normal study. Undo operations wait for server
confirmation and temporarily disable grading. If all retries fail, Retry undo
reuses the same operation while grading stays disabled, because the reversal
may already have committed. Activity reads reconcile after pending writes settle;
an unavailable undo response does not leave the activity tracker permanently
waiting. A definitive conflict leaves the original history entry available and
shows an error.

## Manual UI checklist

1. Answer several exercises across different sets, including a typed answer.
   Start typing on the next exercise, then Undo. The previous answer returns
   revealed with its original text. Correct it and verify the interrupted draft
   is restored.
2. Answer more than twenty exercises. Undo repeatedly from the completion screen
   back to the first answer. Undo becomes disabled when no answers remain.
3. Review one Learning exercise twice in the same session. Undo both answers.
   Its schedule returns through each previous state without duplicate queued
   copies of that exercise.
4. Use Ctrl/Cmd+Z outside an input to undo a grade. Use it inside a typed-answer
   input and verify only text editing is undone.
5. Undo the completion that earned a leaf. The leaf count and partial progress
   reconcile with the remaining answers. Undoing the day's only completion also
   removes that day's streak credit.
6. Use a slow connection, grade and immediately Undo. A late save must not
   advance the restored exercise or add its credit again. If undo cannot be
   confirmed, Retry undo must recover without duplicate credit.
7. Introduce recognition and then production. Undo production and recognition.
   Later exercise types remain unavailable until their prerequisites are saved.
8. Reload or leave and start a new study session. The earlier session's answers
   remain saved, and its undo history is unavailable.
