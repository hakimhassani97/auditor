import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const runtime = "nodejs";
export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params, body=await req.json().catch(()=>({})); const finding=db.prepare("SELECT * FROM findings WHERE id=?").get(id) as any;
 if(!finding)return NextResponse.json({error:"Finding not found"},{status:404});
 const action=String(body.action||""); if(!["accept","reject","edit"].includes(action))return NextResponse.json({error:"Action must be accept, reject, or edit."},{status:400});
 const title=typeof body.title==="string"?body.title.trim().slice(0,200):finding.title, detail=typeof body.detail==="string"?body.detail.trim().slice(0,2000):finding.detail;
 const state=action==="accept"?"accepted":action==="reject"?"rejected":"edited"; const now=new Date().toISOString();
 db.prepare("UPDATE findings SET state=?,edited_title=?,edited_detail=? WHERE id=?").run(state,action==="edit"?title:null,action==="edit"?detail:null,id);
 db.prepare("INSERT INTO audit_events(project_id,finding_id,action,previous_state,new_state,note,created_at) VALUES(?,?,?,?,?,?,?)").run(finding.project_id,id,action,finding.state,state,action==="edit"?`Edited: ${title}`:"",now);
 return NextResponse.json({ok:true,state});
}
