import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../src/lib/db";
import { POST as processEvidence, buildEvidencePrompt } from "../src/app/api/projects/[id]/process/route";
import { POST as researchFinding } from "../src/app/api/projects/[id]/research/route";

const model="muse-spark-1.3";
const response=(payload:any,status=200)=>new Response(JSON.stringify(payload),{status,headers:{"content-type":"application/json"}});
const output=(data:any)=>({status:"completed",output:[{type:"message",content:[{type:"output_text",text:JSON.stringify(data)}]}]});
async function fixture(kind:"image"|"pdf"="image"){
 const id=randomUUID(),evidenceId=randomUUID(),now=new Date().toISOString(),folder=path.resolve("storage/uploads",id),filename=kind==="image"?"eq_11-unit.png":"floor-plan.pdf",mime=kind==="image"?"image/png":"application/pdf";
 await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,"fixture.bin"),"MOCK_EVIDENCE_BYTES");
 db.prepare("INSERT INTO projects(id,name,created_at) VALUES(?,?,?)").run(id,"Meta route test",now);
 db.prepare("INSERT INTO evidence(id,project_id,filename,mime,size,stored_path,created_at) VALUES(?,?,?,?,?,?,?)").run(evidenceId,id,filename,mime,19,"fixture.bin",now);
 return {id,evidenceId,folder,async cleanup(){db.prepare("DELETE FROM projects WHERE id=?").run(id);await fs.rm(folder,{recursive:true,force:true})}};
}
async function withMeta(mock:typeof fetch,fn:()=>Promise<void>){const oldFetch=global.fetch,oldEnv={key:process.env.MODEL_API_KEY,external:process.env.ENABLE_EXTERNAL_PROCESSING,search:process.env.ENABLE_WEB_SEARCH,model:process.env.META_MODEL};global.fetch=mock;process.env.MODEL_API_KEY="unit-test-token";process.env.ENABLE_EXTERNAL_PROCESSING="true";process.env.ENABLE_WEB_SEARCH="true";process.env.META_MODEL=model;try{await fn()}finally{global.fetch=oldFetch;for(const [key,value] of [["MODEL_API_KEY",oldEnv.key],["ENABLE_EXTERNAL_PROCESSING",oldEnv.external],["ENABLE_WEB_SEARCH",oldEnv.search],["META_MODEL",oldEnv.model]] as const){if(value===undefined)delete process.env[key];else process.env[key]=value}}}
function metaMock(responses:(url:string,init?:RequestInit)=>Response|Promise<Response>){return (async(input:string|URL|Request,init?:RequestInit)=>{const url=String(input);if(url.endsWith("/models"))return response({data:[{id:model}]});if(url.endsWith(`/models/${model}`))return response({id:model,modalities:["text","image","pdf"],capabilities:{structured_output:true,web_search:true}});return responses(url,init)}) as typeof fetch}
const analysis={category:"plan",findings:[{title:"Workshop zone",detail:"Label visible; confirm during site visit.",kind:"plan",confidence:.82}],detections:[{pageNumber:1,label:"Workshop",x:.12,y:.2,width:.4,height:.5,confidence:.8}]};

test("evidence-aware prompt uses auditor/group hints without claiming unseen evidence",()=>{
 const prompt=buildEvidencePrompt({filename:"eq_11-plate.png",label:"eq_11",category:"nameplate"},[{filename:"eq_11-overview.jpg",label:"eq_11",category:"equipment"}]);
 assert.match(prompt,/cross-check every proposed claim/);assert.match(prompt,/eq_11-plate\.png/);assert.match(prompt,/eq_11-overview\.jpg/);assert.match(prompt,/metadata only/);assert.match(prompt,/not private chain-of-thought/i);assert.match(prompt,/conflicts or missing\/illegible critical values/);
});

test("analysis endpoint sends selected evidence with strict schema and persists findings/overlays",async()=>{
  const f=await fixture("image");let requestBody:any;
 await withMeta(metaMock((url,init)=>{assert.match(url,/\/responses$/);requestBody=JSON.parse(String(init?.body));return response(output(analysis))}),async()=>{
  const res=await processEvidence(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({evidenceId:f.evidenceId})}),{params:Promise.resolve({id:f.id})});const body=await res.json();assert.equal(res.status,200);assert.equal(body.count,1);assert.equal(body.detections,1);
 });
  assert.equal(requestBody.text.format.type,"json_schema");assert.equal(requestBody.text.format.strict,true);assert.deepEqual(requestBody.reasoning,{effort:"medium"});assert.ok(requestBody.input[0].content.some((x:any)=>x.type==="input_image"&&x.image_url.includes("TU9DS19FVklERU5DRV9CWVRFUw==")));
  const finding=db.prepare("SELECT title,origin,state,source_ref FROM findings WHERE evidence_id=? AND origin='meta_suggestion'").get(f.evidenceId) as any;const detection=db.prepare("SELECT label,x,y,width,height,origin FROM plan_detections WHERE evidence_id=? AND origin='meta_suggestion'").get(f.evidenceId) as any;const job=db.prepare("SELECT status,attempt_count FROM jobs WHERE evidence_id=? ORDER BY created_at DESC LIMIT 1").get(f.evidenceId) as any;
  assert.equal(finding.title,"Workshop zone");assert.equal(finding.origin,"meta_suggestion");assert.equal(finding.state,"suggested");assert.match(finding.source_ref,/muse-spark-1.3.*reasoning medium/);assert.deepEqual(Object.values(detection),["Workshop",.12,.2,.4,.5,"meta_suggestion"]);assert.equal(job.status,"complete");assert.equal(job.attempt_count,1);await f.cleanup();
});

test("analysis endpoint retries 429 and persists failed attempt before subsequent retry",async()=>{
 const f=await fixture();let responses=0;
 await withMeta(metaMock(()=>{responses++;return responses===1?new Response("rate limited",{status:429,headers:{"retry-after":"0"}}):response(output(analysis))}),async()=>{
  const call=()=>processEvidence(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({evidenceId:f.evidenceId})}),{params:Promise.resolve({id:f.id})});
  const first=await call();assert.equal(first.status,200);const second=await call();assert.equal(second.status,200);
 });
 assert.equal(responses,3);const attempts=db.prepare("SELECT status,attempt_count FROM jobs WHERE evidence_id=? ORDER BY attempt_count").all(f.evidenceId) as any[];assert.deepEqual(attempts.map(j=>[j.status,j.attempt_count]),[["complete",1],["complete",2]]);assert.equal((db.prepare("SELECT count(*) n FROM findings WHERE evidence_id=? AND origin='meta_suggestion'").get(f.evidenceId) as any).n,1);await f.cleanup();
});

test("malformed provider output and permanent errors persist failed job diagnostics",async()=>{
 const f=await fixture();let mode="invalid";
 await withMeta(metaMock(()=>mode==="invalid"?response(output({...analysis,detections:[{...analysis.detections[0],x:.9}]})):new Response("unauthorized",{status:401})),async()=>{
  const call=()=>processEvidence(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({evidenceId:f.evidenceId})}),{params:Promise.resolve({id:f.id})});
  const malformed=await call();assert.equal(malformed.status,502);assert.equal((await malformed.json()).retryable,false);mode="unauthorized";const rejected=await call();assert.equal(rejected.status,401);assert.equal((await rejected.json()).retryable,false);
 });
 const failed=db.prepare("SELECT status,attempt_count,error FROM jobs WHERE evidence_id=? ORDER BY attempt_count").all(f.evidenceId) as any[];assert.deepEqual(failed.map(j=>[j.status,j.attempt_count]),[["failed",1],["failed",2]]);assert.match(failed[0].error,/normalized page bounds/);assert.match(failed[1].error,/HTTP 401/);assert.equal((db.prepare("SELECT status FROM evidence WHERE id=?").get(f.evidenceId) as any).status,"error");await f.cleanup();
});

test("research endpoint stores actual citations and enforces confirmed findings",async()=>{
 const f=await fixture();const findingId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(findingId,f.id,f.evidenceId,"Daikin Altherma unit","Candidate model unconfirmed","equipment","meta_suggestion","accepted",now);let requestBody:any;
 const meta=metaMock((url,init)=>{assert.match(url,/\/responses$/);requestBody=JSON.parse(String(init?.body));return response({status:"completed",output:[{type:"web_search_call",results:[{url:"https://www.daikin.eu/product-datasheet",title:"Official product datasheet",snippet:"Rated data shown on official datasheet."}]},{type:"message",content:[{type:"output_text",text:"The official datasheet lists product information."}]}]})});
  await withMeta(meta,async()=>{const res=await researchFinding(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({findingId})}),{params:Promise.resolve({id:f.id})});assert.equal(res.status,200);const body=await res.json();assert.equal(body.sources.length,1);assert.equal(body.summaryTruncated,false);assert.equal(body.sources[0].publisherType,"manufacturer_candidate")});
 assert.equal(requestBody.tools[0].type,"web_search");assert.equal(requestBody.input[0].content[0].type,"input_text");const source=db.prepare("SELECT url,title,publisher_type,excerpt,retrieved_at,review_state FROM external_sources WHERE finding_id=?").get(findingId) as any;assert.equal(source.url,"https://www.daikin.eu/product-datasheet");assert.equal(source.title,"Official product datasheet");assert.equal(source.publisher_type,"manufacturer_candidate");assert.match(source.excerpt,/Rated data/);assert.ok(source.retrieved_at);assert.equal(source.review_state,"suggested");await f.cleanup();
 });

test("research saves validated citations from incomplete Meta response without using its partial summary",async()=>{
 const f=await fixture(),findingId=randomUUID(),now=new Date().toISOString(),url="https://www.daikin.eu/incomplete-result";db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(findingId,f.id,f.evidenceId,"Daikin heat pump","Candidate","equipment","meta_suggestion","accepted",now);let calls=0;
 const meta=metaMock(()=>{calls++;return response({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output:[{type:"web_search_call",results:[{url,title:"Daikin source",snippet:"Actual retrieved search snippet."}]},{type:"message",content:[{type:"output_text",text:"This partial generated summary must not be used."}]}]})});
 await withMeta(meta,async()=>{const res=await researchFinding(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({findingId})}),{params:Promise.resolve({id:f.id})});const body=await res.json();assert.equal(res.status,200);assert.equal(body.summaryTruncated,true);assert.match(body.warning,/truncated/i);assert.doesNotMatch(body.summary,/partial generated summary/i);assert.equal(body.sources.length,1)});
 const source=db.prepare("SELECT url,excerpt,review_state FROM external_sources WHERE finding_id=?").get(findingId) as any;const job=db.prepare("SELECT status FROM jobs WHERE evidence_id=? ORDER BY created_at DESC LIMIT 1").get(f.evidenceId) as any;const event=db.prepare("SELECT note FROM audit_events WHERE finding_id=? AND action='research'").get(findingId) as any;
 assert.equal(calls,1);assert.equal(source.url,url);assert.equal(source.excerpt,"Actual retrieved search snippet.");assert.equal(source.review_state,"suggested");assert.equal(job.status,"complete");assert.match(event.note,/summary was truncated/i);await f.cleanup();
});

test("research retries citation-free incomplete response once, then reports reason and saves no source",async()=>{
 const f=await fixture(),findingId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(findingId,f.id,f.evidenceId,"Heat pump","Candidate","equipment","meta_suggestion","accepted",now);const budgets:number[]=[];
 const meta=metaMock((_url,init)=>{budgets.push(JSON.parse(String(init?.body)).max_output_tokens);return response({status:"incomplete",incomplete_details:{reason:"max_output_tokens"},output:[]})});
 await withMeta(meta,async()=>{const res=await researchFinding(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({findingId})}),{params:Promise.resolve({id:f.id})});const body=await res.json();assert.equal(res.status,424);assert.equal(body.incompleteReason,"max_output_tokens");assert.equal(body.retryable,false);assert.match(body.error,/no retrievable citations/i)});
 assert.deepEqual(budgets,[1800,3600]);assert.equal((db.prepare("SELECT count(*) n FROM external_sources WHERE finding_id=?").get(findingId) as any).n,0);const job=db.prepare("SELECT status,error FROM jobs WHERE evidence_id=? ORDER BY created_at DESC LIMIT 1").get(f.evidenceId) as any;assert.equal(job.status,"failed");assert.match(job.error,/max_output_tokens/);await f.cleanup();
});

test("research stores no more than twelve validated citation URLs",async()=>{
 const f=await fixture(),findingId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(findingId,f.id,f.evidenceId,"Heat pump","Candidate","equipment","meta_suggestion","accepted",now);const results=Array.from({length:20},(_,i)=>({url:`https://docs.example/${i}`,title:`Source ${i}`,snippet:`Snippet ${i}`}));
 await withMeta(metaMock(()=>response({status:"completed",output:[{type:"web_search_call",results},{type:"message",content:[{type:"output_text",text:"Found source references."}]}]})),async()=>{const res=await researchFinding(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({findingId})}),{params:Promise.resolve({id:f.id})});assert.equal(res.status,200);const body=await res.json();assert.equal(body.sources.length,12)});
 assert.equal((db.prepare("SELECT count(*) n FROM external_sources WHERE finding_id=?").get(findingId) as any).n,12);await f.cleanup();
});

test("research without citations saves no fabricated source; request failures are persisted",async()=>{
 const f=await fixture(),findingId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,state,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(findingId,f.id,f.evidenceId,"Heat pump","Candidate","equipment","meta_suggestion","accepted",now);let mode="empty";
 await withMeta(metaMock(()=>mode==="empty"?response({status:"completed",output:[{type:"message",content:[{type:"output_text",text:"No attributable pages found."}]}]}):new Response("server busy",{status:503})),async()=>{
  const call=()=>researchFinding(new Request("http://local",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({findingId})}),{params:Promise.resolve({id:f.id})});
  const empty=await call();assert.equal(empty.status,424);assert.equal((await empty.json()).unavailable,true);mode="failure";const failed=await call();assert.equal(failed.status,503);assert.equal((await failed.json()).retryable,true);
 });
 assert.equal((db.prepare("SELECT count(*) n FROM external_sources WHERE finding_id=?").get(findingId) as any).n,0);const jobs=db.prepare("SELECT status,attempt_count,error FROM jobs WHERE evidence_id=? ORDER BY attempt_count").all(f.evidenceId) as any[];assert.deepEqual(jobs.map(j=>[j.status,j.attempt_count]),[["failed",1],["failed",2]]);assert.match(jobs[0].error,/no research source was saved/);assert.match(jobs[1].error,/HTTP 503/);await f.cleanup();
});
