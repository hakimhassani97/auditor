import { NextResponse } from "next/server";
import { db, projectById } from "@/lib/db";
import { recordJob } from "@/lib/workflow";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
export const runtime = "nodejs";
export const maxDuration = 60;
const allowed = new Set(["image/jpeg","image/png","image/webp","image/gif","application/pdf"]);
export async function POST(req: Request,{params}:{params:Promise<{id:string}>}) {
 const {id}=await params; if(!projectById(id)) return NextResponse.json({error:"Project not found"},{status:404});
 const form=await req.formData(); const files=form.getAll("files").filter((f):f is File=>f instanceof File); const labels=form.getAll("labels").map(x=>String(x));
 if(!files.length) return NextResponse.json({error:"Choose at least one file."},{status:400});
 const max=Number(process.env.MAX_UPLOAD_MB||25)*1024*1024, dir=path.resolve(process.env.UPLOAD_DIR||"./storage/uploads",id); await fs.mkdir(dir,{recursive:true});
 const accepted=[] as any[], errors=[] as any[];
 for(let i=0;i<files.length;i++) { const f=files[i]; if(!allowed.has(f.type)){errors.push({filename:f.name,error:"Unsupported file type. Use JPG, PNG, WebP, GIF or PDF."});continue} if(f.size>max){errors.push({filename:f.name,error:`File exceeds ${Math.round(max/1024/1024)} MB limit.`});continue}
  const buffer=Buffer.from(await f.arrayBuffer()), ext=path.extname(f.name).replace(/[^.a-zA-Z0-9]/g,"").slice(0,12), stored=`${randomUUID()}${ext}`; await fs.writeFile(path.join(dir,stored),buffer,{flag:"wx"});
  const evidenceId=randomUUID(), now=new Date().toISOString(), label=(labels[i]||"").slice(0,80);
  db.prepare("INSERT INTO evidence(id,project_id,filename,label,mime,size,stored_path,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)").run(evidenceId,id,f.name.slice(0,255),label,f.type,f.size,stored,"processing",now);
  recordJob(id,evidenceId); accepted.push({id:evidenceId,filename:f.name,label,status:"complete"});
 }
 return NextResponse.json({accepted,errors,liveAvailable:Boolean(process.env.MODEL_API_KEY),message:process.env.MODEL_API_KEY?"Local classification completed. Explicitly enable live processing for Meta analysis.":"Saved and processed locally. Configure MODEL_API_KEY to enable live Meta processing."},{status:accepted.length?201:400});
}
