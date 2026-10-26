CREATE TABLE IF NOT EXISTS feedback_reports (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN('review','wish','suggestion','bug')),
 summary TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN('pending','sent','failed','unknown')),
 telegram_message_id INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,user_id)
);
CREATE INDEX IF NOT EXISTS feedback_user_time ON feedback_reports(user_id,created_at);
