# Admin statistics and AI usage

## Access and deployment

`/admin` is restricted to Google accounts listed in the server-only `ADMIN_EMAILS` environment variable. The page and repository both check authorization. Signed-out, ordinary, non-Google or changed database accounts receive not-found responses. Missing/empty configuration denies access. Email casing and whitespace are normalized.

Search matches name, email or user UUID with parameterized queries. Results are paginated at 25 accounts, including accounts without activity, and rendered without a public statistics endpoint or shared cache. Premium access is an independently stored account tier.

AI usage requires migration `0002_admin_usage.sql`. Import/enrichment additionally requires migrations `0009_anki_text_import.sql` and `0010_requested_enrichment.sql`, after the preceding migrations. These are additive; application commands do not apply remote migrations automatically.

## Statistics

- **Accounts:** existing sign-in creation and last-login timestamps.
- **Saved translations:** history rows, including repeats. Unique entries normalize case/outer whitespace and distinguish the language pair. History is not a billing counter.
- **Vocabulary:** current sets, saved notes and sets exported at least once. These are current library counts, not lifetime totals or exercise-card counts.
- **AI requests:** translation, analysis and enrichment attempts, status, model, timestamps, response ID, input-word count and provider token usage. Enrichment recovery with the same request key does not create another paid attempt.
- **Tokens:** input/output are totals. Cached input and reasoning output are subsets and are not added again. Missing usage is unknown, not zero; failed or unresolved requests can be billable. Historical usage before tracking is not reconstructed.

Translation/analysis create a pending usage row before contacting the provider; failure to create it prevents a paid call. Usage finalization preserves returned model, response ID and token counts. A final write failure leaves the pending row for reconciliation. Imports themselves create no AI usage or translation history.

Translation/analysis have no per-user quota enforcement. No dollar totals or currency estimates are reported.

## Requested enrichment

An explicit missing-content request atomically locks the user's account row, checks item ownership/revision, reserves usage and creates its request record. Only one pending generation per item is allowed. Concurrent requests share these limits:

| Limit           | Value                            |
| --------------- | -------------------------------- |
| Per minute      | 5 requests                       |
| Per hour        | 20 requests                      |
| Per UTC day     | 100,000 reserved tokens per user |
| Provider output | 2,000 tokens per request         |

`ENRICHMENT_DAILY_TOKEN_LIMIT` changes the daily ceiling; zero disables new generation and invalid values fall back to the default. Translation/analysis usage is separate from this ceiling. `OPENAI_ENRICHMENT_MODEL` overrides `OPENAI_TRANSLATION_MODEL`, otherwise `gpt-5-mini` is used. All generation flows disable automatic SDK retries.

The reservation covers UTF-8 prompt bytes, output and framing overhead. It is deliberately conservative and remains separate from actual provider usage. Failed/unknown calls retain their reservation for the day because provider spend can already have occurred.

Request keys make generation recoverable without a second paid call. Reusing a key with different fields/content is rejected. Pending requests older than ten minutes become failed when recovered or during later reservation cleanup. A new paid attempt requires explicit user action; there is no automatic retry or refund.

Proposals are stored before returning and saved only after learner review. Saving fills requested missing fields under an atomic revision check. Existing author content and edits remain intact. Enrichment records field provenance and AI usage without adding translation history.
