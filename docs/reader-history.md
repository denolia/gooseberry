# Reader history

The Reader's **History** button opens a modal styled like the set picker. It
contains a search field, saved texts ordered newest first, a **New text** action,
and controls for opening or deleting an entry. Search matches both titles and
full text in the database, including entries beyond the current page. **Load
more** fetches the next 50 entries.

**Open text** saves a new text before opening it. A default title uses its first
five words, capped at 80 characters. The pencil next to the open text's title
allows a custom title of up to 200 characters; Enter saves it and Escape cancels.
Editing content updates the existing entry and preserves its title. Creating a
text through **History → New text** creates a separate entry. Deletion requires
confirmation. Unsaved changes require confirmation before switching entries or
starting a new text.

The complete text, title, source and target language, and timestamps are stored
in PostgreSQL and scoped to the signed-in account. Opening a saved entry restores
its language pair and resets selection, analysis and playback. Saved texts can
be reopened through History after a refresh or on another device.

Local storage only keeps an account's unsaved draft. The old locally cached
reader text is offered as an unsaved draft and enters history when **Open text**
succeeds. Older texts that were overwritten by the previous local cache cannot
be recovered. A draft's stable UUID prevents duplicate entries when a save is
retried after a lost response.

## Deployment

Apply `migrations/0015_reader_texts.sql` to the target PostgreSQL database using
the existing migration workflow before deploying the application. This creates
`reader_text`, its account/date index, and length and ownership constraints.
Apply it after `0014_interface_locale.sql` when migrating an older installation.
Reader history labels, controls and errors follow the selected English or Russian
interface language; saved titles and content retain the user's text.

Development, builds and tests do not change a remote schema. Automated database
tests apply migrations to an isolated PGlite database.

## Manual UI checklist

1. Sign in, open **Reader**, paste a text and click **Open text**. Expect a
   generated title, **Saved to history**, working word selection and the audio
   controls appropriate to the account's tier.
2. Click **History**. Expect the modal to focus its labelled search field and
   show the saved entry with language, date and preview. Search for a title and
   for words later in a long text. Expect matching entries from the entire
   library. Verify **Load more** with more than 50 entries.
3. Use **New text** and save another text. Reopen the first entry from History.
   Expect both entries to remain and the first entry's language pair to return.
   If playback was active, expect it to stop when the other entry opens.
4. Rename the open text with the pencil. Save a custom title, then edit the
   content and open it again. Expect the same history entry and custom title.
   Check Save, Cancel, Escape, and blank-title validation.
5. Refresh the page and reopen History. Expect all saved texts to remain. Check
   the same account in another browser/device and a different account: expect
   the first account's history only in its own sessions.
6. Make an unsaved content edit, then try **New text** or opening another entry.
   Cancel the warning and expect the edit to remain. Confirm and expect the
   chosen action to proceed. With a failed save, expect the draft and retry
   controls to remain, without an extra history entry after retrying.
7. Delete an entry through History. Expect confirmation first. Cancel once,
   then confirm: expect the entry to disappear. Deleting the open entry clears
   the reader while keeping History open.
8. Check a narrow mobile screen and both color themes. Expect usable search,
   scrolling, footer actions, long titles and title editing without horizontal
   overflow. With a keyboard, check Tab, arrow-key list selection, Enter to open,
   Escape to close, and focus returning to History.
