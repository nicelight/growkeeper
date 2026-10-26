CREATE TABLE IF NOT EXISTS zones (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,user_id), UNIQUE(user_id,display_name)
);
CREATE TABLE IF NOT EXISTS plant_zones (
 plant_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, zone_id TEXT NOT NULL,
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(zone_id,user_id) REFERENCES zones(id,user_id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS collection_onboarding (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 stage TEXT NOT NULL DEFAULT 'new' CHECK(stage IN('new','help_answered','asked','answered','declined')),
 last_user_at TEXT, checkin_id TEXT, checkin_sent_at TEXT, updated_at TEXT NOT NULL
);
