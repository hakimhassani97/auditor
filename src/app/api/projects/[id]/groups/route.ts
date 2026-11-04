import {NextResponse} from "next/server";
import {db,projectById} from "@/lib/db";
import {randomUUID} from "node:crypto";
export const runtime="nodejs";
const types=new Set(["equipment","plan","building","documents","other"]);
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){const {id}=await params;if(!projectById(id))return NextResponse.json({error:"Project not found"},{status:404});const body=await req.json().catch(()=>({})),name=typeof body.name==="string"?body.name.trim().slice(0,80):"",groupType=types.has(body.groupType)?body.groupType:"equipment";if(!name)return NextResponse.json({error:"A group name is required."},{status:400});const groupId=randomUUID(),now=new Date().toISOString();db.prepare("INSERT INTO evidence_groups(id,project_id,name,group_type,created_at) VALUES(?,?,?,?,?)").run(groupId,id,name,groupType,now);return NextResponse.json({id:groupId,name,group_type:groupType,evidence_count:0},{status:201})}
