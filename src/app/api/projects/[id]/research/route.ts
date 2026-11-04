import {NextResponse} from "next/server";
import {db,projectById} from "@/lib/db";
import {randomUUID} from "node:crypto";
import {extractOutputText,requestWithRetry,verifyModel} from "@/lib/meta-provider";
import {startLiveJob,updateLiveJob} from "@/lib/workflow";
export const runtime="nodejs";
const safeUrl=(url:string)=>{try{const parsed=new URL(url);return parsed.protocol==="https:"||parsed.protocol==="http:"}catch{return false}};
function likelyManufacturer(url:string,manufacturer:string){try{const host=new URL(url).hostname.toLowerCase().replace(/^www\./,"");const words=manufacturer.toLowerCase().match(/[a-z0-9]{4,}/g)||[];return words.some(w=>host.replace(/[^a-z0-9]/g,"").includes(w.replace(/[^a-z0-9]/g,"")))}catch{return false}}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!projectById(id))return NextResponse.json({error:"Project not found"},{status:404});
 if(!process.env.MODEL_API_KEY)return NextResponse.json({error:"Configure MODEL_API_KEY to run cited product research."},{status:503});
 if(process.env.ENABLE_EXTERNAL_PROCESSING!=="true"||process.env.ENABLE_WEB_SEARCH!=="true")return NextResponse.json({error:"Product research is disabled. After reviewing privacy and search behavior, enable ENABLE_EXTERNAL_PROCESSING=true and ENABLE_WEB_SEARCH=true."},{status:403});
 const body=await req.json().catch(()=>({})),findingId=String(body.findingId||""),finding=db.prepare("SELECT * FROM findings WHERE id=? AND project_id=?").get(findingId,id) as any;
 if(!finding||!["accepted","edited"].includes(finding.state))return NextResponse.json({error:"Research is available only for a user-confirmed equipment or technical finding."},{status:400});
 if(!["equipment","technical"].includes(finding.kind))return NextResponse.json({error:"Choose an equipment identity or technical finding."},{status:400});
 const jobId=startLiveJob(id,finding.evidence_id||null);
 const model=process.env.META_MODEL||"muse-spark-1.3",base=(process.env.META_API_BASE_URL||"https://api.meta.ai/v1").replace(/\/$/,""),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
 try{
  await verifyModel(fetch,base,process.env.MODEL_API_KEY,model,controller.signal,"web_search");
  const prompt=`Find product documentation/specifications for this user-confirmed candidate: ${finding.title}. Context: ${finding.edited_detail||finding.detail}. Search the web; prefer the manufacturer's official domain. Do not invent sources or claim specifications not supported by retrieved pages. Summarize only what can be attributed to sources and distinguish official manufacturer documents from third parties.`;
  const response=await requestWithRetry(fetch,`${base}/responses`,{method:"POST",headers:{Authorization:`Bearer ${process.env.MODEL_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model,input:[{role:"user",content:[{type:"input_text",text:prompt}]}],tools:[{type:"web_search",search_context_size:"medium"}],include:["web_search_call.results"],max_output_tokens:1800}),signal:controller.signal});
  const payload=await response.json(),summary=extractOutputText(payload);const collected=new Map<string,{url:string;title:string;excerpt:string}>();
  for(const item of payload.output||[])if(item.type==="web_search_call")for(const source of item.results||[])if(typeof source.url==="string"&&safeUrl(source.url))collected.set(source.url,{url:source.url,title:String(source.title||source.url).slice(0,300),excerpt:String(source.snippet||"").slice(0,1400)});
  for(const item of payload.output||[])if(item.type==="message")for(const block of item.content||[])for(const a of block.annotations||[])if(a.type==="url_citation"&&safeUrl(String(a.url||""))&&!collected.has(a.url))collected.set(a.url,{url:a.url,title:String(a.title||a.url).slice(0,300),excerpt:summary.slice(Math.max(0,a.start_index||0),Math.min(summary.length,a.end_index||summary.length)).slice(0,1400)});
  if(!collected.size){const message="Meta did not return retrievable citations for this query; no research source was saved.";updateLiveJob(jobId,"failed",4,message);return NextResponse.json({error:message,unavailable:true,retryable:true},{status:424})}
  const now=new Date().toISOString(),insert=db.prepare("INSERT INTO external_sources(id,project_id,finding_id,url,title,publisher_type,excerpt,retrieved_at,review_state) VALUES(?,?,?,?,?,?,?,?,?)"),exists=db.prepare("SELECT id FROM external_sources WHERE finding_id=? AND url=?");for(const source of collected.values())if(!exists.get(findingId,source.url))insert.run(randomUUID(),id,findingId,source.url,source.title,likelyManufacturer(source.url,finding.title)?"manufacturer_candidate":"third_party",source.excerpt,now,"suggested");
  db.prepare("INSERT INTO audit_events(project_id,finding_id,action,previous_state,new_state,note,created_at) VALUES(?,?,?,?,?,?,?)").run(id,findingId,"research","confirmed","confirmed",`Retrieved ${collected.size} cited web source(s); summary: ${summary.slice(0,700)}`,now);
  updateLiveJob(jobId,"complete",8,"",{4:`Meta web_search returned ${collected.size} cited result(s); saved with retrieval timestamps.`});return NextResponse.json({summary,retrievedAt:now,sources:[...collected.values()].map(s=>({url:s.url,title:s.title,publisherType:likelyManufacturer(s.url,finding.title)?"manufacturer_candidate":"third_party"}))});
 }catch(error:any){const message=error?.name==="AbortError"?"Product research timed out; retry the research step.":String(error?.message||"Product research failed.");updateLiveJob(jobId,"failed",1,message);return NextResponse.json({error:message,retryable:error?.retryable??true},{status:error?.status||502})}finally{clearTimeout(timer)}
}
