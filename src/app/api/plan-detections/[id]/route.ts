import {NextResponse} from "next/server";
import {db} from "@/lib/db";
import {z} from "zod";
export const runtime="nodejs";
const patchSchema=z.object({action:z.enum(["edit","accept","reject"]),label:z.string().trim().min(1).max(120).optional(),pageNumber:z.number().int().min(1).max(100).optional(),x:z.number().min(0).max(1).optional(),y:z.number().min(0).max(1).optional(),width:z.number().gt(0).max(1).optional(),height:z.number().gt(0).max(1).optional()}).strict();
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params,body=await req.json().catch(()=>null),parsed=patchSchema.safeParse(body);if(!parsed.success)return NextResponse.json({error:"Invalid detection update",details:parsed.error.issues},{status:400});
 const old=db.prepare("SELECT d.*,e.filename FROM plan_detections d JOIN evidence e ON e.id=d.evidence_id WHERE d.id=?").get(id) as any;if(!old)return NextResponse.json({error:"Plan detection not found"},{status:404});const input=parsed.data;
 const next={label:input.label??old.label,pageNumber:input.pageNumber??old.page_number,x:input.x??old.x,y:input.y??old.y,width:input.width??old.width,height:input.height??old.height};
 if(next.x+next.width>1||next.y+next.height>1)return NextResponse.json({error:"Region must remain within the page (normalized 0–1 coordinates)."},{status:400});
 const state=input.action==="accept"?"accepted":input.action==="reject"?"rejected":"edited",now=new Date().toISOString();
 db.exec("BEGIN IMMEDIATE;");try{db.prepare("UPDATE plan_detections SET label=?,page_number=?,x=?,y=?,width=?,height=?,state=?,updated_at=? WHERE id=?").run(next.label,next.pageNumber,next.x,next.y,next.width,next.height,state,now,id);db.prepare("INSERT INTO audit_events(project_id,finding_id,action,previous_state,new_state,note,created_at) VALUES(?,NULL,?,?,?,?,?)").run(old.project_id,`plan_${input.action}`,old.state,state,`${old.filename||"Plan"} · page ${next.pageNumber} · ${next.label} · region ${next.x.toFixed(3)},${next.y.toFixed(3)},${next.width.toFixed(3)},${next.height.toFixed(3)}`,now);db.exec("COMMIT;")}catch(error){db.exec("ROLLBACK;");throw error}
 return NextResponse.json({ok:true,state,provenance:{filename:old.filename,pageNumber:next.pageNumber,origin:old.origin,confidence:old.confidence}});
}
