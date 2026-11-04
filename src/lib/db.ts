import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.env.DATA_DIR || "./data");
fs.mkdirSync(root, { recursive: true });
const dbPath = path.join(root, "auditor.sqlite");
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA busy_timeout = 10000;");
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);");
const alreadyMigrated = !!db.prepare("SELECT version FROM schema_migrations WHERE version='001_initial'").get();
if (!alreadyMigrated) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const migrated = db.prepare("SELECT version FROM schema_migrations WHERE version='001_initial'").get();
    if (!migrated) {
      // Databases created by the early prototype already had this schema; record it in place.
      const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
      if (!legacy) db.exec(fs.readFileSync(path.resolve(process.cwd(), "migrations/001_initial.sql"), "utf8"));
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES('001_initial',?)").run(new Date().toISOString());
    }
    db.exec("COMMIT;");
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
}
const enrichmentApplied=!!db.prepare("SELECT version FROM schema_migrations WHERE version='002_review_enrichment'").get();
if(!enrichmentApplied){db.exec("BEGIN IMMEDIATE;");try{const applied=!!db.prepare("SELECT version FROM schema_migrations WHERE version='002_review_enrichment'").get();if(!applied){db.exec(fs.readFileSync(path.resolve(process.cwd(),"migrations/002_review_enrichment.sql"),"utf8"));db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES('002_review_enrichment',?)").run(new Date().toISOString())}db.exec("COMMIT;")}catch(error){db.exec("ROLLBACK;");throw error}}
const groupsApplied=!!db.prepare("SELECT version FROM schema_migrations WHERE version='003_evidence_groups'").get();
if(!groupsApplied){db.exec("BEGIN IMMEDIATE;");try{if(!db.prepare("SELECT version FROM schema_migrations WHERE version='003_evidence_groups'").get()){db.exec(fs.readFileSync(path.resolve(process.cwd(),"migrations/003_evidence_groups.sql"),"utf8"));db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES('003_evidence_groups',?)").run(new Date().toISOString())}db.exec("COMMIT;")}catch(error){db.exec("ROLLBACK;");throw error}}

export function allProjects() { return db.prepare("SELECT p.*, (SELECT count(*) FROM evidence e WHERE e.project_id=p.id) evidence_count, (SELECT count(*) FROM findings f WHERE f.project_id=p.id AND f.state='suggested') review_count FROM projects p WHERE p.demo=0 ORDER BY created_at DESC").all(); }
export function projectById(id: string) { return db.prepare("SELECT * FROM projects WHERE id=? AND demo=0").get(id) as any; }
export function projectDetail(id: string) {
  const project = projectById(id); if (!project) return null;
  const jobs=db.prepare("SELECT j.*,e.filename FROM jobs j LEFT JOIN evidence e ON j.evidence_id=e.id WHERE j.project_id=? ORDER BY j.created_at DESC").all(id) as any[];
  return { ...project, groups:db.prepare("SELECT g.*,(SELECT count(*) FROM evidence e WHERE e.group_id=g.id) evidence_count FROM evidence_groups g WHERE g.project_id=? ORDER BY g.created_at").all(id), evidence: db.prepare("SELECT e.*,g.name group_name FROM evidence e LEFT JOIN evidence_groups g ON g.id=e.group_id WHERE e.project_id=? ORDER BY e.created_at DESC").all(id), findings: db.prepare("SELECT f.*,e.filename,e.stored_path,e.mime,e.group_id,e.group_name FROM findings f LEFT JOIN (SELECT evidence.*,evidence_groups.name group_name FROM evidence LEFT JOIN evidence_groups ON evidence.group_id=evidence_groups.id) e ON f.evidence_id=e.id WHERE f.project_id=? ORDER BY CASE f.state WHEN 'suggested' THEN 0 ELSE 1 END, f.created_at DESC").all(id), jobs: jobs.map(j=>({...j,steps:db.prepare("SELECT name,status,detail,updated_at FROM job_steps WHERE job_id=? ORDER BY id").all(j.id)})), detections:db.prepare("SELECT d.*,e.filename,e.stored_path,e.mime FROM plan_detections d JOIN evidence e ON d.evidence_id=e.id WHERE d.project_id=? ORDER BY e.filename,d.page_number").all(id),sources:db.prepare("SELECT * FROM external_sources WHERE project_id=? ORDER BY retrieved_at DESC").all(id), events: db.prepare("SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT 50").all(id) };
}
export { db };
