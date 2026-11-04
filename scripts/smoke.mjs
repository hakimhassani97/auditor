const base = process.env.BASE_URL || "http://localhost:3000";
const check = (condition, label) => { console.log(`${condition ? "PASS" : "FAIL"} ${label}`); if (!condition) process.exitCode = 1; };
const health = await fetch(`${base}/api/health`);
check(health.ok && (await health.json()).ready, "health and SQLite readiness");
const page = await fetch(base);
check(page.ok && (await page.text()).includes("Les Ateliers du Canal"), "browser workspace serves seeded demo");
const noKey = await fetch(`${base}/api/projects/demo-ateliers/process`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({evidenceId:"demo-eq1"})});
check(noKey.status === 503 && (await noKey.json()).error.includes("MODEL_API_KEY"), "live analysis reports actionable missing-key state without sending evidence");
let projectId;
try {
  const created = await fetch(`${base}/api/projects`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({name:"Smoke test project"}) });
  const project = await created.json(); projectId = project.id;
  check(created.status === 201 && Boolean(projectId), "create project");
  const form = new FormData(); form.append("files", new Blob(["fixture-bytes"], {type:"image/jpeg"}), "eq_11_unit.jpg"); form.append("labels", "eq_11");
  const uploaded = await fetch(`${base}/api/projects/${projectId}/upload`, {method:"POST",body:form}); const upload = await uploaded.json();
  check(uploaded.status === 201 && upload.accepted?.[0]?.label === "eq_11", "batch evidence upload retains eq_* label");
  const detailResponse = await fetch(`${base}/api/projects/${projectId}`); const detail = await detailResponse.json();
  check(detailResponse.ok && detail.evidence.length === 1 && detail.jobs[0]?.provider === "local_fixture", "persist evidence and local processing job");
  const reportResponse = await fetch(`${base}/api/projects/${projectId}/report`, {method:"POST"}); const report = await reportResponse.json();
  check(reportResponse.ok && report.status.includes("not a certified") && report.calculations.includes("not implemented"), "report labels audit scope and missing methodology");
} finally {
  if (projectId) { const removed = await fetch(`${base}/api/projects/${projectId}`,{method:"DELETE"}); check(removed.ok,"delete project and its stored evidence"); }
}
