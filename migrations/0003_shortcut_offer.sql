-- One-time Android shortcut suggestion; does not assert that a shortcut was installed.
ALTER TABLE monitoring_preferences ADD COLUMN shortcut_offered_at TEXT;
