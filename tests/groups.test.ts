import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {db,allProjects,projectById} from "../src/lib/db";
import {POST as createGroup} from "../src/app/api/projects/[id]/groups/route";
import {PATCH as moveEvidence} from "../src/app/api/projects/[id]/evidence/[evidenceId]/route";

test("evidence groups are project-scoped and accessible move API persists membership",async()=>{
 const projectId=randomUUID(),otherProjectId=randomUUID(),evidenceId=randomUUID(),now=new Date().toISOString();
 db.prepare("INSERT INTO projects(id,name,demo,created_at) VALUES(?,?,0,?)").run(projectId,"Grouping test",now);db.prepare("INSERT INTO projects(id,name,demo,created_at) VALUES(?,?,0,?)").run(otherProjectId,"Other grouping test",now);db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId,projectId,"eq_11-side.jpg","image/jpeg",10,"side.jpg",now);
 try{
  const created=await createGroup(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:"Heat pump 1",groupType:"equipment"})}),{params:Promise.resolve({id:projectId})});assert.equal(created.status,201);const group=await created.json();
  const assigned=await moveEvidence(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({groupId:group.id})}),{params:Promise.resolve({id:projectId,evidenceId})});assert.equal(assigned.status,200);
  const persisted=db.prepare("SELECT e.group_id,g.name,g.group_type FROM evidence e JOIN evidence_groups g ON g.id=e.group_id WHERE e.id=?").get(evidenceId) as any;assert.equal(persisted.group_id,group.id);assert.equal(persisted.name,"Heat pump 1");assert.equal(persisted.group_type,"equipment");
  const foreign=await moveEvidence(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({groupId:group.id})}),{params:Promise.resolve({id:otherProjectId,evidenceId})});assert.equal(foreign.status,404);
  const unassigned=await moveEvidence(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({groupId:null})}),{params:Promise.resolve({id:projectId,evidenceId})});assert.equal(unassigned.status,200);assert.equal((db.prepare("SELECT group_id FROM evidence WHERE id=?").get(evidenceId) as any).group_id,null);
 }finally{db.prepare("DELETE FROM projects WHERE id IN (?,?)").run(projectId,otherProjectId)}
});

test("demo fixture projects cannot be selected as real projects",()=>{
 assert.ok(!projectById("demo-ateliers"));assert.ok((allProjects() as any[]).every(project=>project.demo===0));
});
