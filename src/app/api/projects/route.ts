import { NextResponse } from "next/server";
import { allProjects, db } from "@/lib/db";
import { randomUUID } from "node:crypto";
export const runtime = "nodejs";
export async function GET() { return NextResponse.json(allProjects()); }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
  if (!name) return NextResponse.json({ error: "A project name is required." }, { status: 400 });
  const id = randomUUID(); db.prepare("INSERT INTO projects(id,name,address,demo,created_at) VALUES(?,?,?,?,?)").run(id, name, String(body.address || "").slice(0, 300), 0, new Date().toISOString());
  return NextResponse.json({ id }, { status: 201 });
}
