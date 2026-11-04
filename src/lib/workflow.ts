import { db } from "./db";
import { randomUUID } from "node:crypto";

export const stages = ["Upload validation", "File classification", "Text & visual extraction", "Evidence grouping", "Product research", "Plan interpretation", "Consistency checks", "Dossier update"];
export function classify(mime: string, name: string) {
  const v = `${mime} ${name}`.toLowerCase();
  if (v.includes("pdf") && /plan|floor|niveau|blueprint/.test(v)) return "plan";
  if (v.includes("pdf") || /spec|fiche|manual|datasheet/.test(v)) return "technical_document";
  if (/plan|niveau|floor/.test(v)) return "plan";
  if (/plaque|nameplate|label/.test(v)) return "nameplate";
  if (/facade|exterior|building|outside/.test(v)) return "building";
  if (/image|photo|equipment|equipement|eq_/.test(v)) return "equipment";
  return "unknown";
}
export function recordJob(projectId: string, evidenceId: string, live = false) {
  const id = randomUUID(), now = new Date().toISOString();
  db.prepare("INSERT INTO jobs(id,project_id,evidence_id,status,provider,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").run(id, projectId, evidenceId, "complete", live ? "meta" : "local_fixture", now, now);
  const insert = db.prepare("INSERT INTO job_steps(job_id,name,status,detail,updated_at) VALUES(?,?,?,?,?)");
  for (const [i, name] of stages.entries()) insert.run(id, name, "complete", i === 0 ? "File stored locally; type and size validated." : i === 1 ? "Classified by file metadata and name; not an AI result." : i === 4 ? "Unavailable: no search integration configured." : "Completed with local fixture rules; verify suggested findings.", now);
  db.prepare("UPDATE evidence SET status='complete',category=? WHERE id=?").run(classify((db.prepare("SELECT mime FROM evidence WHERE id=?").get(evidenceId) as any).mime, (db.prepare("SELECT filename FROM evidence WHERE id=?").get(evidenceId) as any).filename), evidenceId);
  return id;
}
export function startLiveJob(projectId:string,evidenceId:string|null){
 const id=randomUUID(),now=new Date().toISOString(),attempt=evidenceId?(db.prepare("SELECT COALESCE(MAX(attempt_count),0)+1 attempt FROM jobs WHERE evidence_id=?").get(evidenceId) as any).attempt:1;db.prepare("INSERT INTO jobs(id,project_id,evidence_id,status,provider,created_at,updated_at,attempt_count) VALUES(?,?,?,?,?,?,?,?)").run(id,projectId,evidenceId,"running","meta",now,now,attempt);
 const insert=db.prepare("INSERT INTO job_steps(job_id,name,status,detail,updated_at) VALUES(?,?,?,?,?)");for(const [i,name] of stages.entries())insert.run(id,name,i===0?"running":"pending",i===0?"Checking stored file and Meta configuration.":"Waiting for previous step.",now);return id;
}
export function updateLiveJob(id:string,status:"running"|"complete"|"failed",completed:number,error="",stepNotes:Record<number,string>={}){
 const now=new Date().toISOString();db.prepare("UPDATE jobs SET status=?,error=?,updated_at=? WHERE id=?").run(status,error||null,now,id);
 for(const [i,name] of stages.entries()){const stepStatus=i<completed?"complete":i===completed&&status==="failed"?"failed":status==="complete"?"complete":i===completed?"running":"pending";const detail=stepNotes[i]||(stepStatus==="complete"?(i===4?"Web search unavailable unless configured; no citations invented.":"Completed."):stepStatus==="failed"?(error||"Step failed; retry this file."):stepStatus==="running"?"In progress…":"Waiting for previous step.");db.prepare("UPDATE job_steps SET status=?,detail=?,updated_at=? WHERE job_id=? AND name=?").run(stepStatus,detail,now,id,name)}
}
