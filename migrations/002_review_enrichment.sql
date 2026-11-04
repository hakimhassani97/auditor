ALTER TABLE jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
CREATE TABLE plan_detections (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
 page_number INTEGER NOT NULL DEFAULT 1,
 label TEXT NOT NULL,
 x REAL NOT NULL CHECK(x >= 0 AND x <= 1),
 y REAL NOT NULL CHECK(y >= 0 AND y <= 1),
 width REAL NOT NULL CHECK(width > 0 AND width <= 1),
 height REAL NOT NULL CHECK(height > 0 AND height <= 1),
 confidence REAL CHECK(confidence >= 0 AND confidence <= 1),
 origin TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'suggested',
 updated_at TEXT NOT NULL
);
CREATE TABLE external_sources (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 finding_id TEXT REFERENCES findings(id) ON DELETE SET NULL,
 url TEXT NOT NULL,
 title TEXT NOT NULL,
 publisher_type TEXT NOT NULL DEFAULT 'third_party',
 excerpt TEXT NOT NULL DEFAULT '',
 retrieved_at TEXT NOT NULL,
 review_state TEXT NOT NULL DEFAULT 'suggested'
);
CREATE INDEX plan_detections_project_idx ON plan_detections(project_id);
CREATE INDEX external_sources_project_idx ON external_sources(project_id);
