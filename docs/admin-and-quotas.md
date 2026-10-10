# Admin statistics and per-user AI quotas

Implemented 8 September 2026. `/admin` is restricted to the Google accounts configured in the server-only `ADMIN_EMAILS` environment variable. Both the server page and repository enforce authorization; a normal or signed-out visitor receives a not-found response. The header link is only a convenience. Search is parameterized and results are paginated (25 accounts per page), including accounts without activity. Data is rendered on the server without a public statistics endpoint or shared cache.

## Deployment

Set `ADMIN_EMAILS` to a comma-separated list of authorized email addresses, for example `admin-one@example.com,admin-two@example.com`. Whitespace and letter casing are normalized. If the variable is missing or empty, admin access fails closed. Keep this value in the deployment environment and `.env.local` for local development; environment files are ignored by Git.

Apply `migrations/0002_admin_usage.sql` to the target PostgreSQL database **before deploying this application version**. It only adds `ai_usage` and its index. Do not rerun earlier migrations or use a destructive schema reset. The SQL file is provided for the existing SQL migration workflow; migration metadata is not tracked in this repository. This change does not apply the migration to a remote database automatically.

Translation and analysis endpoints create a pending usage record before contacting OpenAI. If that insert fails (including an unapplied migration), they fail without making a paid call. If final persistence fails, the original pending record remains for investigation and the response ID/token counts are logged. User results are preserved. Roll back the application if necessary; the additive table can remain. Requested enrichment adds a separate reservation flow described below.

## What the numbers mean

- Accounts: all current `app_user` records, created on successful Google sign-in. Existing creation and last-login dates are reused.
- Saved translations: history rows, one submitted word/phrase per row, including repeats. Unique entries normalize case and outer whitespace and distinguish source/target language pairs. Saving history can fail independently of an AI call, so this is not a billing counter.
- Anki: current sets, stored card entries, enabled entries, and sets exported at least once. These are not lifetime deletions, export counts, or the number of study cards generated inside Anki.
- Usage: each authenticated translation, analysis or enrichment request has its own row. Includes operation, actual returned model where available, timestamps, status, response ID, selected/submitted word count, input tokens, cached input tokens, output tokens and reasoning tokens. New paid attempts count again; enrichment recovery with the same request key does not. Analysis counts selected words, not surrounding context; token usage includes the context and system prompt. Enrichment's `reserved_tokens` is a conservative spending-control value, separate from actual provider usage.
- Cached input is a subset of input; reasoning is a subset of output. Do not add either subset a second time.
- Missing token counts are NULL, not zero. Stream interruptions, timeouts, and process termination can lose the final provider usage. Pending means in progress or unresolved; failures can still be billable. The page shows incomplete coverage explicitly.
- Historical per-user tokens and analysis requests cannot be recovered from existing history. No fabricated token backfill or dollar total is shown. Tracking starts with new requests after deployment.

## Options and recommendation

| Approach                                      | Useful for                                                                        | Limitations                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Application request/word ledger (implemented) | Clear user-facing monthly allowance and immediate attribution with one shared key | A phrase and a long passage have different costs; attempts and successful results must be distinguished                                     |
| Per-response token ledger (implemented)       | Accurate known usage by app user, operation and model; future cost estimates      | Interrupted responses may not report usage; tokens are not dollars                                                                          |
| OpenAI organization Usage/Costs APIs          | Reconcile overall key/project activity and billed costs                           | Aggregated provider data is not an automatic mapping to this app's database users; it cannot reconstruct an attribution the app never saved |
| Separate project/key per customer             | Provider-side isolation for large customer organizations                          | Extra provisioning and secret management; unnecessary for individual learners                                                               |

**Recommendation:** keep the shared key and use the app ledger as the per-user source of truth. Offer a monthly word/phrase translation allowance, plus a separate analysis allowance or explicitly weighted credits. Set a maximum input length to bound the cost of a phrase, a short-window request limit for bursts, and an internal token/cost ceiling. Translation/analysis quota enforcement remains future work; enrichment now has separate caps.

For translation/analysis hard limits, add a `(user_id, UTC billing month)` balance and atomically reserve units with a conditional PostgreSQL update before starting OpenAI. Do not use a read-count-then-insert check: concurrent requests could exceed the allowance. Record a server-issued request/idempotency key, consume or release reservations according to a documented failure policy, and reconcile abandoned pending records. Refunding a failed user operation should not erase provider token spend. Prevent retries from charging the same logical request twice, while recording any additional paid provider attempts. All three generation flows disable automatic SDK retries so one app attempt is not silently several provider attempts.

## Requested enrichment limits

Apply `0009_anki_text_import.sql` and `0010_requested_enrichment.sql` before deploying import/enrichment. The latter adds `ai_usage.reserved_tokens` and `enrichment_request`; no remote migration is automatic. Importing itself creates no AI usage or translation history.

Before a paid enrichment call, one atomic transaction locks the user's account row, checks the owned item's content revision, enforces one pending request per item, and inserts the request plus usage reservation. Concurrent requests share a 100,000 reserved-token daily allowance (UTC), 20 requests/hour and 5/minute. `ENRICHMENT_DAILY_TOKEN_LIMIT` changes the daily limit; zero disables new generation. Invalid configuration falls back to the default. Existing translation and analysis usage is not charged against this separate enrichment ceiling.

The reservation covers UTF-8 prompt bytes, the 2,000-token output limit and framing overhead. It is deliberately conservative and is not a reported token count or currency amount. Actual provider usage is recorded separately. Failed/unknown calls keep their reservation for the day because they may be billable. Pending requests older than ten minutes become failed when recovered/reserved; their usage still remains attributable. There is no automatic paid retry or refund.

The browser supplies an idempotency key retained through recovery. Repeating/checking a request returns its stored status/proposal without another paid call; changed field selection/content under the same key is rejected. After a failed or declined result, a new paid request requires an explicit user action. Proposals are saved only after review, only into selected missing fields, using an atomic content-revision comparison. `OPENAI_ENRICHMENT_MODEL` overrides `OPENAI_TRANSLATION_MODEL`, otherwise `gpt-5-mini` is used.

For estimated USD, add a versioned price table keyed by model and effective date, then calculate `(input - cached input) × input rate + cached input × cached rate + output × output rate`, with rates per token. Store the price version, retain precision (for example microdollars), and clearly label the result an estimate. Reconcile with provider Costs data for billing; do not hard-code a current price for historical model usage. Unknown calls require explicit reconciliation rather than treating them as free.

## Official research

- [Chat completion usage and streaming](https://developers.openai.com/api/reference/resources/chat): final streamed usage is requested with `include_usage`; interrupted streams may not deliver it. This is why missing usage is shown as unknown.
- [Organization completions usage](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage/methods/completions): time-bucketed usage can be grouped by project, API key, model, and provider user. The application recommendation above does not assume that a Gooseberry user UUID maps to that provider user dimension.
- [Organization usage and costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage): use aggregated cost reporting for reconciliation.
- [Rate limits](https://developers.openai.com/api/docs/guides/rate-limits): OpenAI rate limits operate at organization/project level; the guide recommends application limits for individual users. Rate limiting controls request velocity, while a monthly allowance controls cumulative use.

## Manual verification

1. Apply the migration on the test database and start the app. Sign in with each admin email: the Admin link appears and `/admin` loads.
2. Sign in with a normal account, then sign out: in both states direct navigation to `/admin`, including a URL with search parameters, shows no user statistics. Check again after signing out of an admin session and refreshing/back navigation.
3. Search by partial name/email and full user ID. Verify a nonexistent value yields an empty state, Clear resets search, and pagination works when there are over 25 matching users.
4. With a test user, translate a word twice and run one analysis. Refresh admin: saved translations increase by two, unique entries by one if new, tracked translation requests by two, analyses by one, and known tokens rise.
5. Add a set with two entries, disable one, and export it: expect one set, two entries, one enabled, one set exported. Delete the set and verify current Anki counts decrease without reducing AI usage.
6. Interrupt a translation: it must not appear as a successful saved translation if validation never completed. Its usage record may show failure/pending and unknown tokens; it must not fabricate zero cost.
7. Check the table on a narrow screen: horizontal scrolling preserves readable columns, and usage details expand with keyboard or touch.
