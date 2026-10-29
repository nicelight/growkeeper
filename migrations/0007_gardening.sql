-- Preserve source history; version only derived memory and explicit collection links.
CREATE TABLE collection_pairs (
 user_id TEXT NOT NULL, zone_id TEXT PRIMARY KEY, group_id TEXT NOT NULL UNIQUE,
 FOREIGN KEY(zone_id,user_id) REFERENCES zones(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(group_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE TABLE collection_create_requests (
 zone_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, request_payload TEXT NOT NULL,
 FOREIGN KEY(zone_id,user_id) REFERENCES zones(id,user_id) ON DELETE CASCADE
);
CREATE TABLE gardening_revisions (
 user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL DEFAULT 0
);
INSERT INTO gardening_revisions(user_id) SELECT id FROM users;
CREATE TRIGGER gardening_user AFTER INSERT ON users BEGIN
 INSERT INTO gardening_revisions(user_id) VALUES(NEW.id);
END;
CREATE TABLE gardening_plans (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN('card','structure')), plant_id TEXT,
 base_revision INTEGER NOT NULL, payload TEXT NOT NULL, request_payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PREPARED' CHECK(status IN('PREPARED','APPLIED')),
 created_at TEXT NOT NULL, applied_at TEXT,
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE TABLE card_memory_versions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, plant_id TEXT NOT NULL,
 content TEXT NOT NULL, source_revision INTEGER NOT NULL, created_at TEXT NOT NULL,
 restored_from TEXT, source_snapshot TEXT NOT NULL,
 original_source_revision INTEGER NOT NULL, committed_revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(id,plant_id,user_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE TABLE card_memory_heads (
 plant_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, memory_id TEXT NOT NULL,
 FOREIGN KEY(memory_id,plant_id,user_id) REFERENCES card_memory_versions(id,plant_id,user_id) ON DELETE CASCADE
);
CREATE TABLE gardening_assertions (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
CREATE TRIGGER gardening_plants_insert AFTER INSERT ON plants BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_plants_update AFTER UPDATE ON plants BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_plants_delete AFTER DELETE ON plants BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_zones_insert AFTER INSERT ON zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_zones_update AFTER UPDATE ON zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_zones_delete AFTER DELETE ON zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_plant_zones_insert AFTER INSERT ON plant_zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_plant_zones_update AFTER UPDATE ON plant_zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_plant_zones_delete AFTER DELETE ON plant_zones BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_collection_pairs_insert AFTER INSERT ON collection_pairs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_collection_pairs_update AFTER UPDATE ON collection_pairs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_collection_pairs_delete AFTER DELETE ON collection_pairs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_inputs_insert AFTER INSERT ON inputs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_inputs_update AFTER UPDATE ON inputs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_inputs_delete AFTER DELETE ON inputs BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_photos_insert AFTER INSERT ON photos BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_photos_update AFTER UPDATE ON photos BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_photos_delete AFTER DELETE ON photos BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_observations_insert AFTER INSERT ON observations BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_observations_update AFTER UPDATE ON observations BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_observations_delete AFTER DELETE ON observations BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_issues_insert AFTER INSERT ON issues BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_issues_update AFTER UPDATE ON issues BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_issues_delete AFTER DELETE ON issues BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_hypotheses_insert AFTER INSERT ON hypotheses BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_hypotheses_update AFTER UPDATE ON hypotheses BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_hypotheses_delete AFTER DELETE ON hypotheses BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_experiments_insert AFTER INSERT ON experiments BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_experiments_update AFTER UPDATE ON experiments BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_experiments_delete AFTER DELETE ON experiments BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_followups_insert AFTER INSERT ON followups BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_followups_update AFTER UPDATE ON followups BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_followups_delete AFTER DELETE ON followups BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_journal_entries_insert AFTER INSERT ON journal_entries BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_journal_entries_update AFTER UPDATE ON journal_entries BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_journal_entries_delete AFTER DELETE ON journal_entries BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER gardening_card_memory_heads_insert AFTER INSERT ON card_memory_heads BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_card_memory_heads_update AFTER UPDATE ON card_memory_heads BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id;
END;
CREATE TRIGGER gardening_card_memory_heads_delete AFTER DELETE ON card_memory_heads BEGIN
 UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id;
END;
CREATE TRIGGER collection_pair_kind BEFORE INSERT ON collection_pairs BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM plants WHERE id=NEW.group_id AND user_id=NEW.user_id AND kind='group' AND deleting=0) THEN RAISE(ABORT,'PAIR_CONFLICT') END;
END;
CREATE TRIGGER paired_group_location_insert BEFORE INSERT ON plant_zones BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM collection_pairs WHERE group_id=NEW.plant_id AND user_id=NEW.user_id AND zone_id!=NEW.zone_id) OR EXISTS(SELECT 1 FROM collection_pairs cp JOIN plants p ON p.id=NEW.plant_id AND p.user_id=NEW.user_id WHERE cp.zone_id=NEW.zone_id AND cp.user_id=NEW.user_id AND p.kind='group' AND cp.group_id!=NEW.plant_id) THEN RAISE(ABORT,'PAIR_CONFLICT') END;
END;
CREATE TRIGGER paired_group_location_update BEFORE UPDATE ON plant_zones BEGIN
 SELECT CASE WHEN EXISTS(SELECT 1 FROM collection_pairs WHERE group_id=NEW.plant_id AND user_id=NEW.user_id AND zone_id!=NEW.zone_id) OR EXISTS(SELECT 1 FROM collection_pairs cp JOIN plants p ON p.id=NEW.plant_id AND p.user_id=NEW.user_id WHERE cp.zone_id=NEW.zone_id AND cp.user_id=NEW.user_id AND p.kind='group' AND cp.group_id!=NEW.plant_id) THEN RAISE(ABORT,'PAIR_CONFLICT') END;
END;
