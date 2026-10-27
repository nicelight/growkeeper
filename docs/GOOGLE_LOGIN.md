# Google login and public pages

Google signs the user into GrowKeeper. GrowKeeper's existing OAuth authorization-code/PKCE server still grants ChatGPT access to the journal. These are separate flows.

## Configuration (not enabled just by deploying code)

1. Apply `migrations/0006_google_auth.sql` once. It adds identity and transient login tables without changing existing users or plants.
2. Create a Google OAuth Web application with a registered callback exactly `https://growkeeper.natureonzoom.win/auth/google/callback`. Use a separate OAuth client, Worker, D1 and R2 for staging. Never copy production user data into a test environment.
3. Set `GOOGLE_CLIENT_ID` and the secret `GOOGLE_CLIENT_SECRET` in Worker bindings. Secret creation/configuration requires owner approval; never commit credentials. Both bindings must exist before the Google entry point appears.
4. Before enabling Google, set Worker observability `redact_query_string: true` to exclude callback codes/state from invocation URLs. Keep application logs free of tokens, callback query strings, or upstream bodies.
5. Configure Google branding with product, privacy and terms URLs below. Configure test users while Google publishing is in testing mode. No Gmail/Drive scopes and no offline access. Requested scope is only `openid`; only Google `sub` is stored.

For local testing, supply these environment variables to `npm run dev` and register the local callback `http://127.0.0.1:8787/auth/google/callback` in a separate test client. Never use production keys in shared test scripts.

## Existing journal

While still signed in to the existing key-based journal, open `/login`. Explicitly link that journal to Google. The link is bound to the initiating browser session and is never inferred from email. An existing identity cannot be reassigned to another journal. Signing in to Google while signed out creates a new journal if the Google identity is unknown. Do not do that first if you intend to keep your old journal; use the explicit link flow.

Google-only users do not get a login key. Their legacy schema hash is random and no corresponding login credential is issued. Google access/refresh tokens are not retained. A disabled GrowKeeper user cannot sign in through Google.

## Public pages

- Product: `/about` (also `/` when signed out; authenticated `/` stays the journal)
- Support: `/support`
- Privacy: `/privacy`
- Terms: `/terms`

The minimal manifest schema supports `homepage`; other review URLs are supplied in the submission form, not invented manifest properties. Pages contain no tracking scripts or third-party assets.

## Retention / deletion operations

Product rule: keep journal/photos until the owner deletes them. Existing plant deletion removes associated R2 objects before deleting its database records. Full-account and unassigned-material deletion is currently a **manual verified support request**, not a self-service button.

Operator checklist for a requested full-account deletion:
- Verify ownership through the authenticated journal or another established verified channel. A Telegram display name or claimed Google email is not sufficient. Never request a login key in Telegram/chat.
- Obtain explicit confirmation for permanent deletion of this specific account and its photos/history. Do not act on an unsolicited or third-party request.
- Freeze account writes and revoke its sessions, OAuth codes, and notification subscriptions; identify all owned photo keys including unassigned photos.
- Remove R2 objects, check successful completion, then remove owned DB rows using the ownership FKs. Retain rows until R2 cleanup succeeds so failures are retryable. Do not delete the entire shared database/bucket.
- Check other accounts remain intact. Tell owner the active-store deletion outcome accurately. Cloudflare D1 recovery history may retain prior records for up to 30 days; do not promise instant destruction of backups.
- Feedback copies in the developer's Telegram and any exported reports require separate attention; no automatic cross-platform deletion is implemented. User controls their ChatGPT history in ChatGPT.

No account purge has been performed as part of this feature. Manual workflow is a beta limitation, not an automated compliance guarantee.

## Release checks

Offline tests cover state/cookie/nonce/PKCE validation, JWT signature/audience/issuer/time validation, denial/replay, unsafe return paths, explicit linking, conflicting identities, session changes/revocation, concurrent account creation and legacy MCP OAuth. Mocked Google success is **not** proof of live provider acceptance.

Still required before declaring Google login live: configured real client, successful new-user login, return login, existing-journal linking, cancellation/back/repeated-click browser flows, then ChatGPT connector authorization using that journal. Public signup needs edge abuse-rate limits; per-browser transaction replacement is not abuse protection.

References:
- https://developers.google.com/identity/openid-connect/openid-connect
- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/workers/observability/logs/workers-logs/
