import { NextResponse } from "next/server";
import { db } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET() { try { db.prepare("SELECT 1").get(); return NextResponse.json({ status: "ok", ready: true, database: "local-sqlite", metaConfigured: Boolean(process.env.MODEL_API_KEY) }); } catch { return NextResponse.json({ status: "not_ready", ready: false }, { status: 503 }); } }
