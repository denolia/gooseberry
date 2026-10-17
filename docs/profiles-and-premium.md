# Profiles and manually granted Premium access

Implemented 13 September 2026. Signed-in users can open `/profile` to view
their Google account information, save default languages, see their Free or
Premium tier, and request Premium access with an optional message. Google name,
email, and avatar data remain read-only.

Premium requests are stored before an email notification is attempted. A mail
failure therefore cannot lose the request: it remains visible in the protected
`/admin` queue. Only one pending request is allowed per user. Admin approval
atomically resolves the request and changes the account tier.

The admin user table also provides explicit Grant Premium and Revoke Premium
controls. A direct grant records the administrator and grant time and resolves
any pending request for that user. Revocation clears the active grant metadata
but preserves resolved request history for auditing.

## Deployment

Apply `migrations/0003_profiles_and_premium.sql` to the target PostgreSQL
database before deploying this application version. The migration is additive:
it adds account-tier columns, language preferences, the request queue, and the
generated-speech cache.

Configure these server-only environment variables:

- `ADMIN_EMAILS`: comma-separated Google accounts allowed to use `/admin`.
- `RESEND_API_KEY`: API key used to send request notifications.
- `PREMIUM_REQUEST_EMAIL_FROM`: verified sender, for example
  `Learn.words <premium@example.com>`.
- `PREMIUM_REQUEST_EMAIL_TO`: one address or a comma-separated list of
  recipients.
- `APP_URL`: public application origin used for the `/admin` link in email,
  for example `https://learn.example.com`.

If any email variable is absent, requests still work and a server warning is
logged. No email is sent to the requesting user in this version.

## Premium enforcement

Audio-enabled Anki deck export is a Premium capability. Its checkbox is
chosen for each export rather than stored as a preference. Free users retain
CSV, text-only APKG, and individual pronunciation playback.

The export endpoint checks the current database entitlement before generating
audio, so changing a browser request cannot bypass the tier. Administration is
a separate role and does not grant Premium access: an admin whose stored tier is
Free sees Free and has the same feature restrictions as any other Free account.
An audio export supports up to 50 included cards and reuses MP3 data from
`speech_audio_cache`; the cache prevents repeat exports of the same source text
and language from repeatedly consuming speech-generation credits.

Full-text reading in the text analyzer is also Premium-only. The player sits
above the reader on desktop and mobile, with voice settings always visible,
reads in the selected source language, and supports pause, resume, and
five reading speeds on a slider (0.3, 0.5, 0.7, 1, and 1.5 times normal speed).
Every speed generates audio sentence by sentence and highlights the current
sentence in blue when playback actually starts. Pausing keeps that sentence
marked; completion, errors, and the wait for another sentence clear it.
Normal with pauses also adds a short pause between sentences. Oversized
sentences are split within the per-request limit while retaining one sentence
highlight. One following sentence is prepared during playback to reduce gaps;
pausing cancels pending preparation. Voice settings are saved in
this browser; audio stays in memory for replay and is discarded
when the text, source language, voice, or speed changes.

During a playback session, Pause/Resume floats at the bottom of the screen once
the original control has scrolled above it. Reading follows the highlighted
sentence when it approaches a screen edge, leaving room for the next lines and
the floating control. Manual scrolling takes priority and
following resumes after roughly 2.5 seconds of inactivity. Paused playback,
text editing, and an open translation popover suspend automatic scrolling.

`/api/speech/reader` checks the current database entitlement for every audio
chunk, including short ones. Texts up to the analyzer's 20,000-character limit
are split into chunks of at most 1,000 characters. `/api/speech` remains the
authenticated individual-pronunciation endpoint. The reader uses
`OPENAI_TTS_MODEL` and offers only that model's supported built-in voices;
`OPENAI_TTS_VOICE` is the default when supported. Voice-style groups describe
perceived tone, since OpenAI publishes voice names without assigning genders.

## Manual verification

1. Sign in as a normal account. Open Profile from the account menu and verify
   that Google identity data and the Free badge appear.
2. Change both default languages, save, then reload. The saved pair should be
   selected. Sign in on another device and confirm the same defaults load.
3. Submit a Premium request with a message. The profile should immediately show
   a pending state, a second request should be prevented, and the configured
   recipient should receive one email with an `/admin` link.
4. Temporarily misconfigure the email API key and submit with another account.
   The UI should still show a pending request and `/admin` should contain it.
5. Sign in as an admin. Verify the request queue shows the user, message, and
   date. Decline one test request and approve another; both should disappear
   from the pending queue and only the approved account should become Premium.
6. As a Free user, open an Anki set's export dialog. Audio should be disabled
   with a Profile link, while CSV and text-only APKG downloads still work.
7. As a Premium user, include audio in an APKG export and import it into Anki.
   The source pronunciation should play from the packaged media. Export the
   same set again and verify the server does not make another speech request
   for cached entries.
