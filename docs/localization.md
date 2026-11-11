# Interface localization

The interface supports English (`en`) and Russian (`ru`). Change **Interface
language** in **Profile → Preferences**, then save settings. The new language
applies after a successful save, with a page reload when the language changes.
Study source/target languages and vocabulary content are independent of this
preference.

For a signed-out visitor, the server matches the browser's `Accept-Language`
preferences, including regional variants such as `ru-RU`, in priority order.
Unsupported languages fall back to English. For a signed-in user whose preference
is unset, the detected language is saved once in `user_preference.ui_locale`.
Subsequent requests use that saved value on every device. Conditional database
initialization prevents another first visit from overwriting a saved choice.
There is no device-local language preference or locale URL prefix.

The server reads the profile's saved locale directly before rendering and passes
the selected messages to the client through `next-intl`. The locale is not kept
in the authentication session. Request-scoped configuration is shared by
page content and metadata. Russian messages fall back to English per key.
Labels, descriptions, placeholders, tooltips, accessible labels, loading states,
errors, and import reports use the same catalogs. Application API errors include
stable `errorCode` values and optional `errorValues` interpolation data. The Anki
worker uses the same envelope. Errors and notices retain their keys until they
are rendered, so changing language never requires parsing existing English copy.
Unknown failures use a translated fallback; internal diagnostic text is not shown.

Profile account and request dates use the interface locale and UTC so server and
browser output agree during hydration. Other date/number formatting, review
interval formatting, document `lang`/`dir`, and font/direction handling retain
their existing behavior in this release.

## Deployment

Apply [`0014_interface_locale.sql`](../migrations/0014_interface_locale.sql) in
order after the existing migrations and **before deploying** the application.
The migration is additive and leaves existing preferences null so each user gets
a detected initial language. Development, tests, and builds do not apply this
migration to a remote database. No additional environment variables are needed.

## Editing translations

- Edit `messages/en.json` and `messages/ru.json` together. Keys are grouped by
  feature and checked by TypeScript.
- Use whole messages and ICU interpolation/plurals instead of joining translated
  fragments. Keep user content, stored language values, exercise keys, and Anki
  field/template identities independent of translated labels.
- Use `useI18n()` in client components and `getI18n()` in server components.
  `t(key, values)` renders a typed catalog key with its interpolation data.
  Shared labels expose `labelKey`; pending notices and errors use `{key, values}`.
- Throw `MessageError(key, values)` for user-facing failures. API routes and
  workers serialize these with `errorEnvelope()`, and clients decode them with
  `errorFromResponse()`. Use a specific fallback key for unexpected failures.
  Never use English copy as an identifier, parse it for interpolation values, or
  translate raw `Error.message` text. Translation files are edited directly;
  there is no generated lookup or generation command.
- Run `pnpm translations:check`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, and
  `pnpm build`. The catalog check validates key parity, nonempty messages,
  interpolation arguments, and ICU formatting.

Adding another interface locale also requires updating the locale allowlist,
request catalog loading, profile selector, database check constraint through a new
migration, and locale tests.

## Manual UI checks

1. With a fresh account, use a browser preferring Russian and sign in. Tabs,
   profile labels, and buttons should appear in Russian. Unsupported browser
   languages should use English. Existing accounts initialize on their next use.
2. Choose English in Profile. The interface should remain in its current language
   until **Save settings** succeeds, then switch. Reload, change browser language,
   and sign in on another device: the saved English choice should win. Repeat
   with Russian. Other profile preferences should retain their values.
3. Visit Translation, Reader, Study Sets, a review session, import/export dialogs,
   and Administration if available. Check labels, tooltips, loading/error states,
   and Russian counts for 1, 2, 5, and 21. Entered vocabulary and set names should
   retain their contents. Check keyboard access and mobile text wrapping.
4. Simulate a failed settings request. An error should appear in the active
   interface language, and the active language should remain unchanged.
