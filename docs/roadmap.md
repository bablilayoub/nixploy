# Roadmap — winning switchers (drafted 2026-09-17)

## Context

Nixploy is at v0.2.9: at parity with the free tier of the leading self-hosted panels and ahead of them in several places. But parity does not move anyone. Someone running 20 services on a €10 VPS needs a *reason* to migrate and a *way* to do it without losing a weekend. This plan supplies both.

It was built from: a research pass over the competing panels' current feature sets, 12 months of their releases, roadmaps and open PRs; 18 documented pain points with issue links and reaction counts; 33 top-requested features; standout features of 19 adjacent platforms; 22 market trends; a 149-row inventory of what Nixploy ships today; and 113 feature proposals from 8 independent brainstorm lenses, deduplicated to 45 candidates.

**Honesty note on confidence.** The adversarial verification pass (a market skeptic and a feasibility engineer per feature) died on a usage limit after the dedupe. Effort estimates below are brainstorm estimates, not verified ones — treat S/M as reliable and L/XL as "could be worse". What *was* verified, directly in the code, is every load-bearing claim about our current state (each is cited with a path below).

### What the research established

**The incumbent's shape.** The market leader in this class (37k stars, ~55 releases/year) went open-core in 2026-01: **SSO/SAML, SCIM, custom RBAC, audit logs, whitelabel and forward-auth are paid**. Its free tier has 6 builders, per-server build queues, build servers, registry rollbacks, single-app previews from one provider only, a 532-entry template catalogue, 6 database engines, S3-only backups, DNS-provider record automation, secret-manager references, build-time file patches, a Docker networks UI, a generated MCP server and CLI, AI compose and log analysis, passkeys, and service transfer between servers. In flight: log shipping via Vector, object storage, compose replicas, multi-arch builds, external upstream routing.

**Why people leave it, ranked by evidence.** Proxy flakiness (502s until a domain is deleted and recreated); 30 security advisories published in a single day, including member→root RCE and cross-org IDOR; panel RAM of 500 MB–1.25 GB with OOM restarts on 4 GB boxes; updates that brick installs; features paywalled after a community request was closed "not planned"; previews limited to one service kind and one git provider (+51 reactions, *"we would switch if this shipped"*); no pre/post-deploy hooks (+41, *"show stopper"*); deploy status that reports green after the orchestrator rolled back; S3-only unencrypted backups (+28); maintainer bandwidth (700+ open issues, ~190 open PRs, a community fork).

**Why people choose it.** UI polish, lighter than the other big panel, integrated proxy + Let's Encrypt, compose-native, remote-server model, no upsells in the UI, one-click templates, fast release cadence. **This is what Nixploy must not lose to.**

**Nixploy's real, verified gaps** (checked in code today):

| Claim | Evidence |
| --- | --- |
| Can't deploy a specific commit/tag | ~~`application.deploy` took no ref~~ — **fixed 2026-09-17** |
| Compose "Auto deploy" switch is inert | ~~the webhook handler queried `applications` only~~ — **fixed 2026-09-17** |
| Drop/zip source can't be uploaded | ~~readers but no writer~~ — **fixed 2026-09-17** |
| `certificate.autoRenew` does nothing | stored + shown ([certificates-view.tsx:178](../apps/web/src/components/settings/certificates/certificates-view.tsx:178)), zero consumers |
| DNS-01 is half-wired | only the provider *name* reaches `traefik.yml` ([setup.ts:146](../packages/server/src/modules/traefik/setup.ts:146)); credentials never reach the Traefik service |
| Compose rejects what competitors accept | ~~`build:` and host `ports:` refused~~ — **both opt-in since 2026-09-17** |
| REST responses untyped | 0 routers call `.output()` |
| Runtime logs never persisted | `ingestServiceLog` has one caller — the deploy worker on failure, [worker.ts:655](../packages/server/src/modules/deployment/worker.ts:655) |
| SSO is env-only, no UI | [modules/auth/sso.ts](../packages/server/src/modules/auth/sso.ts) reads `NIXPLOY_OIDC_*` |
| Previews need a PR number | `previewDeployment.create` requires `pullRequestNumber` — [preview-deployment.ts:120](../packages/server/src/trpc/routers/preview-deployment.ts:120) |
| Surface coverage | 303 procedures · 97 CLI verbs · 32 MCP tools · 0 GPU refs · 1 passkey ref · no `llms.txt` |
| Measured footprint (live VPS) | panel 427 MiB / Postgres 51 MiB / Traefik 26 MiB ≈ **505 MiB** total |

---

## Strategy

### The thesis

> **Everything the others charge for, free — and a one-command door in.**

Nixploy cannot out-feature a 37k-star project on breadth. It wins on three asymmetries the incumbent structurally cannot answer:

1. **Migration is unclaimed territory.** No panel imports from a rival. The leading panel's data model is a near-mirror of Nixploy's (same hierarchy, same source/build type enums, Swarm + Traefik file provider), so a high-fidelity importer is genuinely feasible — and the moment people are most willing to leave (after a bricked update or an advisory wave) is exactly when a rescue path wins them.
2. **Free governance is a one-line pitch.** Their comparison column literally reads *Enterprise* for SSO, teams, audit and whitelabel. Nixploy already has the hard half — a 27-entry capability catalogue with per-member overrides, org-bound scoped API keys, an audit trail with export and forwarding. What is missing is mostly UI and a teams table.
3. **Agent-native is a two-year bet Nixploy is already ahead on.** 32 MCP tools that dispatch through the real routers (so org scoping, capabilities and audit apply) beat 508 generated OpenAPI wrappers with no guardrails. Converting that lead into annotations, task tools, a skill and `llms.txt` is cheap.

Underneath all three runs a **trust track**, because the loudest churn signal in the research is not a missing feature — it is reliability, security and upgrade safety.

### What we are deliberately not building

Listing these so the backlog stays honest:

- **A second proxy driver (Caddy)** — the most-upvoted request on the incumbent's tracker (+70), but it is *their* problem. Traefik works here; a second driver doubles the routing surface forever.
- **Postgres PITR** (XL) — real value, rare need, enormous surface. Encrypted multi-destination backups with verified restores covers 95% of the anxiety at a fraction of the cost.
- **Object storage / GPU services / autoscaling / scale-to-zero** — good ideas, all L, none of them why anyone switches. Revisit after the door is open.
- **SCIM** — enterprise-lite only; SAML + group mapping covers the demand. (SSO UI ships; SCIM waits.)
- **Cost allocation, traffic analytics, OTel export, uptime v2, status page v2** — nice-to-haves that lose to log search on every survey.
- **Community programs, panel ergonomics, BYOK ledger** — not what switches anyone.

---

## Release plan

Four releases plus a continuous trust track. Order chosen because **compose parity is a hard prerequisite for the importer**: real-world compose stacks routinely use `build:` and published `ports:`, which Nixploy refused. Both landed 2026-09-17.

| Release | Theme | Contents | Size |
| --- | --- | --- | --- |
| **v0.3** ✅ | Finish the loop | Compose parity, releases/deploy-any-ref, drop upload, service event timeline, agent surfaces | mostly S/M — **complete 2026-09-18** |
| **v0.4** ✅ | Free your platform | SSO providers UI, teams + project access, panel forward-auth, whitelabel | L |
| **v0.5** | The door | Manifest v2 → importers → same-host takeover → template compatibility | XL |
| **v0.6** | Live in it | Runtime log store + search, ephemeral environments, Copilot v2 | L |
| *continuous* | Trust | Footprint budget, upgrade CI, cosign-verified install, disclosure SLA | — |

---

## v0.3 — Finish the loop ✅

**Complete (2026-09-18).** Every item below shipped; each carries a note on what landed differently from the sketch.

Every item here closes a gap that is either embarrassing (a UI switch that does nothing) or blocks v0.5. Mostly small, ships fast, and the first three are prerequisites for the importer.

### 1. ✅ Releases: deploy any ref, roll back with config *(M — landed 2026-09-17)*

`deployment.requested_ref` (migration 0029) carries a branch, tag or sha from `application.deploy({ref})` through the queue claim to `buildRefDeployTarget`, which overrides the checkout the way `buildPreviewDeployTarget` already did — so the stored branch is untouched and the next webhook push still builds it. `modules/deployment/ref.ts` validates through `assertSafeGitRef` and refuses a ref on a source with no checkout. `application.redeployFromDeployment` rebuilds the exact commit of an earlier row, which still works after the branch moved on or was deleted.

Still to do in this slice: tag-triggered deploys (`tagPattern` + `deployOnTag` on push webhooks), `listRefs` for a branch/tag picker instead of a free-text field, and rollback-with-config (`currentDeploymentId`, an encrypted env snapshot on the rollback row, and drift detection when the orchestrator rolls back behind the panel's back).

### 2. ✅ Compose parity pack *(L — the prerequisite, landed 2026-09-17)*

Four half-built things at once, all in compose — auto-deploy, cancel, build-from-source, mounts and published host ports. All shipped.

**Build from source.** `compose.buildEnabled` / `buildPushRegistryId` / `buildArgs` columns. [`compose/safety.ts`](../packages/server/src/modules/compose/safety.ts) gains an `allowBuild` option accepting a bounded `build:` shape only — `context` (realpath-confined inside the checkout), `dockerfile`, `args` (keys only), `target`; still rejecting `dockerfile_inline`, `ssh`, `secrets`, `network`, `cache_from`. New `compose/build.ts` runs the existing Dockerfile builder per build service, tags `<appName>-<svc>:<deploymentId>`, optionally pushes, and [`rewrite.ts`](../packages/server/src/modules/compose/rewrite.ts) swaps `build:` for `image:` in the rendered file. Worker order becomes checkout → render → safety(raw+rendered) → build → `compose up`, with a cancel checkpoint per service. Snapshots store the image tags so rollback re-renders with the old ones.

**Mounts and published ports.** The FK columns already exist (`mount.compose_id`, `port.compose_id`) and `compose.duplicate` already copies mounts — only the routers and `MountsManager`/`PortsManager` are application-only. Make them kind-aware through `SERVICE_REGISTRY`; allow `ports:` behind an explicit per-stack opt-in with the platform-port deny-list that databases already use.

**Auto-deploy and cancel.** [`handler.ts`](../packages/server/src/modules/git/handler.ts) gains the compose branch of its push dispatch (the `match.ts` predicates are already pure and kind-agnostic); `application.cancelDeployment` becomes kind-agnostic (the module function already is); add the generic API-key deploy hook for compose.

*Why it matters:* unblocks the importer, external template catalogues, and adopting running workloads. Every competing panel has all of this — it is table stakes for switching.

### 3. Drop upload ✅ + CLI daily loop ✅ *(M — landed 2026-09-17)*

The drop source is fully implemented on the worker side and has no way in. Add `application.createDropUpload` (a route handler streaming to `<config>/applications/<appName>/code.zip`, 0600, size-capped, zip-magic checked), drag-and-drop in the source panel, and `nixploy up` / `nixploy deploy --drop ./app.zip` — the flag the UI already tells people to use.

Same release: `deployment.wait` (long-poll ≤55 s) and one machine-readable deploy outcome `{status, failingStep, lastLogLines, urls, healthcheck}` behind `--wait` everywhere. This is the contract v0.6's agent work and the `--wait` MCP tools build on.

*What shipped:* `deployment.current_step` (migration 0034) + `modules/deployment/steps.ts`, so `failingStep` is a column the worker writes rather than something parsed out of a free-text log. `deployment.wait` long-polls on the `finish` event with a 2 s re-read behind it (a lost notification must not hang a caller for the whole timeout) and returns the outcome object above plus live Swarm task counts. `--wait` / `--wait-timeout` on every deploy verb, `nixploy deployment wait`, and a non-zero exit on failure **or** timeout.

### 4. Service event timeline ✅ *(M — landed 2026-09-17)*

New `service_event` table (`kind`: task_started · task_failed · oom_killed · deploy_* · rollback · status_changed · config_changed · scaled), written by the reconciler (the task list it already fetches; exit 137 or a reported OOM → `oom_killed`), the deploy worker, and a `recordAudit` mirror for config changes. Pushed as a `service-event` frame on `/ws/events`; rendered as a Runtime → Events sub-tab and as annotations on the metrics charts. Read from a terminal with `nixploy events list`.

*Why it matters:* "why did it restart?" is unanswerable in every Swarm panel today, and it is the single best context injection for Copilot — the last 20 events before a failure now go into `explain.ts`, so failure explanations stop being guesses.

*What shipped differently from this sketch:* no `restart` kind (it would double-count `task_started`), no `alert` / `uptime_flip` (those are incidents, which have their own timeline and their own resolve semantics), and `recordRollback` is not a producer — it runs on every *successful* deploy to pin an image, so the rollback row comes from the audit mirror instead.

### 5. Agent surfaces ✅ *(S — landed 2026-09-18)*

Annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint`) on all 32 MCP tools; task tools `deploy_and_wait`, `explain_last_failure`, `get_service_runtime_summary`; MCP prompts (`troubleshoot_service`, `explain_failed_deploy`) and resources (`nixploy://service/{id}`, `nixploy://deployment/{id}/log`). Expose `ai.*` as CLI verbs. Publish `/llms.txt`, `/llms-full.txt`, `/agents.md` and per-page `.md` on the landing site, plus an installable agent skill. An **MCP setup** sheet next to API keys that renders the Claude Code / Cursor / Codex config snippets.

*What shipped:* all of it except the packaged skill — `/agents.md` is that content, and a second copy in a skill directory would be wrong within a release. 36 tools now (the four task tools plus `get_service_events`), annotations declared by hand with a test that fails the build on a missing one, and a `copilot` CLI group for `ai.*`.

### Also in v0.3 — two one-line fixes ✅ *(landed 2026-09-17)*

- ~~Wire `certificate.autoRenew` to something, or remove the flag. A toggle that silently does nothing is worse than no toggle.~~ It could never have been wired to renewal — these are PEMs somebody pasted in. Replaced with what an operator actually needs: `expiry_alerts` + a parsed `expires_at`, an incident and a `certificateExpiry` notification from 21 days out (migration 0035).
- ~~Finish DNS-01: pass `acmeDnsCredentials` to the Traefik service on write instead of printing a `docker service update --env-add` line for the operator to run by hand.~~ `ensureTraefikSetup` now pushes them itself, diffing the proxy's current environment first (an `--env-add` recreates the task, which is a ~9 s outage for every routed domain) and emitting only the keys the selected provider declares.

---

## v0.4 — Free your platform

The marketing line writes itself: a comparison table where the other column says *Enterprise* four times.

### 6. SSO providers UI ✅ *(M — landed 2026-09-18)*

New `sso_provider` table (provider slug, preset for Authentik/Keycloak/Entra/Okta/Zitadel/Google/GitHub, issuer, client id, `encryptedText` secret, scopes, allowed email domains, default org + role, `group_claim`, `group_mappings` jsonb, `sync_role_on_login`). Replace the env reader in [`modules/auth/sso.ts`](../packages/server/src/modules/auth/sso.ts) with a cached DB loader, seeding once from the existing env vars. Because better-auth plugins are constructed once, add a `rebuildAuth()` on `globalThis` (the `deployment/events.ts` pattern) triggered over `LISTEN/NOTIFY` so panel and worker both rebuild. Group→role mapping evaluated in the existing `databaseHooks`; `sso.required` per org enforced by a new `sso-gate.ts` mirroring [`two-factor-gate.ts`](../packages/server/src/modules/auth/two-factor-gate.ts), with instance admins exempt as break-glass.

**Lockout safety is the whole game here:** refuse to enable "require SSO" unless an instance admin has a linked SSO identity or a password fallback remains; link an SSO login to an existing account only when the IdP asserts `email_verified`.

Then SAML (protocol switch + IdP metadata upload, assertion signature/audience/replay validation) and passkeys (`@better-auth/passkey` pinned to the same 1.7.3 line, schema introspected per the CLAUDE.md recipe) as follow-ons. SCIM deferred. **Passkeys landed 2026-09-18; SAML and SCIM are still open.**

*What shipped (migration 0036):* all of the above, verified end to end against a real Keycloak — provisioning, group→role mapping, `syncRoleOnLogin` demoting on the next sign-in, the email allow-list refusing an **existing** user whose domain was removed, and the gate blocking exactly the member with no SSO identity while leaving instance admins through. Three things landed differently from the sketch: the auth instance lives on `globalThis` behind a Proxy (a module-local one is rebuilt in the wrong copy — `transpilePackages` evaluates the package twice); groups are read from the stored `account.id_token`, not from `mapProfileToUser`, which does not run for a user who already exists; and the redirect URI is `/api/auth/callback/<id>`, the core social route, not the plugin's `/oauth2/callback/:id`. The `email_verified` condition on account linking is better-auth's own behaviour and was not re-implemented. **Passkeys shipped on 2026-09-18** (`@better-auth/passkey`, pinned to the same 1.7.3 line; the relying party is resolved from the panel's domain and the plugin is not registered at all on an install reached by IP, because WebAuthn would have nothing to bind a credential to). **SAML remains a follow-on.**

### 7. Teams and project-level access *(L)*

`team` / `team_member` / `team_project` tables plus `member.project_scope` (`organization` | `teams`). Effective capabilities for (user, org, project) = role defaults ∪ member overrides ∪ team overrides − revokes, with rank-bound capabilities (`servers.manage`, `docker.manage`, `settings.manage`, `members.manage`) never grantable from a team overlay.

The elegant part: `resolveProjectFilter(userId, orgId)` memoized per request like `getOrganizationId`, threaded into `getServiceContext` / `assertApplicationAccess` / `assertEnvironmentAccess` — which means **every existing service router is covered without touching it**, because they all already funnel through those three. List procedures take the filter explicitly, and [`tenancy-coverage.ts`](../packages/server/src/trpc/tenancy-coverage.ts) gains a project axis so a new list procedure fails CI until it declares how it filters. `/ws/events` drops frames for hidden projects.

*Deny by default:* a teams-scoped member with no team sees nothing.

*What shipped (migration 0038):* the three tables, `member.project_scope`, the `AsyncLocalStorage` filter, the `team` router and the Settings → Organization → Teams surface, verified in the panel with a second account: a teams-scoped member in no team sees `Projects 0 / Services 0`, joining a team that reaches one project turns that into `1 / 1`, and the other project's URL renders **Page not found**. Three things landed differently from the sketch. The filter is resolved from the **user alone**, not `(userId, orgId)` — forcing the active organization inside `protectedProcedure` would make every protected procedure pay for an org resolution it may not need, and the union over memberships is the honest answer while a session can switch organizations mid-flight. The axis in `tenancy-coverage.ts` is called `PROJECT_AXIS` and has three values (`filtered` / `inherited` / `exempt`) rather than a boolean, because "reaches its rows only through a funnel that already checks" is the answer for most procedures and deserves to be stated. And the **capability overlay per team was dropped**: threading a project through every `assertCapability` call is a much deeper change than the filter, and the shipped model — role says *what*, team says *where* — is the part that closes the gap. Driving the panel as a scoped member also turned up leaks the plan had not named: the dashboard counters, the command palette, `schedule.all` and the forwardAuth target validator all reported organization-wide truth. Counters are reads; they are filtered now, with quota accounting deliberately left organization-wide.

**Remaining follow-on:** per-team capability overlays.

### 8. Panel forward-auth for any domain *(M)*

A new `nixployAuth` middleware kind: Traefik `forwardAuth` pointing at `/api/app-auth/verify`, a stateless HMAC cookie signed with the `ENCRYPTION_KEYS` chain (rotation-safe), a one-time code exchange on `/_nixploy/callback` (an extra router the config writer emits per protected domain), and allow-lists by role / team / user / email domain with bypass paths for health checks and webhooks. Optional `X-Forwarded-User/Email/Groups` injection.

*Demo:* flip one switch on `staging.acme.dev` and it is behind your org's SSO, with your 2FA policy, in five seconds. Bonus: "protect previews with panel login" as a per-parent option.

*What shipped (migration 0039, one enum value):* the `nixployAuth` middleware kind, three route handlers, and a second Traefik router per protected domain. Four details differ from the sketch. The callback is `/_nixploy/callback` as planned but the directory is `%5Fnixploy` — Next treats a leading underscore as a private folder and silently does not route it. The extra router carries an explicit priority rather than relying on Traefik's rule-length ranking, which ties when the app router also has a path. The panel's internal address became `NIXPLOY_PANEL_INTERNAL_URL` because a local checkout runs the panel on the host and the proxy in Swarm, and `http://nixploy:3000` resolves nowhere there. And the allow-list gained one axis the plan did not name: **teams**. A member whose project scope is `teams` and whose teams do not reach the project the app lives in is refused, before the explicit user grant — otherwise the app's own hostname would have been a second door into a project the panel hides. Policies are cached for ten seconds because `verify` runs on every request including every asset. Verified end to end on the local Swarm against a real `traefik/whoami`: the browser round trip lands on the app with `X-Forwarded-User/-Email/-Groups` filled in, a bypass path answers 200 unauthenticated, an XHR gets 401 rather than a redirect, a forged signature and an edited payload both get 401, a replayed code 400, an open redirect to a foreign host 404, and a spoofed `X-Forwarded-Host` 403.

**Not shipped:** the "protect previews with panel login" per-parent option. A preview domain inherits its parent's middlewares already, so protecting the parent protects every preview built from it; a separate switch would be a second way to say the same thing.

### 9. Whitelabel, free ✅ *(S — landed 2026-09-18)*

Per-org and per-instance logo (light/dark), favicon, product name, accent, footer, support/docs URLs, email from-name, optional sanitised custom CSS, status-page custom domain. Assets under `<config>/branding/`, served by a route handler, magic-byte checked, SVG sanitised. The org branding provider already sets `--primary` and a luminance-derived `--primary-foreground` — this extends the token set and adds the login/setup pages, which have no org context yet.

*What shipped (migration 0037):* an `instance_branding` singleton — product name, accent, logo (light/dark), favicon, footer, support/docs URLs, email from-name and sanitised custom CSS — applied to the browser tab, the favicon, the login and setup pages and the dashboard shell. **Instance-level, not per-org**, because the surfaces that need it most render before anyone has an organization; the existing per-org accent and display name still win inside the dashboard. Assets are identified by magic bytes rather than by the name the browser sent, SVGs are stripped of script, handlers and external references, and the serving route is sandboxed by a CSP — which had to go in `src/proxy.ts`, because a header set on a route handler's Response is replaced by the global one and a per-path `next.config` entry never matched. Status-page custom domain deferred.

---

## v0.5 — The door

The flagship. Nothing else in this plan changes a 20-service user's decision as directly.

### 10. Manifest v2 ✅ *(M — foundation, landed 2026-09-19)*

`NIXPLOY_STACK_VERSION` 2 with a v1 upgrader. The manifest grows to cover the whole service surface: hooks, swarm overrides, mounts, ports, redirects, basic-auth, domain middlewares (typed set only — no raw YAML hole), preview knobs, resources, registries/destinations/notifications by name. Env stays keys-and-references only; values never enter the file. A separate passphrase-encrypted secrets bundle carries values when someone wants a full move.

This is the importer's target format *and* the export half of config-as-code.

*What shipped:* the schema, exporter, planner and apply for all of the above, documented in [`gitops.md`](./gitops.md). Three things landed differently from the sketch. Destinations and notifications are **not** in the file — neither hangs off a service row (backups are per database and schedule, notifications are organization-wide), so naming them would have added references with nothing to attach them to; registries and servers are the references a service actually holds and they are written by name. An omitted array means "leave the rows alone" in v2 (v1 read an omitted `domains` as "delete them all"), so the upgrader spells `domains: []` out on every v1 service that left it out and a v1 file keeps its behaviour. And the secrets bundle shipped the same day as its own pair of procedures (`gitops.exportSecrets` / `gitops.applySecrets`, plus `secrets` on `runApply`): scrypt with a fresh salt, AES-256-GCM with the version as additional data, env by service name, build args and preview env included, database passwords deliberately not. Two side effects: the mount, redirect and forward-auth validators moved out of their routers into modules so the manifest goes through the same checks the forms do, and the planner compares jsonb canonically — Postgres reorders keys, and a byte compare reported every Swarm override as changed on every apply.

### 11. Importers *(XL — the live-API path landed 2026-09-19)*

`import_job` + `import_mapping` tables. Two source paths per supported panel:

- **Live API** — walk the source panel's project/service/domain/mount/port/backup/schedule/notification/registry endpoints with its API key, all through `assertSafeOutboundUrl` + `pinnedFetch`, with the endpoint list pinned to a version range and a fixture test per minor.
- **Offline dump** — `pg_dump` the source panel's Postgres container (or accept an upload), restore into a throwaway `postgres` with `--network none` exactly like [`backups/verify-commands.ts`](../packages/server/src/modules/backups/verify-commands.ts) does, read with a read-only role. **This path works when the source panel is dead** — which is the state a lot of switchers are in.

Then a pure normalizer to manifest v2 + an in-memory secret bundle, a plan step reusing the GitOps differ, and an apply that wraps the existing GitOps apply per service and **never deploys automatically** (services land `idle`). Where the source encrypts env at rest, its keyring file is needed; without it, env imports as keys with a "paste values" step in the report.

Gated by a new `import.manage` capability; source credentials live only in `encryptedText` and are wiped at terminal status; plan and report JSON never contain values.

*What shipped (live API, one source):* `modules/import` — `SourcePanelClient` (the URL through `assertSafeOutboundUrl`, every request through `pinnedFetch`), lenient `.passthrough()` schemas for the source rows, a pure normaliser to manifest v2 + a secrets payload + notes, and `inspect` / `plan` / `apply` over `gitops.manage` (+ `secrets.write`, `project.write` and the quota when creating). Three things landed differently. No `import_job` / `import_mapping` tables and no stored credentials: the key is passed per call and forgotten, `plan` is repeatable and `apply` is a GitOps apply (idempotent by name) followed by `applySecretsPayload`, so a job table would have recorded what the audit row already does. No new capability: an import *is* a GitOps apply from another panel, and `gitops.manage` already means "may write this environment from a file". And the offline-dump path is still open — it needs a restore into a throwaway Postgres plus the source's keyring for env values, and the live path covers the switcher whose old panel still runs. Verified on fixtures shaped like the source's `project.all` / `*.one` answers (its schema read on 2026-09-19); not yet against a live instance.

### 12. Same-host takeover *(L — the demo that ends arguments)*

A `tools/takeover.sh`, shipped as a checksum-verified release asset:

1. Preflight (Swarm manager, the source panel's services present, ports 80/443 owned by its proxy, version supported).
2. Scale the source panel to 0 — **its panel pauses; every tenant Swarm service keeps running.** That property is what makes this safe.
3. Dump + keyring copy; install Nixploy with `NIXPLOY_DISABLE_TRAEFIK_BOOT=1` on a free port.
4. Import with `adopt: true` — `appName` preserved, database rows bound to the **existing** data volumes, apps keeping their locally built images. **Zero data copied.**
5. Copy `acme.json` (same resolver name) — certificates carry over, no re-issuance, no Let's Encrypt rate-limit exposure.
6. Generate Traefik YAML for every adopted domain without deploying; attach `nixploy-traefik` to the old overlay for the transition.
7. Flip: `--publish-rm` on the old proxy, `--publish-add` on the new one (~9 s, measured and printed before confirming), verify every domain with `curl --resolve`.
8. `--rollback` reverses it in about 20 seconds.

New `adopted_at` per service so the UI can say "adopted — the first deploy applies Nixploy's hardening", and the deploy path detaches the old network after convergence. Instance admin only; refuses to run while the source panel is scaled up or any of its deployments is running.

*Demo:* a VPS with 6 apps and 2 databases → *"Source panel paused · dump taken · 8 services adopted (0 copied) · 11 certificates carried over · Traefik swapped in 8 s · 11/11 domains answer."*

### 13. Template ecosystem + external upstreams ✅ *(M each — landed 2026-09-19)*

New template-source kinds that read the large public compose catalogues maintained by other panels, normalized into the existing `Template` shape and run through the same image probe and safety checks. Plus export-a-running-stack-as-template.

*What shipped:* the `blueprints` template-source kind (migration 0041) reads the Dokploy templates repository layout — `blueprints/<id>/{meta.json, template.toml, docker-compose.yml}` — with a small TOML reader written for that subset (the dependency set is fixed), a pure mapper, and a deploy-time placeholder grammar the built-in catalog can use too (named generators memoised per deploy, `{{domain}}`, `{{env:KEY}}`, HS256 JWTs). File mounts become inline compose configs, undeclared `../files/<dir>` mounts become named volumes, `env_file` becomes explicit environment entries, and every entry passes the deploy's own compose safety check at sync. Measured on the public catalog: 417 of 532 deploy as-is; the 115 rejections are the Docker socket, host bind mounts, host ports, privileged capabilities and ten entries with nothing to route to, each listed with its reason on the source row. Not yet: the second catalogue (its compose files are plain, but its variable syntax is different), and export-a-running-stack-as-template.

**External upstream targets** (M) deserve their own line because they change migration order: a domain that points at an external URL with LE, middlewares and uptime probes means **DNS flips to Nixploy once**, then services move behind it one at a time instead of in a big-bang cutover.

*What shipped (external upstreams, migration 0042):* an `external_upstream` row per environment (name, `appName` in the shared service namespace, target origin, host-header mode, TLS-verification switch) that a domain row can hang off as its third possible parent (`domain_type = external`); the Traefik writer takes `TraefikDomainEntry.upstream` and emits the origin as the load-balancer server, `passHostHeader` from the switch and one `serversTransports` entry when verification is off, so certificates, middlewares (the panel sign-in included), the HTTPS redirect and uptime probes need no change. Two things the sketch did not name. **The target policy is the feature's security boundary**: Traefik dials from inside the proxy container, on both platform overlays, so the origin goes through the egress guard plus three rules of its own — bare names refused (they resolve to a Swarm service, i.e. some other tenant's container behind its own auth middleware), the dashboard host and the server's public address refused (both route the domain back into Traefik), and an hourly re-check that withholds the route when a vetted name is re-pointed at the overlay, while leaving a name that merely stopped resolving alone. And the panel surface is deliberately not a service page: no deploy, status or env, so it is a card under the services table and a single page (target, domains, delete) rather than a row of empty tabs. `nixploy upstream create|list|get|update|resync|remove` and `domain add --upstream-id`. Not in the manifest yet.

*Export-a-running-stack-as-template* also landed the same day: `compose.exportTemplate` (Settings → Export as template, `nixploy compose export-template`) writes the stack in the remote `Template` shape, validated with `remoteTemplateSchema` before it leaves so a sync can never reject it, with secret-shaped env keys replaced by `{{generateSecret}}`, the stack's own hostnames by `{{domain}}`, and the rest kept as defaults. Still open in this section: the second public catalogue (its variable syntax differs).

---

## v0.6 — Live in it

### 14. Runtime log store and search *(L)*

Files, not rows: `<config>/runtime-logs/<appName>/<hour>.jsonl`, gzipped when the hour closes, with a `runtime_log_segment` index table and a per-container cursor. A 30 s harvest cron reuses the sampler's container index and its batched-SSH pattern (`docker logs --timestamps --since <cursor>`), capped per container per pass with an explicit `[nixploy] N lines dropped` marker so truncation is visible. Retention per org (days + megabytes) with instance ceilings.

Search is a small server-side grammar — free terms, `-term`, `"phrase"`, `level:error`, `service:`, `/regex/` (length-capped, timeout-guarded) — streaming over segments, newest-first, cursor-paginated. Move the level classifier out of `log-viewer.tsx` into the server so panel and search agree. Exposed as a Monitoring → Logs tab, a service Runtime → History sub-tab, `nixploy logs search`, and an MCP read tool so Copilot can see what the app printed before it died.

Harvest and gzip run in the **worker** role only — this must not land on the panel's RSS.

### 15. Ephemeral environments *(L)*

Previews from a branch, a ref or a prebuilt image — not just a PR number. `--wait` returning `{url, health, logTail}`. Optional per-preview logical database (the `databases/logical.ts` primitive already exists) seeded by a `previewSeedCommand` run through the existing pre-deploy hook machinery. Commit status / check runs on the PR, not just a comment. `previewDeployment.redeploy` exposed (the module function exists; only `approve` calls it today). MCP `create_preview` / `get_preview` / `delete_preview`.

*Demo:* `nixploy preview create --app shop --branch feat/cart --db --wait` → 70 s later a URL, a health status, its own seeded database, expiring tonight.

### 16. Copilot v2 *(L)*

Evidence-first investigations over logs + metrics + task errors + Traefik state, with a deterministic no-LLM route diagnostician for the common 502 class. Deterministic remediation rules (rollout failed to converge → roll back to last good pin; restart loop → hold and alert) with cooldowns and a kill switch — and, where the action is not obviously safe, a **proposed action** a human approves in the activity tray. This is the "agentic ops is propose-and-approve" trend implemented honestly.

---

## Continuous — the trust track

Not a release; a standing commitment, because reliability is the top reason people leave the incumbent.

- **Footprint budget.** ✅ measured (2026-09-19): the e2e job reads the panel container's resident memory after the full golden path and fails over `NIXPLOY_PANEL_RSS_BUDGET_MIB` (768), printing the figure in the job summary. Today: 427 MiB panel + 51 Postgres + 26 Traefik = ~505 MiB on the live VPS. Still open: a `NIXPLOY_LITE` profile and publishing the number on the site.
- **Upgrade-integration CI.** ✅ (2026-09-19) The `upgrade` job in ci.yml installs the latest GitHub release with `install.sh` (split worker, signed image verified for real), runs the release's own bootstrap + golden path, rolls to the commit's image with `update.sh` through a local registry, and runs the golden path again with the same API key.
- **Verified installs.** ✅ (2026-09-19) `install.sh` / `update.sh` run `cosign verify` against the repository's workflow identity before pulling and pin the pull to the signed digest; a failed check stops the script. cosign is fetched (pinned release, SHA-256 checked) when the host has none; `NIXPLOY_SKIP_VERIFY=1` opts out. The `installer-signature` CI job runs the block with a real cosign against `:main` plus a foreign-identity negative case.
- **Security disclosure policy** with a documented triage SLA, and security releases separated from feature releases.
- **Known-regressions notes** in every release, and an in-panel preflight before an update.

---

## The non-engineering half

Features do not migrate anyone by themselves.

1. **Comparison page** against the alternatives, with the paid-tier contrast made explicit and every claim linked to a doc.
2. **Published footprint benchmarks** — same workload, three panels, idle and under deploy. Numbers, method, reproducible script.
3. **Migration guides per source**, rewritten around the importer once it lands — the guide now leads with `nixploy import` (2026-09-19); a per-source walkthrough with screenshots is still to write.
4. **A launch post per release**, each anchored to one demo: the takeover video is the one that travels.
5. **`SECURITY.md` with the triage SLA**, and an advisory process that does not batch 30 CVEs into one day.

---

## Verification

Per release, before it ships:

- `pnpm typecheck` (4 workspaces), `pnpm exec biome check --error-on-warnings`, `pnpm knip`.
- `DATABASE_URL_TEST=… pnpm test` — the tenancy suite silently skips without it, and **every feature here touches tenancy**. Teams work additionally extends `tenancy-coverage.ts` with the `PROJECT_AXIS` registry and the capability matrix with a teams-scoped member hitting a foreign project.
- `pnpm test:template-images` when the catalogue or template sources change.
- Real Swarm smoke: `pnpm smoke:golden-path` plus the source-build step (`SMOKE_BUILD_REPO`) that has already caught two builder bugs no prebuilt-image smoke could.
- Drive the panel in the browser, light **and** dark, watching for hydration warnings — every UI item above.

Feature-specific proofs worth naming:

| Feature | How it is proven |
| --- | --- |
| Compose build | A stack with `build:` deploys; the rendered file contains `image:`; rollback re-renders old tags; a malicious `context: ../../etc` is refused |
| Deploy any ref | Deploy a tag, a sha and a branch; `redeployFromDeployment` on a historical row; a ref deploy does not change the configured branch |
| Event timeline | `docker kill --signal=KILL` a task → `oom_killed`/`task_failed` appears within one reconciler pass with the exit code |
| SSO | Full loop against a throwaway Keycloak: login, group→role mapping, role sync, enforced SSO, and the lockout guard refusing a configuration that would lock everyone out |
| Teams | A teams-scoped member cannot list, read or mutate a foreign project — asserted for *every* mutation, and it must not write |
| Forward-auth | Protected domain returns 302 to the panel, completes, sets the cookie, serves; bypass paths stay open; a forged cookie is rejected after a key rotation |
| Importer | Against a real source install in a VM: plan → apply → report; re-running is idempotent via `import_mapping`; no secret appears in plan/report JSON |
| Takeover | On a VM running the source panel with apps + databases + certs: run it, verify every domain with `curl --resolve`, check volumes are the same objects (`docker volume inspect`), then `--rollback` and verify the source serves again |
| Log store | 24 h of a chatty service stays inside the org cap; search returns a known line under load; harvesting adds no measurable panel RSS |

---

## Open question for later

Hosted control plane (BYOC) stays possible but unbuilt: the `NIXPLOY_ROLE` panel/worker split is already the control-plane/data-plane seam, and provider-API server provisioning (v0.6+) is the other half. **No feature is ever paywalled** — hosting and support are the only things that could be sold. Worth re-deciding once there are users, not before.
