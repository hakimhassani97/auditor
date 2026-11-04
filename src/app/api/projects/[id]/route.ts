import { NextResponse } from "next/server";
import { db, projectDetail } from "@/lib/db";
import fs from "node:fs";
import path from "node:path";
export const runtime = "nodejs";
export async function GET(_: Request, { params }: { params: Promise<{id:string}> }) { const {id}=await params; const data=projectDetail(id); return data ? NextResponse.json(data) : NextResponse.json({error:"Project not found"},{status:404}); }
export async function DELETE(_: Request, { params }: { params: Promise<{id:string}> }) {
 const {id}=await params; const files=db.prepare("SELECT stored_path FROM evidence WHERE project_id=?").all(id) as {stored_path:string}[];
 for(const f of files) if(!f.stored_path.startsWith("/demo/")){ const target=path.resolve(process.env.UPLOAD_DIR||"./storage/uploads", f.stored_path); if(target.startsWith(path.resolve(process.env.UPLOAD_DIR||"./storage/uploads"))) try{fs.unlinkSync(target)}catch{} }
 const result=db.prepare("DELETE FROM projects WHERE id=? AND demo=0").run(id); return result.changes ? NextResponse.json({ok:true}) : NextResponse.json({error:"Demo project cannot be deleted."},{status:400});
}
