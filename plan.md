# Goal: Deliver a browser-ready, AI-assisted building energy-audit workspace

Build a complete, runnable web application in this repository that lets a building auditor create a project, upload equipment photos and nameplate/specification-sheet images, floor-plan PDFs or images, and exterior/building photos, then automatically turns that evidence into a reviewable, traceable building dossier and audit-preparation output. The finished project must start locally and through Docker, open in a browser, and demonstrate the full upload-to-review workflow. The user will supply the Meta API key after implementation; never require, invent, commit, or expose a real key.

## Product outcome and user experience

Create an image-first evidence workspace with a distinctive, polished blue visual identity. Take inspiration from Instagram's approachable visual browsing and image presentation, but do not copy its branding or screens. Avoid generic AI-chat layouts, boilerplate admin dashboards, excessive gradients, and form-heavy flows. The main action is to create a project and add a batch of evidence; the app should do the organizing and analysis, with the user primarily accepting, editing, or rejecting proposed findings.

The core browser journey must be usable from beginning to end:

1. Create a project with minimal required input (project/building name; address is optional).
2. Drag in or select multiple equipment photos, close-up nameplates, technical sheets, floor-plan PDFs/images, and building/exterior images. Preserve optional labels such as `eq_11`, `eq_12`, `eq_21`, and `eq_22` as user hints; do not require a detailed form per upload.
3. See upload progress, previews, processing status, and any errors. Processing must be resumable/retryable and must not require re-uploading files after a transient model/API failure.
4. Review an evidence-linked dossier. Show proposed equipment identity, manufacturer/model candidates, extracted technical properties, plan detections, and building observations as suggestions with confidence/uncertainty and source references. Make conflicts and missing information visible. Support accept, edit, reject, and merge where relevant.
5. View a clear project summary and audit-preparation output that separates confirmed facts, user edits, model suggestions, external-source information, assumptions, and missing data. Do not claim the output is a certified or legally complete energy audit unless the applicable methodology and required inputs have been explicitly established and implemented.

Keep navigation focused (for example: Projects, Evidence, Review, Report). The Projects navigation item must be interactive and open a useful project list with project summaries/counts and clear project selection/creation actions; no visible navigation control should be a no-op. Make the next useful action obvious, support laptop and narrow-screen layouts, and communicate state with text/icons as well as color. Provide accessible labels, keyboard operation, and readable contrast.

### Evidence organization and feedback

- Let auditors regroup uploaded evidence with intuitive drag-and-drop collections/groups (for example, multiple photos and nameplates for one piece of equipment, separate equipment items, floor plans, and exterior/building photos). Preserve source files and labels, make group membership editable, and provide an accessible non-drag alternative such as a “Move to group” control.
- Show useful previews and source thumbnails for each finding in review, not only filenames; allow the auditor to open or inspect the linked source image/document and relevant page/region.
- Provide visible, per-task/per-file loading and completion states for uploads, processing, research, and report generation. Communicate what is waiting or running, when it finishes, and actionable errors/retry options. Persist progress so users can understand failures and resume without re-uploading.

## Automated evidence and AI capabilities

Implement an end-to-end, persisted processing workflow that can independently retry failed steps. Use explicit, observable stages such as upload validation, file/page classification, text and visual extraction, equipment/evidence grouping, product research, plan interpretation, consistency checks, and dossier generation. Persist job state, errors, timestamps, and references between stages so a failed item does not invalidate an entire project.

Use Meta models through `dev.meta.ai` as the primary generative/vision provider. Before choosing models or promising capabilities, inspect the actual available API documentation/configuration and verify supported model IDs, authentication, image/PDF handling, structured outputs, limits, and errors. Implement a provider adapter and capability-based routing so each task uses a compatible available model. Use multiple Meta models where their distinct capabilities or measured cross-checking improve a task; do not call models redundantly merely to maximize model count. Validate model outputs against schemas, handle timeouts/rate limits, and expose clear failures. Do not hardcode an assumed model name or API behavior that has not been verified.

The AI workflow must, where supported by the verified provider capabilities:

- Classify uploads and PDF pages (equipment, nameplate, technical document, plan, building photo, unknown) and detect likely duplicates.
- Read equipment nameplates and technical sheets; return structured candidate identity and technical fields while retaining the source file/page and image region when available.
- Associate multiple photos/documents with likely equipment, preserve `eq_*` labels as hints, flag uncertain matches and conflicting values, and avoid silently merging ambiguous items.
- Analyze floor-plan PDFs/images: render and navigate pages, extract text/labels/dimensions, identify likely rooms and relevant symbols or zones, and display detections as editable overlays. Retain page/region provenance and indicate uncertain scale, dimensions, and interpretations; never present a guessed scale as verified measurement.
- Analyze building/exterior photos for useful audit observations as suggestions tied to their source images.
- Search the internet for candidate manufacturer/model documentation and relevant product specifications through a documented, configurable search integration. Save source URL, title, retrieval date, and relevant extracted evidence; prefer manufacturer sources and mark third-party sources. If no search API is available/configured, show that research is unavailable rather than fabricate search results.
- Produce a concise, structured dossier/report draft from accepted and clearly labeled unconfirmed findings, not an untraceable free-form answer.

Use deterministic code for calculations and validation wherever feasible; do not ask an LLM to perform authoritative arithmetic. Only implement calculations that can be tied to a defined, applicable French/EU audit methodology and version. If the exact audit scope or methodology is not present in the repository requirements, provide audit-preparation outputs, make assumptions/data gaps explicit, and keep formal compliance calculations clearly marked as not implemented rather than inventing rules.

All generated facts must preserve provenance: originating upload and page/region where possible, extraction step/provider/model, timestamp, confidence or uncertainty, external source if applicable, review state, and user edits. Distinguish measured, extracted, inferred, externally sourced, user-confirmed, and unknown information. Keep an audit trail of review actions.

## Application architecture and data

Use React with Next.js and TypeScript for the web application. Use SQLite with migrations for local project data. Store uploaded files on a configurable persistent filesystem volume rather than in SQLite; store their metadata and managed paths in the database. Keep database and file handling behind clear service/repository boundaries. The initial deployment may assume one app instance and local persistent storage; document that boundary rather than implying distributed multi-user scalability.

Model at minimum projects, uploaded files/pages, processing jobs/steps, equipment candidates, extracted facts, evidence/source references, plan detections, review decisions, and report outputs. Ensure failures or deletion do not leave misleading orphaned records. Provide project/file deletion behavior and document backup/restore for both SQLite and uploads.

Keep external integrations behind adapters (Meta model API and web search). Configure secrets and service settings only through environment variables. Include `.env.example` with safe placeholders and clear setup guidance; ensure `.env` and secrets are ignored by version control. The app must remain startable without a real API key and show an actionable “configure API key” state for live AI processing.

Demo fixtures are examples/hints that explain what useful evidence can look like; they must not be treated as evidence belonging to an auditor's real project, included in a real dossier/report, sent for live processing, or confused with user uploads. Present examples in a clearly separate, optional “Example evidence”/help area or equivalent. Keep fixtures explicitly identified as illustrative; do not seed them into the ordinary active-project workflow as usable evidence.

Treat uploaded building documents and images as potentially sensitive. Explain which content is sent to configured external services, send only what is needed, do not log API keys or unnecessary file contents, and provide a way to delete a project and its stored evidence. Do not send evidence to external services before the user has configured and knowingly enabled those integrations.

## Setup and delivery requirements

Deliver a working repository including a Dockerfile, Docker Compose configuration, persistent volumes for SQLite and uploads, health/readiness behavior, `.devcontainer/devcontainer.json` (and Compose configuration if needed), `.env.example`, database migrations/initialization, and a README. Document prerequisites, environment variables, local startup, Docker startup, devcontainer use, API-key setup, demo mode, storage location, backup/restore, and troubleshooting. The first-run workflow should be short and explicit: copy `.env.example` to `.env`, optionally add the user's Meta key, run the documented command, and open the local browser URL. Do not include or generate a real credential.

Include automated tests for critical data/provenance logic, API/provider error handling, processing retries, schema validation, and deterministic calculations that are implemented. Include a known-good sample/demo project and representative fixtures that make the browser experience demonstrable without network or AI access. Clearly distinguish fixture/demo results from live results in the UI.

## Definition of done

The goal is reached only when all of the following are true:

- The application installs and starts using documented local instructions and Docker Compose; the app and persistent SQLite/upload storage survive container restarts.
- A developer can open the app in a browser without a Meta API key and explore a clearly labeled demo project; adding a key later enables live processing without code changes.
- Demo fixture images are isolated examples only and never enter real project evidence, processing, findings, or reports.
- The Projects sidebar control opens a functional project list; auditors can group/regroup evidence by equipment or evidence type using drag-and-drop and an accessible alternative.
- Review findings display linked evidence thumbnails/previews, and asynchronous operations show clear running, completion, failure, and retry states.
- A user can create a project and batch-upload supported images/PDFs, including files labeled `eq_11`-style, with previews and understandable status/error feedback.
- The workflow produces structured, evidence-linked equipment and document findings and an interactive plan review experience for supported files; unsupported or uncertain input is clearly reported rather than fabricated.
- Users can accept, edit, reject, or resolve findings, and changes/provenance remain visible in the project summary and generated output.
- Meta integration uses verified configurable capabilities, validates structured responses, handles missing configuration and provider failures gracefully, and never exposes secrets to the browser.
- External product research, when configured, cites retrievable sources and dates; when unavailable, the interface states that clearly.
- The report/dossier does not misrepresent unverified AI suggestions as facts or claim formal audit compliance without an implemented methodology and its required data.
- Core tests pass; README, `.env.example`, Docker, and devcontainer setup agree with the actual implementation.
- The visual result is polished, responsive, accessible, image-first, and distinctly designed rather than a generic generated dashboard.
