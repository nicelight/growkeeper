-- Google identities never match or merge accounts by email.
CREATE TABLE google_identities (
 subject TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL
);
CREATE TABLE google_auth_transactions (
 state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, nonce TEXT NOT NULL,
 verifier TEXT NOT NULL, return_to TEXT NOT NULL,
 link_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
 link_session_id TEXT REFERENCES auth_sessions(id) ON DELETE CASCADE,
 expires_at TEXT NOT NULL,
 CHECK((link_user_id IS NULL) = (link_session_id IS NULL))
);
CREATE INDEX google_auth_expiry ON google_auth_transactions(expires_at);
