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
const hasProjectsTable = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
const alreadySeeded = hasProjectsTable && !!db.prepare("SELECT id FROM projects WHERE demo=1 LIMIT 1").get();
if (!alreadyMigrated || !alreadySeeded) {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const migrated = db.prepare("SELECT version FROM schema_migrations WHERE version='001_initial'").get();
    if (!migrated) {
      // Databases created by the early prototype already had this schema; record it in place.
      const legacy = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").get();
      if (!legacy) db.exec(fs.readFileSync(path.resolve(process.cwd(), "migrations/001_initial.sql"), "utf8"));
      db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES('001_initial',?)").run(new Date().toISOString());
    }
    const now = new Date().toISOString();
    const hasDemo = db.prepare("SELECT id FROM projects WHERE demo=1 LIMIT 1").get();
    if (!hasDemo) {
      const projectId = "demo-ateliers";
      db.prepare("INSERT INTO projects (id,name,address,demo,created_at) VALUES (?,?,?,?,?)").run(projectId, "Les Ateliers du Canal", "18 quai de la Loire, 75019 Paris", 1, now);
      const files = [
        ["demo-eq1", "PAC_atelier-nord.svg", "eq_11", "image/svg+xml", "/demo/heat-pump.svg", "equipment"],
        ["demo-eq2", "plaque_unite.svg", "eq_11", "image/svg+xml", "/demo/nameplate.svg", "nameplate"],
        ["demo-plan", "plan_niveau_0.svg", "", "image/svg+xml", "/demo/floor-plan.svg", "plan"],
        ["demo-ext", "facade_cour.svg", "", "image/svg+xml", "/demo/exterior.svg", "building"],
      ] as const;
      const insertEvidence = db.prepare("INSERT INTO evidence(id,project_id,filename,label,mime,size,stored_path,status,category,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)");
      for (const [id, filename, label, mime, stored, category] of files) insertEvidence.run(id, projectId, filename, label, mime, 0, stored, "complete", category, now);
      const facts = [
        ["fact-1", "Air-to-water heat pump", "Outdoor unit visible in the courtyard evidence. Candidate identification only; confirm equipment family and installed location.", "equipment", .91, "demo-eq1", "Visible fan grille and refrigerant connections; no model inferred."],
        ["fact-2", "Nameplate: model and rated output need confirmation", "Plate image is attached to eq_11. Text is intentionally not fabricated in this demo; confirm values from a sharper capture.", "technical", .68, "demo-eq2", "Source: close-up nameplate image; extraction status fixture."],
        ["fact-3", "Plan indicates a ground-floor workshop zone", "Room label is legible in the uploaded illustrative plan. Overlay position is indicative, not a measured boundary.", "plan", .84, "demo-plan", "Page 1 · indicative region · scale not verified."],
        ["fact-4", "Exterior wall shows visible openings and shading variation", "Photo observation for follow-up only. No insulation or performance value is inferred from appearance.", "observation", .77, "demo-ext", "Visual observation tied to exterior image."],
      ] as const;
      const insertFinding = db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,confidence,state,source_ref,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
      for (const [id, title, detail, kind, confidence, evidenceId, ref] of facts) insertFinding.run(id, projectId, evidenceId, title, detail, kind, "demo_fixture", confidence, "suggested", ref, now);
    }
    db.exec("COMMIT;");
  } catch (error) { db.exec("ROLLBACK;"); throw error; }
}
const enrichmentApplied=!!db.prepare("SELECT version FROM schema_migrations WHERE version='002_review_enrichment'").get();
if(!enrichmentApplied){db.exec("BEGIN IMMEDIATE;");try{const applied=!!db.prepare("SELECT version FROM schema_migrations WHERE version='002_review_enrichment'").get();if(!applied){db.exec(fs.readFileSync(path.resolve(process.cwd(),"migrations/002_review_enrichment.sql"),"utf8"));db.prepare("INSERT INTO schema_migrations(version,applied_at) VALUES('002_review_enrichment',?)").run(new Date().toISOString())}db.exec("COMMIT;")}catch(error){db.exec("ROLLBACK;");throw error}}
const demoPlan=db.prepare("SELECT id FROM evidence WHERE id='demo-plan'").get();
if(demoPlan)db.prepare("INSERT OR IGNORE INTO plan_detections(id,project_id,evidence_id,page_number,label,x,y,width,height,confidence,origin,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run("demo-zone-workshop","demo-ateliers","demo-plan",1,"Workshop zone · indicative",.12,.22,.36,.58,.84,"demo_fixture","suggested",new Date().toISOString());

export function allProjects() { return db.prepare("SELECT p.*, (SELECT count(*) FROM evidence e WHERE e.project_id=p.id) evidence_count, (SELECT count(*) FROM findings f WHERE f.project_id=p.id AND f.state='suggested') review_count FROM projects p ORDER BY demo DESC, created_at DESC").all(); }
export function projectById(id: string) { return db.prepare("SELECT * FROM projects WHERE id=?").get(id) as any; }
export function projectDetail(id: string) {
  const project = projectById(id); if (!project) return null;
  const jobs=db.prepare("SELECT j.*,e.filename FROM jobs j LEFT JOIN evidence e ON j.evidence_id=e.id WHERE j.project_id=? ORDER BY j.created_at DESC").all(id) as any[];
  return { ...project, evidence: db.prepare("SELECT * FROM evidence WHERE project_id=? ORDER BY created_at DESC").all(id), findings: db.prepare("SELECT f.*,e.filename,e.stored_path,e.mime FROM findings f LEFT JOIN evidence e ON f.evidence_id=e.id WHERE f.project_id=? ORDER BY CASE f.state WHEN 'suggested' THEN 0 ELSE 1 END, f.created_at DESC").all(id), jobs: jobs.map(j=>({...j,steps:db.prepare("SELECT name,status,detail,updated_at FROM job_steps WHERE job_id=? ORDER BY id").all(j.id)})), detections:db.prepare("SELECT d.*,e.filename,e.stored_path,e.mime FROM plan_detections d JOIN evidence e ON d.evidence_id=e.id WHERE d.project_id=? ORDER BY e.filename,d.page_number").all(id),sources:db.prepare("SELECT * FROM external_sources WHERE project_id=? ORDER BY retrieved_at DESC").all(id), events: db.prepare("SELECT * FROM audit_events WHERE project_id=? ORDER BY created_at DESC LIMIT 50").all(id) };
}
export { db };
