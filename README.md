# Atelier Énergie — building audit preparation

A local-first, image-first workspace for collecting building evidence, reviewing traceable suggestions, and preparing a structured audit dossier. It is **not** a certified energy audit and does not implement formal French/EU compliance calculations.

## Quick start (local)

Prerequisites: Node.js 24+ and npm (the app uses Node's built-in SQLite module).

```powershell
Copy-Item .env.example .env
npm.cmd install
npm.cmd run dev
```

Open <http://localhost:3000>. Example evidence is shown as an optional visual guide only; it is never added to a project or processed. Create a project to start. To create a production build, run `npm.cmd run build` then `npm.cmd start`. On PowerShell, use `npm.cmd` if local execution policy blocks `npm.ps1`.

## Docker

Install Docker Desktop, copy `.env.example` to `.env` (optional for demo), then:

```sh
docker compose up --build
```

Open <http://localhost:3000>. `auditor_data` stores the SQLite database and `auditor_uploads` stores source files; both persist across container restarts. Verify readiness at `/api/health`. For devcontainers, open the repository in VS Code with the Dev Containers extension; the devcontainer Compose override mounts the source and runs the development server on forwarded port 3000.

## Meta Model API (optional)

No credential is generated or needed for demo/local fixture use. On the server, set `MODEL_API_KEY` to the key you obtain from Meta; optionally set `META_MODEL` to an available, documented Muse Spark/Wonder model and `META_API_BASE_URL` (default `https://api.meta.ai/v1`). `META_REASONING_EFFORT` accepts `low`, `medium` (default), `high`, or `max`; `max` is accepted only for `muse-spark-1.3` and `muse-wonder-1.0`. Reasoning tokens add latency and cost, so use higher effort only when the evidence warrants it. The live-analysis action is deliberately gated: set `ENABLE_EXTERNAL_PROCESSING=true` only after reading the privacy notice in the app. The API key is never returned to browser code. Live calls check the configured ID against `GET /v1/models` and its detail endpoint, route only documented multimodal Muse Spark/Wonder model IDs to image/PDF analysis and structured output, send only the selected uploaded item to `POST /v1/responses`, request documented `reasoning.effort` and Responses `text.format` JSON Schema output, validate it again with Zod, and retry transient 429/5xx/network failures. No private chain-of-thought is requested or stored. Each attempt and its stage/error state is persisted; retry the same evidence without re-uploading. Errors/timeouts are visible and the local file is retained. The API model catalogue and account availability can change; verify the currently supported options in [Meta's reasoning docs](https://dev.meta.ai/docs/reasoning/) and [API docs](https://dev.meta.ai/docs/api-reference/).

To enable product research, also set `ENABLE_WEB_SEARCH=true`. After accepting an equipment/technical finding, use **Research cited product sources**. The app sends only the confirmed candidate's text (not building images/documents) to the Meta Responses `web_search` tool, stores returned source URLs, titles, excerpts and retrieval timestamps, and marks possible manufacturer-domain matches versus third-party sources. If search is off, unconfigured, or returns no citations, the UI reports research unavailable; it does not invent sources. Findings and sources remain suggestions pending auditor review.

## Evidence, privacy, and limits

Supported uploads: JPEG, PNG, WebP, GIF and PDF, up to `MAX_UPLOAD_MB` (default 25 MB) each. Batch uploads preserve `eq_*` filename labels as hints. Local classification is based on MIME type and filename and is explicitly not presented as model extraction. PDFs are rendered page-by-page in the browser with PDF.js so normalized overlays share the actual page canvas bounds. For PDF visual handling, Meta documents up to 50 retained page images and text extraction from the first 100 pages; the UI preserves returned page number and normalized region, flags scale as unverified, and makes detections editable. Fixture plan overlays are explicitly illustrative. For live analysis, the chosen evidence file is sent to Meta's configured endpoint only after an explicit user action and server opt-in. Do not upload documents unless you are authorized to process them externally.

The initial architecture assumes one local app instance and one local filesystem volume; it is not a distributed or multi-user deployment. Uploaded data is stored outside SQLite. Delete projects from the app to remove their uploaded files and associated records. Previously seeded demo rows are hidden from active project lists and inaccessible through project APIs; new databases are not seeded with fixture evidence.

### Backup and restore

Stop the app/container before copying both stores for a consistent backup. Back up the `DATA_DIR` directory (SQLite database, including WAL files) and `UPLOAD_DIR` together. In Docker, stop with `docker compose down`, then archive both named volumes (or use your Docker backup policy). Restore both to their matching locations before starting the app. Never back up only the database if you need evidence files.

## Checks and troubleshooting

```sh
npm test
npm run smoke # app must already be running at localhost:3000
npm run browser:test # production build required; Chrome/Edge must be installed
npm run db:init
npm run build
```

The offline test suite covers mocked analysis/research route requests, persisted citations, malformed/provider failures and retries, response schema validation, model capabilities, review provenance, and normalized plan-region bounds. The smoke run verifies the missing-key response without calling Meta. `browser:test` launches an isolated local production server with Chrome/Edge, checks normalized overlay geometry on a demo image, renders a generated PDF page with PDF.js and checks its overlay alignment, then removes temporary database/files. Set `CHROME_PATH` if the browser executable is not at the default Windows Chrome path. PDF overlays use the rendered page canvas, not the browser-native PDF viewer.

- `node:sqlite is not available`: use Node.js 24 or later.
- API reports missing credentials: set `MODEL_API_KEY` on the server and restart; the app remains usable offline.
- Live processing is disabled: set `ENABLE_EXTERNAL_PROCESSING=true` only after deciding to send selected files to Meta.
- Upload errors: check supported MIME type and the `MAX_UPLOAD_MB` limit.
- Health endpoint is `/api/health`; uploads live in `UPLOAD_DIR`, and the DB lives in `DATA_DIR`.
