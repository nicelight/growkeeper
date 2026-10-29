-- Retire empty zone tables atomically; unexpected data blocks migration, never silently disappears.
CREATE TABLE zone_retirement_guard(valid INTEGER CHECK(valid=1));
INSERT INTO zone_retirement_guard SELECT CASE WHEN
 (SELECT count(*) FROM zones)+(SELECT count(*) FROM plant_zones)+(SELECT count(*) FROM collection_pairs)+(SELECT count(*) FROM collection_create_requests)=0 THEN 1 ELSE 0 END;
DROP TABLE collection_create_requests;
DROP TABLE collection_pairs;
DROP TABLE plant_zones;
DROP TABLE zones;
DROP TABLE zone_retirement_guard;
UPDATE plants SET kind='plant',version=version+1 WHERE kind='bed';
CREATE TABLE plant_groups (
 plant_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,group_id TEXT NOT NULL,
 CHECK(plant_id!=group_id),
 FOREIGN KEY(plant_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(group_id,user_id) REFERENCES plants(id,user_id) ON DELETE CASCADE
);
CREATE TRIGGER plant_group_insert BEFORE INSERT ON plant_groups BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND kind='plant' AND deleting=0) OR NOT EXISTS(SELECT 1 FROM plants WHERE id=NEW.group_id AND user_id=NEW.user_id AND kind='group' AND deleting=0) THEN RAISE(ABORT,'GROUP_INTEGRITY') END;
END;
CREATE TRIGGER plant_group_update BEFORE UPDATE ON plant_groups BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM plants WHERE id=NEW.plant_id AND user_id=NEW.user_id AND kind='plant' AND deleting=0) OR NOT EXISTS(SELECT 1 FROM plants WHERE id=NEW.group_id AND user_id=NEW.user_id AND kind='group' AND deleting=0) THEN RAISE(ABORT,'GROUP_INTEGRITY') END;
END;
CREATE TRIGGER card_kind_integrity BEFORE UPDATE OF kind ON plants BEGIN
 SELECT CASE WHEN NEW.kind NOT IN('plant','group') OR (NEW.kind='group' AND EXISTS(SELECT 1 FROM plant_groups WHERE plant_id=NEW.id)) OR (NEW.kind='plant' AND EXISTS(SELECT 1 FROM plant_groups WHERE group_id=NEW.id)) THEN RAISE(ABORT,'GROUP_INTEGRITY') END;
END;
CREATE TRIGGER card_kind_insert BEFORE INSERT ON plants WHEN NEW.kind NOT IN('plant','group') BEGIN SELECT RAISE(ABORT,'GROUP_INTEGRITY'); END;
CREATE TRIGGER group_revision_insert AFTER INSERT ON plant_groups BEGIN UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER group_revision_update AFTER UPDATE ON plant_groups BEGIN UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=NEW.user_id; END;
CREATE TRIGGER group_revision_delete AFTER DELETE ON plant_groups BEGIN UPDATE gardening_revisions SET revision=revision+1 WHERE user_id=OLD.user_id; END;
UPDATE gardening_revisions SET revision=revision+1;
