import { NextResponse } from "next/server";
import { db, projectById } from "@/lib/db";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { startLiveJob, updateLiveJob } from "@/lib/workflow";
import { buildAnalysisRequest, extractOutputText, parseAnalysis, requestWithRetry, verifyModel } from "@/lib/meta-provider";
export const runtime="nodejs";
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; if(!projectById(id))return NextResponse.json({error:"Project not found"},{status:404});
 if(!process.env.MODEL_API_KEY)return NextResponse.json({error:"Configure MODEL_API_KEY on the server before live processing."},{status:503});
 if(process.env.ENABLE_EXTERNAL_PROCESSING!=="true")return NextResponse.json({error:"External processing is disabled. Set ENABLE_EXTERNAL_PROCESSING=true after reviewing the privacy notice."},{status:403});
 const body=await req.json().catch(()=>({})), evidenceId=String(body.evidenceId||""); const evidence=db.prepare("SELECT * FROM evidence WHERE id=? AND project_id=?").get(evidenceId,id) as any;
 if(!evidence||evidence.stored_path.startsWith("/demo/"))return NextResponse.json({error:"Select a real uploaded file; demo fixtures are not sent externally."},{status:400});
  const jobId=startLiveJob(id,evidenceId);db.prepare("UPDATE evidence SET status='running' WHERE id=?").run(evidenceId);
 const model=process.env.META_MODEL||"muse-spark-1.3"; const base=(process.env.META_API_BASE_URL||"https://api.meta.ai/v1").replace(/\/$/,"");
 const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),60000);
 try {
   await verifyModel(fetch,base,process.env.MODEL_API_KEY,model,controller.signal,evidence.mime==="application/pdf"?"pdf":"image");
  const full=path.resolve(process.env.UPLOAD_DIR||"./storage/uploads",id,evidence.stored_path); const bytes=await fs.readFile(full);
   const content:any[]=[{type:"input_text",text:"Inspect this building audit evidence. Do not guess missing data. Identify only visible/readable facts and express uncertainty in each detail. Return cautious findings. For plans, give page detections as normalized x,y,width,height in [0,1], where (0,0) is top-left; do not imply scale or verified dimensions. PDF visual page availability is limited by the provider: report only pages actually visible in this request."}];
  const dataUrl=`data:${evidence.mime};base64,${bytes.toString("base64")}`;
  content.push(evidence.mime==="application/pdf"?{type:"input_file",filename:evidence.filename,file_data:dataUrl}:{type:"input_image",image_url:dataUrl});
   const response=await requestWithRetry(fetch,`${base}/responses`,{method:"POST",headers:{Authorization:`Bearer ${process.env.MODEL_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify(buildAnalysisRequest(model,content)),signal:controller.signal});
   const payload=await response.json(), parsed=parseAnalysis(extractOutputText(payload));const now=new Date().toISOString();
   db.exec("BEGIN IMMEDIATE;");try{db.prepare("DELETE FROM findings WHERE evidence_id=? AND origin='meta_suggestion' AND state='suggested'").run(evidenceId);db.prepare("DELETE FROM plan_detections WHERE evidence_id=? AND origin='meta_suggestion' AND state='suggested'").run(evidenceId);db.prepare("UPDATE evidence SET category=?,status='complete' WHERE id=?").run(parsed.category,evidenceId);
    const ins=db.prepare("INSERT INTO findings(id,project_id,evidence_id,title,detail,kind,origin,confidence,state,source_ref,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)");for(const f of parsed.findings)ins.run(randomUUID(),id,evidenceId,f.title,f.detail,f.kind,"meta_suggestion",f.confidence,"suggested",`${evidence.filename} · Meta model ${model} · ${now}`,now);
    const detection=db.prepare("INSERT INTO plan_detections(id,project_id,evidence_id,page_number,label,x,y,width,height,confidence,origin,state,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)");for(const d of parsed.detections)detection.run(randomUUID(),id,evidenceId,d.pageNumber,d.label,d.x,d.y,d.width,d.height,d.confidence,"meta_suggestion","suggested",now);db.exec("COMMIT;");
   }catch(error){db.exec("ROLLBACK;");throw error}
   updateLiveJob(jobId,"complete",8);return NextResponse.json({ok:true,model,category:parsed.category,count:parsed.findings.length,detections:parsed.detections.length});
  }catch(e:any){const message=e?.name==="AbortError"?"Meta request timed out; retry this step.":String(e?.message||"Meta processing failed");db.prepare("UPDATE evidence SET status='error' WHERE id=?").run(evidenceId);updateLiveJob(jobId,"failed",1,message);return NextResponse.json({error:message,jobId,retryable:e?.retryable??true},{status:e?.status||502})}finally{clearTimeout(timer)}
}
