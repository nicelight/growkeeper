-- Additive, idempotent migration: records offers/refusals, never grants subscription consent.
CREATE TABLE IF NOT EXISTS monitoring_preferences (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 declined INTEGER NOT NULL DEFAULT 0 CHECK(declined IN(0,1)),
 last_offered_at TEXT,
 updated_at TEXT NOT NULL
);
