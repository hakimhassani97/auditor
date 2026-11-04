import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db} from "../src/lib/db";
import {POST as generateReport} from "../src/app/api/projects/[id]/report/route";

test("report findings and plan paragraphs carry only linked/grouped evidence and legal scope is explicit",async()=>{
 const projectId=randomUUID(),groupId=randomUUID(),photo1=randomUUID(),photo2=randomUUID(),unrelated=randomUUID(),findingId=randomUUID(),suggestionId=randomUUID(),detectionId=randomUUID(),now=new Date().toISOString();
 db.prepare("INSERT INTO projects(id,name,demo,created_at) VALUES(?,?,0,?)").run(projectId,"Report evidence linkage test",now);
 try{
  db.prepare("INSERT INTO evidence_groups(id,project_id,name,group_type,created_at) VALUES(?,?,?,?,?)").run(groupId,projectId,"Heat pump 1","equipment",now);
  const insertEvidence=db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at,group_id) VALUES(?,?,?,?,?,?,?,?)");
  insertEvidence.run(photo1,projectId,"heat-pump-overview.jpg","image/jpeg",10,"heat-pump-overview.jpg",now,groupId);
  insertEvidence.run(photo2,projectId,"heat-pump-nameplate.jpg","image/jpeg",10,"heat-pump-nameplate.jpg",now,groupId);
  insertEvidence.run(unrelated,projectId,"unrelated-window.jpg","image/jpeg",10,"unrelated-window.jpg",now,null);
  const insertFinding=db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)");
  insertFinding.run(findingId,projectId,photo1,"Heat pump model","Model details read from the unit nameplate.","equipment","user_confirmed","accepted",now);
  insertFinding.run(suggestionId,projectId,unrelated,"Window observation","Potential window issue awaiting review.","building","meta_suggestion","suggested",now);
  db.prepare("INSERT INTO plan_detections(id,project_id,evidence_id,page_number,label,x,y,width,height,confidence,origin,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(detectionId,projectId,unrelated,1,"Window zone",.1,.2,.3,.4,.8,"meta_suggestion","suggested",now);

  const response=await generateReport(new Request("http://local"),{params:Promise.resolve({id:projectId})});
  assert.equal(response.status,200);
  const report=await response.json();
  assert.match(report.status,/not an audit énergétique réglementaire/i);
  assert.match(report.calculations,/must not be used as a substitute/i);
  assert.equal(report.regulatoryScope.status,"unassessed");
  assert.equal(report.regulatoryScope.applicabilityConclusion,null);
  assert.ok(report.regulatoryScope.requiredInputs.some((input:string)=>input.includes("Ownership arrangement")));
  assert.ok(report.regulatoryScope.requiredInputs.some((input:string)=>input.includes("Intended use of the report")));
  assert.deepEqual(report.confirmed[0].supportingEvidence.map((e:any)=>e.filename).sort(),["heat-pump-nameplate.jpg","heat-pump-overview.jpg"]);
  assert.deepEqual(report.suggestions[0].supportingEvidence.map((e:any)=>e.filename),["unrelated-window.jpg"]);
  assert.deepEqual(report.planDetections[0].supportingEvidence.map((e:any)=>e.filename),["unrelated-window.jpg"]);
   assert.equal(report.confirmed[0].supportingEvidence[0].groupName,"Heat pump 1");
   assert.equal(report.confirmed[0].reviewState,"Confirmed");
   assert.equal(report.suggestions[0].reviewState,"Needs review");
   assert.equal("origin" in report.confirmed[0],false);
   assert.equal("origin" in report.planDetections[0],false);
 }finally{db.prepare("DELETE FROM projects WHERE id=?").run(projectId)}
});
