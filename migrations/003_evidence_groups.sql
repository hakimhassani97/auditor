CREATE TABLE evidence_groups (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
 group_type TEXT NOT NULL DEFAULT 'equipment',
 created_at TEXT NOT NULL
);
ALTER TABLE evidence ADD COLUMN group_id TEXT REFERENCES evidence_groups(id) ON DELETE SET NULL;
CREATE INDEX evidence_groups_project_idx ON evidence_groups(project_id);
CREATE INDEX evidence_group_members_idx ON evidence(project_id,group_id);
