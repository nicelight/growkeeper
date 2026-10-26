PRAGMA foreign_keys = ON;

-- Account keys have >=256 bits of entropy; only SHA-256 digests are persisted.
CREATE TABLE users (
 id TEXT PRIMARY KEY, display_name TEXT NOT NULL, login_key_hash TEXT NOT NULL UNIQUE,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)), created_at TEXT NOT NULL
);
CREATE TABLE user_settings (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 recognition_threshold REAL NOT NULL DEFAULT .90 CHECK(recognition_threshold BETWEEN .80 AND 1),
 timezone TEXT NOT NULL DEFAULT 'Asia/Dushanbe', updated_at TEXT NOT NULL
);
CREATE TABLE auth_sessions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN('browser','oauth')), token_hash TEXT NOT NULL UNIQUE,
 refresh_hash TEXT UNIQUE, client_id TEXT, resource TEXT NOT NULL, scope TEXT NOT NULL,
 expires_at TEXT NOT NULL, refresh_expires_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE oauth_codes (
 hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 client_id TEXT NOT NULL, redirect_uri TEXT NOT NULL, challenge TEXT NOT NULL,
 resource TEXT NOT NULL, scope TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE plants (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(display_name) BETWEEN 1 AND 100),
 name_source TEXT NOT NULL CHECK(name_source IN('generated','user')), name_confirmed INTEGER NOT NULL DEFAULT 0,
 kind TEXT NOT NULL DEFAULT 'plant' CHECK(kind IN('plant','bed','group')),
 profile TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 1,
 deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN(0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,user_id), UNIQUE(user_id,display_name)
);
-- Pending text must survive a new chat too. A row represents ONE subject, not an arbitrary batch of plants.
CREATE TABLE inputs (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 plant_id TEXT, text TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','RESOLVED','PROCESSED')),
 resolution_method TEXT, recognition_score REAL, resolution_note TEXT, created_at TEXT NOT NULL, resolved_at TEXT,
 UNIQUE(id,user_id), UNIQUE(id,plant_id,user_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE TABLE photos (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 input_id TEXT NOT NULL, plant_id TEXT, r2_key TEXT NOT NULL UNIQUE, source_file_id TEXT,
 mime_type TEXT NOT NULL, bytes INTEGER NOT NULL, sha256 TEXT NOT NULL,
 received_at TEXT NOT NULL, captured_at TEXT, captured_at_source TEXT NOT NULL DEFAULT 'unknown' CHECK(captured_at_source IN('unknown','user')),
 view_tag TEXT NOT NULL DEFAULT 'OTHER' CHECK(view_tag IN('WHOLE_PLANT','CANOPY','LEAF_CLOSEUP','ROOT_ZONE','OTHER')),
 area_tag TEXT NOT NULL DEFAULT 'unknown' CHECK(area_tag IN('upper','lower','whole','unknown')),
 description TEXT NOT NULL DEFAULT '', is_reference INTEGER NOT NULL DEFAULT 0 CHECK(is_reference IN(0,1)),
 UNIQUE(id,user_id), UNIQUE(user_id,source_file_id), UNIQUE(input_id),
 FOREIGN KEY(input_id,user_id) REFERENCES inputs(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE INDEX photo_history ON photos(user_id,plant_id,view_tag,captured_at,received_at);
CREATE TABLE issues (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
 plant_id TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'OPEN' CHECK(status IN('OPEN','RESOLVED','CLOSED_NO_RESULT')),
 opened_at TEXT NOT NULL, closed_at TEXT, result_observed_at TEXT,
 outcome TEXT CHECK(outcome IN('RESOLVED','NO_IMPROVEMENT','UNKNOWN')), closure_reason TEXT,
 closure_summary TEXT, closure_key TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,plant_id,user_id), UNIQUE(id,user_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 CHECK((status='OPEN' AND closed_at IS NULL) OR (status<>'OPEN' AND closed_at IS NOT NULL))
);
CREATE INDEX issue_plant ON issues(user_id,plant_id,status);
CREATE TABLE observations (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL,
 plant_id TEXT NOT NULL, issue_id TEXT, input_id TEXT,
 source TEXT NOT NULL CHECK(source IN('user','photo','comparison')), text TEXT NOT NULL,
 photo_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(photo_ids_json)),
 caveats TEXT NOT NULL DEFAULT '', observed_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(id,user_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(issue_id,plant_id,user_id) REFERENCES issues(id,plant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(input_id,plant_id,user_id) REFERENCES inputs(id,plant_id,user_id) ON DELETE CASCADE
);
CREATE TABLE hypotheses (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, plant_id TEXT NOT NULL,
 issue_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN('ACTIVE','SUPPORTED','REJECTED','INCONCLUSIVE')),
 reasoning TEXT NOT NULL, conclusion TEXT, observation_ids_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(observation_ids_json)),
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,issue_id,plant_id,user_id), UNIQUE(id,user_id),
 FOREIGN KEY(issue_id,plant_id,user_id) REFERENCES issues(id,plant_id,user_id) ON DELETE CASCADE
);
CREATE TABLE experiments (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, plant_id TEXT NOT NULL,
 issue_id TEXT NOT NULL, hypothesis_id TEXT,
 title TEXT NOT NULL, change_text TEXT NOT NULL, success_criteria TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PLANNED' CHECK(status IN('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
 started_at TEXT, evaluate_at TEXT NOT NULL, result TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,issue_id,plant_id,user_id), UNIQUE(id,user_id),
 FOREIGN KEY(issue_id,plant_id,user_id) REFERENCES issues(id,plant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(hypothesis_id,issue_id,plant_id,user_id) REFERENCES hypotheses(id,issue_id,plant_id,user_id),
 CHECK(status NOT IN('ACTIVE','COMPLETED') OR started_at IS NOT NULL),
 CHECK(started_at IS NULL OR evaluate_at>started_at)
);
CREATE UNIQUE INDEX one_active_experiment ON experiments(user_id,plant_id) WHERE status='ACTIVE';
CREATE TABLE followups (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, plant_id TEXT NOT NULL,
 issue_id TEXT, experiment_id TEXT, type TEXT NOT NULL CHECK(type IN('ASK_STATUS','REQUEST_PHOTO','EVALUATE_EXPERIMENT','RECHECK_ISSUE')),
 context TEXT NOT NULL, due_at TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN('PENDING','NOTIFIED','DONE','CANCELLED')),
 notified_at TEXT, lease_token TEXT, lease_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at TEXT, last_error TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(id,user_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(issue_id,plant_id,user_id) REFERENCES issues(id,plant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(experiment_id,issue_id,plant_id,user_id) REFERENCES experiments(id,issue_id,plant_id,user_id) ON DELETE CASCADE,
 CHECK(experiment_id IS NULL OR issue_id IS NOT NULL)
);
CREATE INDEX due_followups ON followups(user_id,status,due_at,next_attempt_at);
CREATE TABLE journal_entries (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, user_id TEXT NOT NULL, plant_id TEXT NOT NULL,
 entry_type TEXT NOT NULL CHECK(entry_type IN('ISSUE_OUTCOME','MILESTONE','NOTE')),
 issue_id TEXT, title TEXT NOT NULL, summary TEXT NOT NULL,
 outcome TEXT, duration_days REAL, time_to_result_days REAL,
 occurred_at TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(id,user_id), UNIQUE(issue_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(issue_id,plant_id,user_id) REFERENCES issues(id,plant_id,user_id) ON DELETE CASCADE,
 CHECK((entry_type='ISSUE_OUTCOME' AND issue_id IS NOT NULL) OR (entry_type<>'ISSUE_OUTCOME' AND issue_id IS NULL))
);
CREATE INDEX journal_plant ON journal_entries(user_id,plant_id,occurred_at);
-- Optional native MCP Events. One monitor per user; encrypted callback secret, no KV.
CREATE TABLE subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 callback_url TEXT NOT NULL, secret_cipher TEXT NOT NULL, previous_secret_cipher TEXT, previous_secret_until TEXT, expires_at TEXT NOT NULL,
 verified_at TEXT NOT NULL, last_error TEXT, created_at TEXT NOT NULL
);

CREATE TRIGGER hypotheses_open_parent BEFORE INSERT ON hypotheses
WHEN NEW.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.issue_id AND user_id=NEW.user_id AND status='OPEN')
BEGIN SELECT RAISE(ABORT,'ISSUE_CLOSED'); END;

CREATE TRIGGER experiments_open_parent BEFORE INSERT ON experiments
WHEN NEW.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.issue_id AND user_id=NEW.user_id AND status='OPEN')
BEGIN SELECT RAISE(ABORT,'ISSUE_CLOSED'); END;

CREATE TRIGGER observations_open_parent BEFORE INSERT ON observations
WHEN NEW.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.issue_id AND user_id=NEW.user_id AND status='OPEN')
BEGIN SELECT RAISE(ABORT,'ISSUE_CLOSED'); END;

CREATE TRIGGER followups_open_parent BEFORE INSERT ON followups
WHEN NEW.issue_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM issues WHERE id=NEW.issue_id AND user_id=NEW.user_id AND status='OPEN')
BEGIN SELECT RAISE(ABORT,'ISSUE_CLOSED'); END;

CREATE TRIGGER hypotheses_touch_insert AFTER INSERT ON hypotheses
WHEN NEW.issue_id IS NOT NULL
BEGIN UPDATE issues SET version=version+1, updated_at=NEW.updated_at WHERE id=NEW.issue_id AND status='OPEN'; END;

CREATE TRIGGER hypotheses_touch_update AFTER UPDATE ON hypotheses
WHEN NEW.issue_id IS NOT NULL
BEGIN UPDATE issues SET version=version+1, updated_at=NEW.updated_at WHERE id=NEW.issue_id AND status='OPEN'; END;

CREATE TRIGGER experiments_touch_insert AFTER INSERT ON experiments
WHEN NEW.issue_id IS NOT NULL
BEGIN UPDATE issues SET version=version+1, updated_at=NEW.updated_at WHERE id=NEW.issue_id AND status='OPEN'; END;

CREATE TRIGGER experiments_touch_update AFTER UPDATE ON experiments
WHEN NEW.issue_id IS NOT NULL
BEGIN UPDATE issues SET version=version+1, updated_at=NEW.updated_at WHERE id=NEW.issue_id AND status='OPEN'; END;

CREATE TRIGGER observations_touch_insert AFTER INSERT ON observations
WHEN NEW.issue_id IS NOT NULL
BEGIN UPDATE issues SET version=version+1, updated_at=NEW.created_at WHERE id=NEW.issue_id AND status='OPEN'; END;

CREATE TRIGGER inputs_live_plant_insert BEFORE INSERT ON inputs
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER inputs_live_plant_update BEFORE UPDATE ON inputs
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER photos_live_plant_insert BEFORE INSERT ON photos
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER photos_live_plant_update BEFORE UPDATE ON photos
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER issues_live_plant_insert BEFORE INSERT ON issues
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER issues_live_plant_update BEFORE UPDATE ON issues
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER observations_live_plant_insert BEFORE INSERT ON observations
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER observations_live_plant_update BEFORE UPDATE ON observations
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER hypotheses_live_plant_insert BEFORE INSERT ON hypotheses
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER hypotheses_live_plant_update BEFORE UPDATE ON hypotheses
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER experiments_live_plant_insert BEFORE INSERT ON experiments
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER experiments_live_plant_update BEFORE UPDATE ON experiments
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER followups_live_plant_insert BEFORE INSERT ON followups
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER followups_live_plant_update BEFORE UPDATE ON followups
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER journal_entries_live_plant_insert BEFORE INSERT ON journal_entries
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER journal_entries_live_plant_update BEFORE UPDATE ON journal_entries
WHEN NEW.plant_id IS NOT NULL AND EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND deleting=1)
BEGIN SELECT RAISE(ABORT,'PLANT_DELETING'); END;

CREATE TRIGGER observations_photo_scope BEFORE INSERT ON observations
WHEN EXISTS(SELECT 1 FROM json_each(NEW.photo_ids_json) j WHERE NOT EXISTS(SELECT 1 FROM photos p WHERE p.id=j.value AND p.user_id=NEW.user_id AND p.plant_id=NEW.plant_id))
BEGIN SELECT RAISE(ABORT,'WRONG_PHOTO_PLANT'); END;
CREATE TRIGGER photos_protect_assignment BEFORE UPDATE OF plant_id ON photos
WHEN OLD.plant_id IS NOT NEW.plant_id AND EXISTS(SELECT 1 FROM observations o,json_each(o.photo_ids_json) j WHERE j.value=OLD.id AND o.user_id=OLD.user_id)
BEGIN SELECT RAISE(ABORT,'DERIVED_DATA_EXISTS'); END;
