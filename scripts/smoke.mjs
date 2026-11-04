const base = process.env.BASE_URL || "http://localhost:3000";
const check = (condition, label) => { console.log(`${condition ? "PASS" : "FAIL"} ${label}`); if (!condition) process.exitCode = 1; };
const health = await fetch(`${base}/api/health`);
check(health.ok && (await health.json()).ready, "health and SQLite readiness");
const page = await fetch(base);
const pageHtml=await page.text();
check(page.ok && (/Atelier|Projects|building audit/i.test(pageHtml) || pageHtml.includes("Create your first project")), "browser workspace serves project navigation, without seeded fixture evidence");
const listed = await fetch(`${base}/api/projects`);const initialProjects=await listed.json();
check(listed.ok && initialProjects.every((p)=>p.demo===0) && !initialProjects.some((p)=>p.id==="demo-ateliers"), "example fixtures are excluded from active project list");
const noKey = await fetch(`${base}/api/projects/demo-ateliers/process`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({evidenceId:"demo-eq1"})});
check(noKey.status === 404, "legacy demo project cannot enter processing workflow");
let projectId;
try {
  const created = await fetch(`${base}/api/projects`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:"Smoke test project"}) });
  const project = await created.json(); projectId = project.id;
  check(created.status === 201 && Boolean(projectId), "create project");
  const groupResponse=await fetch(`${base}/api/projects/${projectId}/groups`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:"Heat pump 1",groupType:"equipment"})});const group=await groupResponse.json();
  check(groupResponse.status===201,"create evidence group");
  const form = new FormData(); form.append("files", new Blob(["fixture-bytes"], {type:"image/jpeg"}), "eq_11_unit.jpg"); form.append("labels", "eq_11");
  const uploaded = await fetch(`${base}/api/projects/${projectId}/upload`, {method:"POST",body:form}); const upload = await uploaded.json();
  check(uploaded.status === 201 && upload.accepted?.[0]?.label === "eq_11", "batch evidence upload retains eq_* label");
  const evidenceId=upload.accepted?.[0]?.id;const moved=await fetch(`${base}/api/projects/${projectId}/evidence/${evidenceId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({groupId:group.id})});
  check(moved.ok,"assign evidence to a group");
  const detailResponse = await fetch(`${base}/api/projects/${projectId}`); const detail = await detailResponse.json();
  check(detailResponse.ok && detail.evidence.length === 1 && detail.evidence[0].group_id===group.id && detail.jobs[0]?.provider === "local_fixture", "persist grouped evidence and local processing job");
  const reportResponse = await fetch(`${base}/api/projects/${projectId}/report`, {method:"POST"}); const report = await reportResponse.json();
  check(reportResponse.ok && report.status.includes("not a certified") && report.calculations.includes("not implemented"), "report labels audit scope and missing methodology");
} finally {
  if (projectId) { const removed = await fetch(`${base}/api/projects/${projectId}`,{method:"DELETE"}); check(removed.ok,"delete project and its stored evidence"); }
}
