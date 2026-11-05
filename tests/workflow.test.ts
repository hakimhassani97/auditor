import test from "node:test";
import assert from "node:assert/strict";
import { classify, stages, startLiveJob, updateLiveJob } from "../src/lib/workflow";
import { z } from "zod";
import {analysisSchema,buildAnalysisRequest,extractOutputText,parseAnalysis,requestWithRetry,resolveReasoningEffort,verifyModel,MetaProviderError} from "../src/lib/meta-provider";
import {db} from "../src/lib/db";
import {prepareProject} from "../src/lib/preparation-client";
import {randomUUID} from "node:crypto";
import {PATCH as updatePlanDetection} from "../src/app/api/plan-detections/[id]/route";
import {PATCH as updateFinding} from "../src/app/api/findings/[id]/route";
import {PATCH as updateSource} from "../src/app/api/sources/[id]/route";

test("classifies plan, nameplate, specs and exterior file hints",()=>{
 assert.equal(classify("application/pdf","floor_plan_level0.pdf"),"plan");
 assert.equal(classify("image/jpeg","eq_11_nameplate.jpg"),"nameplate");
 assert.equal(classify("application/pdf","manufacturer_datasheet.pdf"),"technical_document");
 assert.equal(classify("image/webp","exterior_facade.webp"),"building");
 assert.equal(classify("application/octet-stream","mystery.bin"),"unknown");
});
test("workflow steps are explicit, ordered, and independently observable",()=>{
 assert.deepEqual(stages,["Upload validation","File classification","Text & visual extraction","Evidence grouping","Product research","Plan interpretation","Consistency checks","Dossier update"]);
});
test("one-click preparation creates its report after partial analysis failures",async()=>{
 const calls:string[]=[],progress:string[]=[],files=[{id:"good",filename:"unit.jpg"},{id:"bad",filename:"plate.jpg"}];
 const fetcher=(async(input:string|URL|Request)=>{const url=String(input);calls.push(url);if(url.endsWith("/process")&&calls.filter(x=>x.endsWith("/process")).length===2)return new Response(JSON.stringify({error:"Meta unavailable"}),{status:503});if(url.endsWith("/report"))return new Response(JSON.stringify({overview:{evidenceFiles:2}}),{status:200});return new Response("{}",{status:200})}) as typeof fetch;
 const result=await prepareProject<{overview:{evidenceFiles:number}}>("project",files,fetcher,(index,_total,file)=>progress.push(`${index}:${file.filename}`));
 assert.deepEqual(calls,["/api/projects/project/process","/api/projects/project/process","/api/projects/project/report"]);assert.deepEqual(progress,["1:unit.jpg","2:plate.jpg"]);assert.equal(result.report.overview.evidenceFiles,2);assert.deepEqual(result.failures,[{filename:"plate.jpg",reason:"Meta unavailable"}]);
});
test("schema rejects malformed confidence and unknown finding kind",()=>{
 const schema=z.object({category:z.enum(["equipment","nameplate","technical_document","plan","building","unknown"]),findings:z.array(z.object({title:z.string().min(1).max(160),detail:z.string().max(1200),kind:z.enum(["equipment","technical","plan","observation"]),confidence:z.number().min(0).max(1)})).max(12)});
 assert.equal(schema.safeParse({category:"plan",findings:[{title:"Room zone",detail:"Unverified",kind:"plan",confidence:.6}]}).success,true);
 assert.equal(schema.safeParse({category:"plan",findings:[{title:"",detail:"",kind:"guess",confidence:2}]}).success,false);
});
test("Meta structured response validation rejects malformed and out-of-page detections",()=>{
 const good={category:"plan",findings:[],detections:[{pageNumber:2,label:"Workshop",x:.1,y:.2,width:.4,height:.5,confidence:.73}]};
 assert.equal(analysisSchema.safeParse(good).success,true);assert.equal(analysisSchema.safeParse({...good,detections:[{...good.detections[0],x:.8}]}).success,false);
 assert.throws(()=>parseAnalysis("not-json"),/invalid JSON/i);assert.throws(()=>extractOutputText({status:"incomplete",output:[]}),/incomplete/i);
  const request=buildAnalysisRequest("muse-spark-1.3",[{type:"input_text",text:"fixture"}]);assert.equal((request.text.format as any).type,"json_schema");assert.equal((request.text.format as any).strict,true);assert.equal((request.text.format as any).name,"building_evidence_analysis");assert.deepEqual(request.reasoning,{effort:"medium"});assert.equal(request.max_output_tokens,5000);
 });
test("Meta reasoning effort uses documented controls and limits max to verified model versions",()=>{
 assert.equal(resolveReasoningEffort("muse-spark-1.3","high"),"high");assert.equal(resolveReasoningEffort("muse-wonder-1.0","max"),"max");assert.throws(()=>resolveReasoningEffort("muse-spark-1.3-contributor","max"),/not eligible/i);assert.throws(()=>resolveReasoningEffort("muse-spark-1.2","max"),/not eligible/i);assert.throws(()=>resolveReasoningEffort("muse-spark-1.3","none"),/must be low/i);
});
test("Meta model capability check rejects unavailable models and incompatible modality metadata",async()=>{
 const unavailable=async()=>new Response(JSON.stringify({data:[]}),{status:200,headers:{"content-type":"application/json"}});
 await assert.rejects(()=>verifyModel(unavailable as typeof fetch,"https://meta.test/v1","test","muse-spark-1.3",new AbortController().signal),/not present/i);
 let calls=0;const incompatible=async()=>{calls++;return new Response(JSON.stringify(calls===1?{data:[{id:"muse-spark-1.3"}]}:{id:"muse-spark-1.3",modalities:["text"]}),{status:200,headers:{"content-type":"application/json"}})};
 await assert.rejects(()=>verifyModel(incompatible as typeof fetch,"https://meta.test/v1","test","muse-spark-1.3",new AbortController().signal),/does not advertise image input/i);
 calls=0;const compatible=async()=>{calls++;return new Response(JSON.stringify(calls===1?{data:[{id:"muse-spark-1.3"}]}:{id:"muse-spark-1.3",modalities:["text","image","pdf"],capabilities:{structured_output:true}}),{status:200,headers:{"content-type":"application/json"}})};
 const route=await verifyModel(compatible as typeof fetch,"https://meta.test/v1","test","muse-spark-1.3",new AbortController().signal,"pdf");assert.equal(route.capabilities.pdf,true);assert.equal(calls,2);
});
test("Meta provider retries transient rate limit and fails fast on permanent auth errors",async()=>{
 let calls=0;const transient=async()=>{calls++;return calls===1?new Response("busy",{status:429,headers:{"retry-after":"0"}}):new Response("{}",{status:200})};
 const response=await requestWithRetry(transient as typeof fetch,"https://meta.test/v1/responses",{},1);assert.equal(response.ok,true);assert.equal(calls,2);
 calls=0;const unauthorized=async()=>{calls++;return new Response("invalid key",{status:401})};await assert.rejects(()=>requestWithRetry(unauthorized as typeof fetch,"https://meta.test/v1/models",{},2),MetaProviderError);assert.equal(calls,1);
});
test("failed processing stages are persisted and retry gets a new attempt number",()=>{
 const projectId=randomUUID(),evidenceId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(projectId,"retry test",now);db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId,projectId,"eq_11.jpg","image/jpeg",1,"missing.jpg",now);
 const first=startLiveJob(projectId,evidenceId);updateLiveJob(first,"failed",1,"HTTP 429 retryable");const second=startLiveJob(projectId,evidenceId);
 const jobs=db.prepare("SELECT attempt_count,status FROM jobs WHERE evidence_id=? ORDER BY attempt_count").all(evidenceId) as any[];const failed=db.prepare("SELECT status,detail FROM job_steps WHERE job_id=? AND name='File classification'").get(first) as any;
 assert.deepEqual(jobs.map(x=>x.attempt_count),[1,2]);assert.equal(jobs[0].status,"failed");assert.equal(failed.status,"failed");assert.match(failed.detail,/HTTP 429/);assert.equal((db.prepare("SELECT status FROM job_steps WHERE job_id=? AND name='Upload validation'").get(first) as any).status,"complete");
 db.prepare("DELETE FROM projects WHERE id=?").run(projectId);assert.ok(second);
});
test("plan review API validates bounds, preserves provenance, and audits edits",async()=>{
 const projectId=randomUUID(),evidenceId=randomUUID(),detectionId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(projectId,"plan provenance test",now);db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId,projectId,"level0.png","image/png",1,"unused.png",now);db.prepare("INSERT INTO plan_detections(id,project_id,evidence_id,page_number,label,x,y,width,height,confidence,origin,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)").run(detectionId,projectId,evidenceId,1,"Workshop",.1,.2,.3,.4,.8,"meta_suggestion","suggested",now);
 const bad=await updatePlanDetection(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"edit",x:.8,width:.3})}),{params:Promise.resolve({id:detectionId})});assert.equal(bad.status,400);
 const response=await updatePlanDetection(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"edit",label:"Workshop edited",x:.12})}),{params:Promise.resolve({id:detectionId})});assert.equal(response.status,200);
 const row=db.prepare("SELECT d.label,d.x,d.origin,e.filename FROM plan_detections d JOIN evidence e ON e.id=d.evidence_id WHERE d.id=?").get(detectionId) as any;const event=db.prepare("SELECT action,note FROM audit_events WHERE project_id=?").get(projectId) as any;
 assert.equal(row.label,"Workshop edited");assert.equal(row.x,.12);assert.equal(row.origin,"meta_suggestion");assert.equal(row.filename,"level0.png");assert.equal(event.action,"plan_edit");assert.match(event.note,/level0.png.*page 1.*Workshop edited/);db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
});
test("finding edit endpoint retains linked source and appends review provenance",async()=>{
 const projectId=randomUUID(),evidenceId=randomUUID(),findingId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(projectId,"review provenance test",now);db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId,projectId,"plate.png","image/png",1,"plate.png",now);db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,confidence,state,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(findingId,projectId,evidenceId,"Candidate","Unknown output","technical","meta_suggestion",.61,"suggested","plate.png · page 1",now);
 const response=await updateFinding(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"edit",title:"Corrected candidate",detail:"Auditor transcription"})}),{params:Promise.resolve({id:findingId})});assert.equal(response.status,200);
 const fact=db.prepare("SELECT f.edited_title,f.edited_detail,f.state,e.filename,f.source_ref FROM findings f JOIN evidence e ON e.id=f.evidence_id WHERE f.id=?").get(findingId) as any;const event=db.prepare("SELECT action,previous_state,new_state FROM audit_events WHERE finding_id=?").get(findingId) as any;
 assert.equal(fact.edited_title,"Corrected candidate");assert.equal(fact.edited_detail,"Auditor transcription");assert.equal(fact.state,"edited");assert.equal(fact.filename,"plate.png");assert.match(fact.source_ref,/page 1/);assert.equal(event.action,"edit");assert.equal(event.previous_state,"suggested");assert.equal(event.new_state,"edited");db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
});
test("external source decision preserves URL and retrieval timestamp in provenance",async()=>{
 const projectId=randomUUID(),findingId=randomUUID(),sourceId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(projectId,"source review test",now);db.prepare("INSERT INTO findings(id,project_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?)").run(findingId,projectId,"Candidate","Confirmed candidate","equipment","user_confirmed","accepted",now);db.prepare("INSERT INTO external_sources(id,project_id,finding_id,url,title,publisher_type,excerpt,retrieved_at,review_state) VALUES(?,?,?,?,?,?,?,?,?)").run(sourceId,projectId,findingId,"https://manufacturer.example/spec","Product datasheet","manufacturer_candidate","source excerpt",now,"suggested");
 const response=await updateSource(new Request("http://local",{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({action:"accept"})}),{params:Promise.resolve({id:sourceId})});assert.equal(response.status,200);const source=db.prepare("SELECT url,title,retrieved_at,review_state FROM external_sources WHERE id=?").get(sourceId) as any;const event=db.prepare("SELECT action,note FROM audit_events WHERE project_id=?").get(projectId) as any;
 assert.equal(source.url,"https://manufacturer.example/spec");assert.equal(source.title,"Product datasheet");assert.equal(source.retrieved_at,now);assert.equal(source.review_state,"accepted");assert.equal(event.action,"source_accept");assert.match(event.note,/https:\/\/manufacturer\.example/);db.prepare("DELETE FROM projects WHERE id=?").run(projectId);
});
