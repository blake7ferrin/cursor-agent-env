# Memory

Durable facts, preferences, and decisions. The agent updates this file when the user says "remember this" or when it infers something that should persist across sessions.

---

## Cursor product and this repo

- **Agent environment (Cursor dashboard, ~Feb 2025+):** Cursor supports secrets per environment, and views for terminal, desktop, and git. Slack can be connected to launch/control agents from channels (@Cursor). See README for details.
- **Cloud environment override behavior:** If `.cursor/environment.json` exists in repo, it overrides the saved cloud environment. Keep it removed when you want agents to inherit environment secrets configured in Cursor.
- **Slack vs bridge:** Slack is for *controlling* agents from team chat (task/thread-oriented). Telegram and the PWA (bridge) provide a *continuous chat* with one agent (same conversation, same memory). Slack does not replace Telegram/PWA for that use case; they can be used together (Slack for team, bridge for personal chat).
- **User is Cursor-only for now** (no bridge/Telegram/PWA in use yet).
- **Bridge baseline hardening implemented (2026-02-25):** HTTP auth token required, explicit `user_id` required, allowlisted orchestrator dispatch (`SUBAGENT`/`LOCAL_ACTION`), and optional Redis-backed persistence/rate limiting via `REDIS_URL`.
- **Agent → Housecall export (2026-02-26):** When the user chats via the bridge (Telegram or PWA), the agent can send estimates to Housecall Pro by outputting a single line `HOUSECALL_EXPORT: <compact JSON>`. The bridge parses it, injects `user_id` from Telegram/user context, and runs the same logic as `POST /estimator/export/housecall`. Documented in `docs/orchestrator-protocol.md` and `.cursor/skills/hvac-estimator`; HCP API key in Doppler is used by the bridge when executing the export.

## Housecall Pro integration (use this, do not reinvent)

- **Housecall Pro is already wired in the bridge.** The bridge has the HCP API key (from Doppler: `HOUSECALL_PRO_API_KEY` or `HCP_API_KEY`) and implements full estimate export: create, update, add-to-job, auto-upsert from appointment/job/estimate context.
- **When the user asks to send an estimate to Housecall Pro (or "push to HCP" / "create in Housecall" / "send to my CRM") and they are chatting via the bridge (Telegram or PWA):** you **must** use the existing integration. Output a single line:
  - `HOUSECALL_EXPORT: <one-line JSON>`
  - JSON includes: `customer`, `project`, `selections` (or `manual_items`), and optionally `housecall` (e.g. `{"dry_run":true}` for a test run). Omit `user_id` on Telegram—the bridge fills it in.
  - See **docs/orchestrator-protocol.md** (HOUSECALL_EXPORT) and **.cursor/skills/hvac-estimator** for payload shape and examples.
- **Do not** write your own script, call the Housecall API yourself, or say that no integration exists. The integration is in the bridge; your role is to output the `HOUSECALL_EXPORT` line with the right payload. Use dry_run first when the user hasn’t confirmed live send. See **docs/HOUSECALL-AGENT.md** for a short summary.
- **Existing customer:** When sending an estimate, if the user does not provide a Housecall customer ID, the bridge tries to find an existing customer by name, email, or phone (it calls Housecall’s customer list and matches). So the agent should pass `customer: { name: "..." }` (or email/phone when known); the bridge will link to an existing customer when one matches, otherwise create a new one.

## Business automation direction

- User is exploring an HVAC estimator agent that can use full cost inputs (parts/equipment pricing, labor, overhead, profit targets), ingest photos/chat context, and produce CRM estimates or generated estimate PDFs, potentially replacing a traditional static pricebook.
- User wants to evolve this repo toward an MCP-first "AI agent control center" architecture (remote chat/control via PWA + Telegram + tool servers), while keeping Housecall/pricebook workflows central.
- Estimator MVP now exists in `bridge/` (2026-02-25): per-user pricing config + catalog storage, deterministic estimate calculation endpoint, printable HTML output for PDF workflows, and a new `.cursor/skills/hvac-estimator` skill for estimator operation.
- User CRM is **Housecall Pro**; estimator workflows should prioritize direct Housecall export over generic CRM assumptions.
- Housecall workflow must support both updating existing scheduled estimates and adding new estimate options to existing jobs (not just creating brand-new estimates).
- Housecall export now supports auto-upsert target routing (estimate -> appointment context -> job -> create fallback) to reduce tech decision-making in the field.
- Housecall auth env aliases (2026-02-25): bridge accepts both `HOUSECALL_PRO_API_KEY` and `HCP_API_KEY` for static bearer auth; config summary exposes `apiKeySource` for debugging.
- Bluon API evaluation (2026-02-25): strong fit for diagnostics/technical enrichment (model/parts/manuals/tools/warranty/nameplate), but not a primary source for estimate pricing because published API lacks cost/MSRP/labor/overhead/margin fields.
- User’s primary residential replacement brands are **AC Pro** and **Day & Night**; estimator automation should prioritize prebuilt options/templates for these brands first, with other brands handled via quote-assist mode.
- User has full pricebooks/equipment brochures/troubleshooting manuals for AC Pro and Day & Night, with potential access to more brand data; desired workflow is data-plate/photo-led residential automation plus assisted quote workflow for oddball/commercial/other-brand jobs.
- Preferred baseline estimator assumptions (2026-02-25): labor rate = `$125/hr` all-in, tax on purchases ≈ `9%`, no permit/trip defaults for changeouts, target margin `40%`, hard minimum margin `30%`.
- Decision: keep estimator margin model as gross-margin guardrail because labor rate is fully loaded; treat this as the practical net-profit proxy for quoting unless accounting-level net reporting is later added.

## HVAC estimator data ingestion

- Import pipeline (2026-02-25): AC Pro + Day & Night/adders ingestion lives under `bridge/imports/`.
- Upload raw files to `bridge/imports/incoming/`.
- Run `npm run ingest` in `bridge/` (or `POST /ingest` with bridge auth) to validate and build catalog output.
- Canonical run uses `--only CLEAN,ChangeOut_Pricebook` for the cleaned equipment sheet plus changeout pricebook.
- Preferred source profile is now `--profile preferred`: Day & Night Google Sheet XLSX + AC Pro clean/changeout CSVs, while Arizona/A2L/installer-pricing PDFs are tracked as manual reference-only files.
- Preferred Day & Night/AC Pro XLSX source was updated on 2026-03-05 to `bridge/imports/incoming/DayNight_ACPro_AI_Catalog.xlsx` (replacing the old Google Sheet export filename in profile include list).
- XLSX ingestion parser now supports camel-case AI catalog columns (`SystemPrice`, `ModelNumber`, `SystemType`, component price columns) and ingests only `Catalog_All_AI` by default via profile `ignore_sheets` to reduce duplicate rows.
- Output files: `bridge/imports/catalog/equipment-and-adders.json` and `bridge/imports/validation-report.json`.
- Changeout planner runtime (2026-02-25): `POST /estimator/changeout-plan` now auto-loads the ingested `preferred` profile catalog by default, refreshes ingest when report/profile is stale, and can merge imported catalog with user-saved catalog (`include_user_catalog`).
- Estimate runtime (2026-02-25): `POST /estimator/estimate` and estimate-building inside `POST /estimator/export/housecall` now use the same imported-catalog runtime options by default (`catalog_profile=preferred`, `use_imported_catalog=true`, merge + optional refresh), so live estimate/export no longer depends on manual catalog upload.
- Edge-case adder mapping (2026-02-25): planner now attempts keyword-based mapping of install-condition risks (tight attic, crane, curb adapter, etc.) to catalog adders first, then falls back to manual default adders when no direct catalog match exists.
- Installer pricing guardrail patch branch (2026-03-10): `cursor/housecall-pro-heat-pump-options-dd51-plus` adds mini-split base labor (`LABOR-BASIC-MINI-SPLIT-CHANGEOUT`) and semantic overlap suppression so equivalent complexity adders (e.g., line-set/electrical/tight-attic) do not double-stack with installer piece-rate adders.
- Document formatting preference (2026-03-11): user wants mini-split estimates to visually match the HVAC inspection report style (structured sectioned report format rather than generic estimate table styling).
- **Usability:** Improvements and ideas are tracked in **docs/USABILITY.md** (Telegram formatting, Housecall resolution, estimate display, errors). Use it to keep finding and ticking off UX optimizations.
