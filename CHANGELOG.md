# Changelog

All notable changes to Nixploy. Kept by hand — the repository takes direct
commits, so auto-generated "what's changed" lists come out empty.

Format loosely follows [Keep a Changelog](https://keepachangelog.com/);
versions are the release tags (`vX.Y.Z`) that `install.sh` and `update.sh`
pin. Operator-facing detail — what to check before upgrading, what will look
different afterwards — lives in [docs/upgrade-notes.md](docs/upgrade-notes.md);
this file is the summary.

## [0.7.3] — 2026-09-21

### Changed

- **nixploy.com's chrome.** The bar no longer sits in the flow, so the flat
  black strip it used to cut out of the top of every page is gone and the
  fold's light runs under it; at rest it is a wide translucent pill that still
  collapses into the floating island once the page moves, and its GitHub link
  opens in its own tab. The footer is a panel that ends the page: the columns,
  then the wordmark set to the panel's full width in the site's display face,
  then the legal line and a credit to the author.
- **One radius scale**, written down beside the tokens: `rounded-lg` for
  controls, `rounded-xl` for cards, `rounded-2xl` for section panels,
  `rounded-full` for badges and the nav island. The fold and the closing
  section drop their shimmering pill for the same plain buttons the rest of
  the site uses, and the home page's CLI tile is a still rather than a
  terminal that retypes itself on every scroll into view.
- **Docs, features and agents were reorganized.** The docs index opens with
  the path in the order it is walked and then lists every page with the line
  it introduces itself by; the features page gains a sticky section rail,
  numbered sections and full-width detail cards; the agents page stops nesting
  a card inside a card and opens with what decides whether to hand an agent
  the keys — tools, auth, dispatch, audit.

### Fixed

- The panel screenshot in the fold ended in a sliced row with a hard border
  under it; it fades out instead.

## [0.7.2] — 2026-09-20

### Changed

- **Template categories are a vocabulary, not whatever a tag said.** A
  blueprint declares tags and the first one used to become its category
  verbatim, which gave the public catalog 209 categories for 436 templates,
  125 of them holding a single entry. Tags now resolve against the fifteen
  categories the built-in catalog uses — the first tag that maps wins, the
  generic ones every entry carries are ignored, and anything unrecognized
  stays visible in *Community*. On that catalog: 209 categories become 16.
- **The category rail stays a rail.** It lists the eight busiest categories,
  keeps a selected one on screen wherever it sorts, offers *Show N more*,
  grows its own filter box past twelve categories, and scrolls inside itself
  instead of making the page taller than the results.
- **The template card was redrawn.** The mark leads at 48px with the name,
  what the entry is and what it will ask for under it, its tags as filters,
  two reserved lines of description, and a footer carrying links to the
  project's source, site and documentation next to Deploy. The card itself
  carries no fill — a border on the page's own black, like the dashboard's
  cards.

## [0.7.1] — 2026-09-20

### Changed

- **The template gallery is a faceted catalog.** A rail carries four filters —
  categories, catalogs, requirements (no setup / asks for values / instance
  admin) and tags — and every option prints how many templates it would leave,
  counted over what the *other* filters leave, so an option reading 0 says the
  combination is empty before it costs a click. Results render as a grid or a
  table, both paged, and every knob is a query parameter, so a narrowed view is
  a link. `/` focuses the search box; tags on a card filter by themselves; on a
  phone the rail moves into a Filters sheet.
- **Filters and paging on the lists that grow.** The project services table
  gains type and status filters, and swarm services, preview deployments,
  instance backups, both rollback lists and teams gain the search box and pager
  the panel's other tables already had. Chrome stays hidden until a list is long
  enough to need it, so short tables look exactly as they did.
- **Deployment feeds filter by status on the server.** The project feed and a
  service's deploy history are keyset-paginated, so filtering a page after it
  arrived would leave "the last 20 deployments" showing four; `deployment.byProject`,
  `byApplication` and `byCompose` now take a `status` array and filter in SQL.

## [0.7.0] — 2026-09-20

### Added

- **Forty DNS-01 providers, up from eight.** Settings → Platform → Wildcard
  certificates now offers Spaceship, Porkbun, NameSilo, GoDaddy, Linode,
  netcup, deSEC, DNSimple, Bunny.net, Gcore, IONOS, Hostinger, Njalla, INWX,
  Name.com, NS1, LuaDNS, Scaleway, Exoscale, ClouDNS, Netlify, Vercel,
  Infomaniak, GleSYS, mijn.host, DNS Made Easy, Dynu, easyDNS and Hurricane
  Electric beside the eight that were there — plus three that point at a
  nameserver you run yourself: **RFC 2136** dynamic update (BIND, Knot,
  anything speaking nsupdate), **PowerDNS** and **Technitium**. Each entry's
  provider code and credential variables were read out of lego's own list at
  the version Traefik 3.7.13 embeds (v5.4.1) and checked back against it, because
  both are passed through verbatim and a wrong one only fails at certificate time.
- **A records at three more providers.** Spaceship, Porkbun and Linode join
  Cloudflare, DigitalOcean, Hetzner, Vultr and Gandi LiveDNS in *Create DNS
  records automatically* — eight with a record client now. The rest stay
  certificates-only, and the panel says which is which.

### Changed

- The DNS provider picker is a searchable list rather than a dropdown of
  forty, and marks the providers that also write records.
- nixploy.com was rebuilt. Every component now comes from a component
  registry (`@shadcn`, `@magicui`, `@aceternity`, `@kokonutui`) with this
  repository supplying structure, copy and data; the palette is monochrome,
  the docs have a table of contents and a previous/next pager, the API
  reference collapses its 49 routers behind an index, and the site has a 404
  page, a real share card, response headers and a skip link. Numbers that had
  been typed into the copy — the release in the fold's badge, the install
  guide's checksum snippet, the control-plane footprint, the MCP tool count —
  are read from the data that measures them.

### Fixed

- **A template that publishes host ports is indexed, not rejected.** A
  catalogue entry is not a running stack: the per-stack *Publish host ports*
  opt-in exists, so a template whose compose file has `ports:` is now
  validated as a published-port stack (no privileged or platform port, no
  host bind address, no ranges) and flagged, and deploying it creates the
  stack with publishing on — instance admin only, because those ports bypass
  Traefik and with it domains, TLS and the access log. Blueprint translation
  also drops the source panel's routing labels, accepts the `./files/`
  spelling and SELinux flags on a mount, and suggests a placeholder domain
  for a blueprint that exposes no port instead of dropping it. On the public
  blueprints catalog that is 436 of 532 entries deployable, up from 418; the
  rest are host binds, the Docker socket, capabilities and namespaces.
- A source's sync report is a dialog listing every rejected entry and
  unverified image, one reason per line. It used to be the first two reasons
  pasted into a table cell, clipped mid-word.
- Four API routers (`branding`, `import`, `sso`, `upstream`) shipped without a
  human title, so the endpoint catalogue listed them as "sso / sso".
- The landing docs and the DNS settings endpoint both still said the operator
  had to run `docker service update --env-add` by hand to give Traefik its DNS
  credentials. The panel has been doing that itself since 0.6.0.

## [0.6.0] — 2026-09-20

### Added

- **DNS records created for you.** The DNS provider link (Settings → Platform
  → DNS provider) can now write the A record for every domain attached — by
  hand, over the API/CLI, or by a template deploy — pointing it at the server's
  public IPv4 in the matching zone. Cloudflare, DigitalOcean, Hetzner (Cloud
  API), Vultr and Gandi LiveDNS; off by default (*Create DNS records
  automatically*), best-effort by contract (`dns` outcome on `domain.create`
  and `template.deploy`), retry with the globe button, `nixploy domain
  ensure-dns` or `domain.ensureDnsRecord`; **Check link** lists the zones the
  credentials see (`webServer.dnsZones`). Records are never deleted.
- **Templates declare the hostnames they need.** A template's `domains` hints
  name env keys whose values are hostnames (`wildcard: true` for `*.<value>`);
  on deploy they are attached as domains of the stack — HTTPS + Let's Encrypt,
  the wildcard on the DNS-01 resolver when a provider is linked — and handed
  to the DNS automation. The deploy dialog previews them; a host already
  routed is skipped with a note. OpenHole uses it for its endpoint host and
  tunnel wildcard, so its setup is the env values and nothing else.
- **The Copilot reads the charts and the route.** A chat about a service now
  carries six hours of resource use summarized to three facts and the
  deterministic route verdict for its domains (failing probes only), next to
  the event timeline and the runtime log it already had.
- **Proposed remediations.** A deploy that dies after the image reached the
  cluster (the rollout, converge or post-deploy step), or a service that
  fails three tasks (or is OOM-killed three times) in ten minutes, gets an
  incident of kind `remediation` with a proposed action — roll back an application to its
  previous pinned image, restore a compose stack's earlier snapshot — that a
  human applies or dismisses from the activity tray, Monitoring → Incidents,
  `nixploy incident apply|dismiss` or `observability.applyRemediation`.
  Nothing runs on its own; an OOM loop gets the memory-limit explanation and
  no button. One proposal per service per hour; `NIXPLOY_REMEDIATION=0`
  turns the rule off. The manual `application.rollback` and an applied
  proposal now share one code path.
- **`NIXPLOY_LITE`, the small-box profile.** `install.sh --lite` (or the
  variable, which `update.sh` forwards) changes the defaults of five knobs for
  a 1–2 GB box: no runtime log harvesting, metrics every two minutes kept
  twelve hours, a two-minute uptime pass, four SSH channels per server, and a
  1g service memory limit. Each knob still wins when set individually, and
  nothing about deploys, routing, backups or the queue changes.
- **Per-organization runtime log retention.** Settings → Organization →
  Quotas gained *Runtime log history* (days, MB per service): an org keeps
  less than the instance's `NIXPLOY_RUNTIME_LOG_*` ceiling, never more; the
  hourly prune resolves each service's org once per pass.

### Fixed

- **Background passes now log why a database call failed, not just which query
  it was.** Drizzle's error message is the SQL; the reason lives on its cause,
  and 69 catch sites across the crons, the deploy worker, the schedulers and
  the reconciler were dropping it — including the metrics pass, whose
  unactionable "Failed query" line on a production box turned out to be a
  planned Postgres restart. One shared unwrapper, used everywhere a database
  error is logged. A bare catch in the metrics sampler that silently discarded
  every alert-rule write, incident insert and notification read for local
  services now says so.

- **Template sources backed by a git repository (including blueprints) could
  never sync.** The sync built its own simple-git client, which refuses the
  protocol hardening Nixploy passes through `GIT_CONFIG_COUNT`, so every
  such source failed with `Use of "GIT_CONFIG_COUNT" is not permitted` and
  stayed at zero templates; `http-json` sources were unaffected. It now uses
  the same hardened client the deploy path does, and a test fails the build
  if another module ever constructs its own.

### Changed

- **Traefik 3.7.13** (was 3.5.0). The panel now rolls a running proxy whose
  image differs from the pin on boot — one task recreate, about 9 s of
  routing outage, once per bump — so in-panel updates get the new proxy, not
  only `update.sh`. Nothing in the file-provider YAML changed shape; user
  `forwardAuth` middlewares now render `trustForwardHeader: false` unless
  the row sets it (3.6.14 warns when it is unset).
- Hetzner DNS-01 credential is now the Cloud API token (`HETZNER_API_TOKEN`);
  the legacy `HETZNER_API_KEY` API is gone upstream and the key is swept off
  the proxy. The bundled lego (4.28 in Traefik 3.7) knows the new API.

## [0.5.0] — 2026-09-20

The roadmap's **v0.5 "the door"** and most of **v0.6 "live in it"** in one tag,
plus the trust track: a way *in* from another panel (over its API or from a
dead panel's database dump), a way to keep a hostname answering while services
move one at a time, and the things that used to be guesses — why a host
answers 502, what a service printed before it died, whether an update is safe
to press — as deterministic answers. Six migrations (`0040`…`0045`), all
additive; nothing needs an operator action before upgrading
([docs/upgrade-notes.md](docs/upgrade-notes.md)).

### Added

- **Import from another panel.** `nixploy import inspect | plan | apply` reads
  one project environment from the source panel over its REST API and
  translates it to a version-2 `nixploy.yaml` plus the env values, then applies
  both here without deploying anything; the notes say what could not carry
  over. When the source panel is dead, `--dump-file` takes a `pg_dump` of its
  database instead: it is restored into a throwaway Postgres on no network,
  read, and the container removed.
- **Manifest v2 and a secrets bundle.** `nixploy.yaml` now covers the whole
  service surface (hooks, Swarm overrides, mounts, ports, redirects, basic
  auth, typed domain middlewares, preview settings, registries and servers by
  name); a passphrase-sealed bundle carries the env values a manifest never
  holds. Version-1 files are upgraded on read.
- **External upstreams.** A domain can front an origin outside the Swarm — the
  host the old panel still runs on, a SaaS endpoint — with Let's Encrypt,
  middlewares and uptime probes as for any service, so DNS moves to Nixploy
  once and workloads follow one at a time. The target is vetted against the
  egress policy on save and hourly.
- **Runtime log history.** The worker keeps what services print (`docker logs`
  every 30 s into hour files, gzipped, 7 days / 256 MiB per service by default)
  and it is searchable — terms, phrases, excludes, `level:`, `container:`,
  regex — on every service page, on the Monitoring page across services, with
  `nixploy logs search` and the `get_runtime_logs` MCP tool. The Copilot reads
  it too.
- **Ephemeral environments.** Previews from any branch, tag or sha, or from a
  prebuilt image, without a pull request; `preview redeploy`; `--wait` on
  create returning URL, health and log tail; a commit status on the provider
  for every preview build; and a **database per preview** — a logical database
  on a chosen service of the environment, handed to the preview as
  `DATABASE_URL`, seeded once by an optional command, dropped with it.
- **A route diagnostician.** The stethoscope on a domain row (`nixploy domain
  diagnose`, `get_domain_diagnosis`) walks the request path in order — DNS,
  the Traefik route file, a second file claiming the host, the upstream task,
  the shared-network attachment, the container port, Traefik's own answer,
  the certificate — and names the fix at each step.
- **Update preflight.** The Update dialog checks free disk, whether the
  registry resolves the target, running deployments, the age of the last
  instance backup, platform readiness, a downgrade, and the target's release
  notes before the button is enabled; the low-disk block is enforced by the
  updater itself.
- **Verified installs and an upgrade job.** `install.sh` / `update.sh` verify
  the image's cosign signature against this repository's workflow identity and
  pin the pull to the signed digest; CI installs the latest release on a
  clean runner and upgrades it to every commit before the commit stays green.
- **Templates.** The Dokploy templates catalogue as a template-source kind
  (417 of its 532 entries deploy as-is, the rest listed with the reason);
  export a running compose stack as a template; deploy-time placeholders
  (`{{generatePassword:…}}`, `{{domain}}`, `{{env:KEY}}`, JWTs); an
  **OpenHole** template with setup steps; setup steps as a template field.
- **Passkeys.** Sign in with a passkey (WebAuthn) where a real dashboard domain
  is configured; a passkey does not bypass the two-factor or required-SSO
  rules.
- **Panel footprint budget.** The e2e job measures the panel's resident memory
  after a full golden path and fails over 768 MiB; measured 419–434 MiB.
- **Surface parity.** New CLI groups and verbs (`upstream`, `logs`, `preview
  create|redeploy|list-compose`, `domain diagnose`, `updates preflight`,
  `compose rollback|create-from-url|export-template`, `schedule run-once`,
  `template source-*`, `import --dump-file`) and ten new MCP tools (42 in
  all), each with hand-declared annotations. API rows say `secretsRedacted:
  true` when a viewer got masked values.

### Changed

- `update.sh` waits for Swarm to finish each roll before probing readiness;
  previously it could report success while the old task still served during
  its drain window.
- The Copilot's failure explanation and service chat carry the runtime log
  tail and the event timeline, redacted like the build log.
- The landing site was rebuilt around a simple home page, with a page per
  template and sourced comparison pages.

### Fixed

- Thirteen code-scanning findings closed; `adm-zip` moved past
  GHSA-7q85-xj36-vmfc.
- A module that imported the GitHub client statically on the boot path crashed
  both roles at start in the image (never on `main` for more than a run); a
  test now walks the static import graph from both entries.

## [0.4.0] — 2026-09-18

Two roadmap releases in one tag: **v0.3 "finish the loop"** and **v0.4 "free
your platform"**. Everything the incumbent panels put behind an *Enterprise*
column — single sign-on, teams, forward auth, whitelabel — is here and free.
Eleven migrations (`0029`…`0039`); all of them additive.

### Added

- **Single sign-on, configured in the panel.** SSO used to be four environment
  variables: one provider per instance, and changing it meant editing a unit
  file and restarting. It is rows now, with presets for Authentik, Keycloak,
  Entra, Okta, ZITADEL, Google and GitHub, plus what env vars could never
  express — which organization a provisioned user lands in, and an IdP group →
  role mapping that can re-apply on every sign-in. Requiring SSO is per
  organization and refuses to lock you out: instance admins stay exempt as
  break-glass, the switch cannot be enabled until an admin or owner has a
  linked SSO identity, and removing the last provider while an org requires it
  is refused. Existing `NIXPLOY_OIDC_*` variables are imported into a row once,
  on first boot, so an upgrade changes nothing.
- **Teams and project-level access.** A role has always said *what* a member
  may do; nothing said *where*. A team is a set of people attached to a set of
  projects, and a member whose project scope is `teams` sees only the projects
  their teams reach — everything else is not found, not forbidden, for reads
  and writes alike. Nothing changes for anyone until you switch a member over.
  Deny by default: a teams-scoped member in no team sees nothing.
- **Any domain behind the panel login.** One middleware on a domain and that
  host is behind this instance's sign-in, with your organization's two-factor
  and required-SSO rules, because it is the same login. Narrow by role, team,
  email domain or named people; bypass paths for health checks and webhooks;
  optional `X-Forwarded-User` / `-Email` / `-Groups` for the app. The session
  cookie is host-only and signed with the instance key chain, so rotating
  `ENCRYPTION_KEYS` is a rotation and not a mass sign-out.
- **Whitelabel, free.** Product name, logos (light and dark), favicon, accent,
  footer, support and docs URLs, email from-name and optional custom CSS —
  applied to the browser tab, the login and setup pages and the dashboard
  shell. Instance-level, because the pages that need it most render before
  anyone has an organization.
- **Deploy any branch, tag or commit.** `application.deploy({ ref })` and
  "Redeploy this commit" on any historical row, so a green build from
  yesterday is one click away after the branch has moved on. The configured
  branch is untouched — the next webhook push still builds it.
- **Compose parity.** Stacks build from source (a bounded `build:` shape:
  context, dockerfile, target and args, with every escape hatch refused by
  name), take mounts and published host ports, auto-deploy from a webhook, and
  can have a build cancelled. Host ports are opt-in per stack and
  instance-admin only — a stack binding `:80` fights the proxy for the port.
- **Upload the archive a `drop` application deploys.** The worker half has
  always existed and there was no way to put a file there. Drag-and-drop in
  the panel, `nixploy app upload <id> ./app.zip [--deploy]` in the CLI, zip
  magic checked before it is stored.
- **A per-service event timeline.** `Runtime → Events` on all seven service
  kinds: task failures with their exit code, OOM kills, restarts, deploys,
  rollbacks, scale and config changes. Written by the status reconciler from
  the task list it already fetches, so it costs no extra daemon round-trip,
  and rendered as annotations on the metrics charts so a spike sits next to
  its cause.
- **A deploy outcome a script can branch on.** `deployment.wait` long-polls up
  to 55 s and returns `{ status, failingStep, log tail, urls, health,
  duration }`; `--wait` on every CLI deploy verb exits non-zero with the
  failing step on a failure *and* on a timeout. The failing step is a column
  the worker writes, not English parsed out of a log.
- **Agent surfaces.** Tool annotations on all 36 MCP tools (hand-declared,
  with a test that fails the build on a missing entry), four task tools,
  investigation prompts and resource templates; `llms.txt`, `llms-full.txt`,
  `agents.md` and per-page `.md` on the docs site; an MCP setup card next to
  API keys; a `nixploy copilot` command group.
- **Certificate expiry warnings.** An incident and a notification from 21 days
  out, once a day per certificate, parsed from the leaf of the chain.

### Changed

- **DNS-01 credentials reach Traefik.** Saving a provider used to store the
  credentials and print a `docker service update` line for the operator to run
  by hand; only the provider *name* ever reached the proxy. They are pushed
  now — only the keys the selected provider declares, and only when they
  actually differ, because that update recreates the proxy task.
- `certificate.autoRenew` is gone. It had no consumer and could not have had
  one: these are certificates somebody pasted in, and Nixploy cannot renew a
  certificate it did not issue. Replaced with expiry alerts, on by default.
- Every service mutation writes an audit row. `application.update`,
  `saveEnvironment`, `saveBuildType`, `saveSource`, `reload`, `start`, `stop`
  and the compose equivalents wrote none at all, against this repository's own
  rule.
- `application.cancelDeployment` works for any service kind, not just
  applications.

### Fixed

- The compose **Auto deploy** switch did nothing: the webhook handler only
  ever queried applications.
- A compose stack's build could not be cancelled from any surface.
- The panel hid the builder picker for a `drop` source, which is the one
  source that most needs it set.

## [0.2.9] — 2026-09-15

### Added

- **The template catalog goes from 86 to 145 entries.** New across every
  category: LibreChat, Langflow, Qdrant and LocalAI; Baserow, Appsmith,
  Formbricks, Redmine, Odoo and Grist; Joomla and Drupal; Element and ejabberd;
  pgweb, RedisInsight, SQLPad and DbGate; Wallos and Maybe; Memos, Trilium,
  HedgeDoc, Docmost, SiYuan and Shiori; Komga, Calibre-Web, Jellyseerr, Sonarr,
  Radarr, Prowlarr, Bazarr and qBittorrent; Healthchecks, Beszel and Speedtest
  Tracker; Mailpit; Planka, Wekan, Kanboard, Homepage, Dashy, Heimdall and
  Baïkal; ZITADEL, Infisical and Passbolt; SFTPGo, ownCloud Infinite Scale and
  Seafile; SearXNG, CyberChef, linkding, PrivateBin, Verdaccio, Jenkins,
  DocuSeal and Kutt.

### Changed

- **Settings and service cards are two columns on wide screens.** The heading
  and its explanation sit beside the controls instead of above them, so a card
  is no longer 1100px wide with a 300px input hugging its left edge. Sections
  whose body is a table keep the full width, and everything stacks exactly as
  before below `lg`.
- **Long tables get search and pagination.** Docker containers, images, volumes
  and networks; organization members; schedules; backup runs; servers,
  registries, certificates, SSH keys and API keys. Both appear only once a list
  is long enough to need them, so a five-row table is unchanged. Backup runs
  also fetch real history now (100 runs, paged) instead of the last twenty,
  which were all you could reach.
- **Counts on tabs.** Docker (containers, images, networks, volumes), Git
  providers, a project's Services, a service's Domains — and an unresolved
  incident count on Monitoring, badged in red. Each reads the query its own tab
  already runs, so nothing costs an extra request.
- The Git provider tabs are in the URL like every other tabbed surface, so a
  refresh or a shared link no longer drops you back on GitHub.
- **Empty states and load failures look the same everywhere.** Sixteen surfaces
  had hand-rolled their own with different padding, a different radius, no icon
  and no title; they now share `EmptyState` and a new `LoadError`. The audit
  log's bespoke pager is the shared one too, so the panel has a single pager
  rather than two that disagreed about wording and controls.
- A service's deployment history sits in a card like everything else on the tab
  — it was the one block rendered bare.
- **The log viewer is one toolbar instead of two.** Seven controls over two rows
  became a status, a filter, a **Levels** menu with per-level counts, the
  errors-only pill, the line count and three buttons; copy, download and clear
  moved into an overflow menu. Follow-latest no longer uses the download arrow,
  which sat one button away from the actual download and looked identical to it.
  Lines are numbered against the unfiltered stream and a level shows as a
  coloured rule instead of an `ERR`/`WRN`/`INF` chip in front of every line — the
  column of tags made the output read as a table rather than as logs.
- Searching services in a project now matches the description and the kind, not
  just the name — "postgres" finds the database even when it is called `leet-db`.
- A failed count on the dashboard is a link to what failed rather than a dead
  number.
- **Templates page redesigned.** Four columns from `xl` (most categories hold
  four to eight entries, so three left a stranded card on almost every row), the
  whole card opens the details dialog instead of a duplicate button, every card
  reserves two description lines so rows share a baseline, and each one now says
  how many values the deploy form will ask for.
- **Template images refreshed.** Shared bases move to PostgreSQL 17, Redis 8,
  MongoDB 8, MySQL 8.4, MariaDB 11.8 and PostGIS 17-3.5; Audiobookshelf (2.9.0 →
  2.36.0), Linkwarden, Mealie and Homarr were years of releases behind their
  pins. Every logo in the catalog now resolves to a real mark, and marks that
  disappeared against one of the two themes are tinted for it — the black
  glyphs (Langflow, Appsmith, Directus, CloudBeaver, Trilium, ownCloud,
  Infisical, Heimdall) in dark mode, and Radarr's pale yellow in light mode.

### Fixed

- **The terminal no longer blames the wrong thing.** Attaching to an image with
  no shell closed the session with "Deploy the service first" on a service that
  was plainly running. It now says the image has no `/bin/sh`, which is what
  actually happened.
- **The top navigation no longer vanishes when an overlay opens.** Radix locks
  the page by putting `overflow: hidden` on `<body>`, which turns it into a
  scroll container — and a `position: sticky` header then sticks to the top of
  the *body box*, far above the fold. Opening the theme menu or the command
  palette halfway down a long page made the whole nav disappear. The lock now
  goes on `<html>`, the element that actually scrolls.
- Pages no longer shift sideways when a dialog, dropdown or the command palette
  opens: the scrollbar gutter is reserved permanently.
- The dashboard checklist step **"Serve the panel on your own domain"** could
  never turn green: it also tested a `certificate_type` column that no part of
  the UI writes. A configured panel host already implies HTTPS — the dashboard
  router is always emitted with the Let's Encrypt resolver.

## [0.2.8] — 2026-09-15

### Added

- **Inherited variables are visible from the service.** The Environment tab of
  every application, compose stack and database lists what it gets from the
  organization, the project and the environment, marks the ones the service
  overrides, and links to the chain. Until now that whole layer was invisible
  from where it matters.
- The service header says when it was last deployed and by whom.
- Deployment logs get an **errors-only filter** (one click from a thousand-line
  build to the line that failed) and a copy button.
- Docker sub-tabs are deep-linkable (`?tab=volumes`) and survive a refresh.
- The API smoke test can build an app **from source** (`SMOKE_BUILD_REPO` /
  `SMOKE_BUILD_TYPE`) and CI now does. Every other step deploys a prebuilt
  image, which is exactly why the v0.2.7 buildx breakage passed CI and broke
  every real build. ~45 s.
- An incident that names a service links to it — deploy-failure incidents now
  record which kind of service failed, which is what makes the link possible.
- **Creating an application asks for its source.** The dialog takes a Docker
  image or a repository URL (or "set up later"), saves it with the service and
  opens the new service page — a new app used to land in the list unusable
  until you found two more forms on two more tabs.
- **The add-domain dialog checks DNS while you type**: whether the host
  resolves, where to, and this server's public IP, so a mispointed A record is
  visible before saving instead of after the certificate fails. New
  `domain.checkDns` procedure.
- Saving environment variables says they apply on the next deployment and
  offers a Deploy button in the toast; the editor footer says the same.
- The panel shows a service's public address where you look for it: under the
  service title (with a copy button and a link that opens the site) and in the
  project's services table. It used to live only in the Domains tab.
- Dashboard project rows carry a health summary — how many services are
  failing, how many are running — instead of only a service count.
- A dismissible "Finish setting up" checklist on the dashboard with five live
  checks (panel domain with TLS, git provider, first service, first successful
  deployment, first domain), each linking to the page that does it.
- A service that cannot be deployed yet says why under its title ("Set a
  repository URL or Docker image first"). The reason used to be a tooltip on
  the disabled Deploy button.

### Changed

- Page descriptions wrap instead of being truncated — the Servers page cut its
  own instructions mid-word, with no way to read the rest.
- Cards no longer repeat the page title: "Organization" → "Name" (with a note
  on why the slug is fixed), "Profile" → "Name and avatar", the Servers card →
  "Connected hosts".
- Platform → Access saves the Let's Encrypt email from a button next to the
  field rather than one in the card header, which sat next to the domain it did
  not save.
- The empty schedules and project-services states say what the thing is for and
  offer a way in ("Browse templates").
- The rollbacks table's "Version" column is called "Image tag" — it is the
  local tag the image is pinned under, not a release number.
- A service page that cannot load is no longer a dead end: it names what is
  missing, links back to the project, and only offers Retry when retrying
  could work (a deleted service used to show a Retry button that could not
  succeed, and no way back).
- The add-domain dialog hides the certificate picker unless something actually
  terminates TLS, and clears the choice when HTTPS is switched off.
- Monitoring leads with the fleet: the Prometheus endpoint card moved below it
  instead of pushing the service list and its charts off the screen.
- The backups empty state carries an "Add backup storage" button instead of
  naming the settings page in prose.
- **Redeploy is gone from the application and compose headers.** It queued
  exactly the same job as Deploy — same builder, same rollout — under a second
  name, so the two buttons only suggested a difference that was not there. The
  `application.redeploy` / `compose.redeploy` API procedures are unchanged.
- Deployment status reads the same everywhere: a failed deployment is
  "Failed", not "Error" in one place and "Failed" in another, and the badge
  colours match the dashboard's dots (blue while running, green when
  succeeded).
- Long tables and tab strips show a shadow at the edge they can scroll toward,
  and the tab strip's own scrollbar (which sat on top of the active underline)
  is hidden.
- Phones: the settings menu is a select instead of twelve stacked links that
  pushed every settings page off the screen; the deployments table folds its
  Created and Duration columns under the title; the project toolbar wraps
  instead of pushing "Add service" past the right edge.
- The deployments chart says "No deployments in the last 14 days" instead of
  drawing an empty grid.

### Fixed

- **Dockerfile builds failed on a stock Docker install.** The per-app layer
  cache is on by default, and buildx's default `docker` driver cannot export
  one — the build died with "Cache export is not supported for the docker
  driver" instead of simply building without a cache. Docker Desktop hides
  this by shipping the containerd image store, which is why it never showed up
  in local testing. The build host is now probed for cache-export support, and
  a host without it builds anyway, with a log line saying how to get the cache
  back. Found by the new source-build smoke step on its first CI run.
- **Housekeeping never ran.** The hourly maintenance pass failed on every
  install: `pruneDeploymentRows` passed a JavaScript `Date` into a raw
  statement, which the Postgres driver refuses, so old deployment rows and
  their log files were never removed. Confirmed on a live instance (the step
  failed once an hour, every hour). The maintenance logger also swallowed the
  driver's reason, which is why the log only ever said "Failed query: …".
- The audit trail showed a raw uuid instead of the service name on every
  deploy row, and rendered its timestamps in 12-hour time while the rest of the
  panel uses 24-hour.
- Long Docker container, network and volume names ran across the neighbouring
  columns and pushed the rest of the row off the table; they truncate now, so
  the containers list fits without horizontal scrolling.
- The log viewer's errors-only filter hid the very line it exists to find:
  "Deployment failed: …" was not classified as an error because only "failed
  to" matched.
- Twelve middleware fields, two database credential fields, an alert threshold
  and the generated SSH key boxes had visible labels that were never associated
  with their control, so a screen reader announced an unnamed text box.
- Between roughly 850 and 1000 px the organization switcher overlapped the top
  navigation links.
- The "no instance backup" platform alert pointed at "Settings → Backups",
  which is not what that page is called.
- Every dashboard load logged a React hydration error: the recent-deployments
  subtitle rendered "Loading…" on the client while the server had already
  rendered the loaded text. Relative timestamps in the project list, project
  deployments table and schedules panel go through `<DateTime>` now, which is
  hydration-safe.
- The deployment log drawer kept saying "Running" after the deployment it was
  showing had finished.

## [0.2.7] — 2026-09-14

### Fixed

- Builds from source (nixpacks, railpack, Dockerfile) failed on every
  released install with "BuildKit is enabled but the buildx component is
  missing or broken": the image installed the docker CLI without the buildx
  plugin. It ships `docker-cli-buildx` now, and a host without the plugin
  falls back to the classic builder (no layer cache, no BuildKit secrets)
  with a log line saying how to install it, instead of failing the deploy.

## [0.2.6] — 2026-09-14

### Fixed

- The update dialog offered to pull an older image than the one running
  ("This pulls …:v0.2.1" on a v0.2.3 host): `update.sh` rolls the service
  without touching the panel's settings, so the tracked image went stale and
  confirming would have downgraded the instance onto a newer schema. Checks
  adopt the tag the service actually runs, the dialog shows the image that
  will really be pulled, and an update refuses an older release unless a
  downgrade is acknowledged.

## [0.2.5] — 2026-09-14

### Fixed

- Creating a GitHub App reported "No GitHub App installation found" and left
  a configured-looking provider that could not list repositories: the App
  had been created but not yet *installed* on an account. The panel now
  shows Installed / Not installed with an "Install on GitHub" button, and
  stores the installation automatically when GitHub sends you back.

## [0.2.4] — 2026-09-14

### Fixed

- The panel returned Traefik's `500 Internal Server Error` for every
  response with an empty body — the GitHub App callback redirect, empty
  404s, any 204. Traefik's buffering middleware (a 4 MiB request-body
  backstop in front of `/api/`) buffers responses too and fails on a
  bodyless one; it is gone, and the app's own payload caps stand. Existing
  installs pick up the new routing file the next time the dashboard domain
  is saved, or immediately after this update.
- `update.sh` / `install.sh` decide readiness from the new task itself
  (the same check the image HEALTHCHECK runs) before trying the proxy, so a
  working update is no longer reported as a failure when the panel is not
  reachable at `BETTER_AUTH_URL` from the host.

## [0.2.3] — 2026-09-14

### Fixed

- The in-app updater reported "up to date" on every installed release: it
  compared the digest of the tag the installer pinned (`:v0.2.1`) with
  itself. Version-tagged installs now follow GitHub's newest release (under
  the pin) and `Update` rolls to that tag; moving tags keep the digest check.

## [0.2.2] — 2026-09-14

### Fixed

- External connection URLs of databases on the Nixploy host showed
  `localhost`; they now use the host's public address (`NIXPLOY_PUBLIC_HOST`
  to override, detected public IPv4 otherwise).
- Renaming (or changing any single setting of) a database re-sent the
  default image and was refused as a version downgrade on newer instances —
  or silently reset the image. Partial updates leave the image alone.

## [0.2.1] — 2026-09-12

Follow-up to 0.2.0 after its release pipeline was exercised end to end.

### Fixed

- The runtime image ships `openssl`: when the panel provisions Traefik itself
  (compose stacks, dev in a container) it could not create the default TLS
  certificate and `/api/ready` stayed 503.
- MinIO template image moved to `quay.io/minio/minio` (Docker Hub no longer
  serves the tags).
- `tsx` is a dependency of `@nixploy/server` (key rotation script and the CI
  drift check ran `pnpm exec tsx` there).
- Image scan: the base image's bundled npm (with a vulnerable node-tar) is
  removed from the runtime image; the esbuild Go TLS finding is documented in
  `.trivyignore`.
- Release commits use a `[release]` marker; `[skip ci]` also skipped the tag
  push that was supposed to publish. The UI golden path resolves Playwright
  through `NODE_PATH`.
- Dependabot resolves pnpm 10 (`packageManager`) and ignores Node major image
  bumps.

## [0.2.0] — 2026-09-12

First release after the stability sweep and the September improvement audit.
**It changes defaults.** Read
[docs/upgrade-notes.md → v0.2.0](docs/upgrade-notes.md#v020) before upgrading —
in particular org quotas becoming real limits, cross-environment DNS going
away, and `ping` no longer working inside tenant containers.

### Added

- Health endpoints: `GET /api/health`, `GET /api/ready`, `GET /api/version`.
  The image `HEALTHCHECK` and both scripts probe `/api/ready`, so a half-dead
  panel fails its rollout instead of passing.
- Platform self-alerts every 5 minutes: host disk (85 % / 95 %), oldest queued
  deployment (> 30 min), ACME certificate expiry (< 14 days), platform
  services below their desired replicas, and "no instance backup in N days"
  (`NIXPLOY_INSTANCE_BACKUP_ALERT_DAYS`, default 8). Surfaced in `/api/ready`
  and on Monitoring → Fleet; sent to instance-admin notification channels with
  a 24 h cooldown.
- Opt-in weekly Docker cleanup cron (`NIXPLOY_DOCKER_CLEANUP_CRON`).
- Per-environment overlay networks and a tenant-free `nixploy-internal`
  overlay for the panel and Postgres.
- Traefik middleware layer (rate limit, basic auth, IP allowlist, headers,
  compression) and DNS-01 wildcard certificates.
- Backup run history, a `local` destination provider and restore verification.
- `tools/dr-restore-test.sh` — rehearses a restore into a scratch Postgres
  container and, with `--boot`, boots the panel against it.
- `uninstall.sh` — removes the platform services and overlays; `--purge` also
  deletes the volume and config directory after a typed confirmation.
- Installer preflight: ports 80/443, disk, memory, rootless Docker, and a
  DNS-vs-public-IP check before Let's Encrypt, plus firewall one-liners in the
  summary.
- Offline / air-gapped install recipe, `docs/troubleshooting.md`,
  `docs/upgrade-notes.md`, a complete runtime-environment reference in
  `docs/install.md`, a "Platform logs" section in `docs/observability.md`.
- `tools/dev.sh` and `.nvmrc` for a one-command local stack.
- Graceful shutdown (SIGTERM drains the deploy queue), a pre-upgrade
  `pg_dump`, a downgrade guard, and a real `queued` deployment status.
- `tzdata` in the image, so `TZ` actually changes the timezone every cron runs
  in.
- Scoped, organization-bound API keys (`nxp_` prefix, 90-day default expiry),
  a first-admin setup token printed by the installer, and SSO through OpenID
  Connect (`NIXPLOY_OIDC_*`).
- Deploy provenance (commit, author, trigger) with pre-flight checks and
  queue supersede; pre/post-deploy hooks; preview knobs (env, cap, TTL, fork
  approval) with commit metadata; pull-request previews for compose services;
  remote-server builders and optional registry push; incident ack/resolve; a
  public status page; docker-image auto-update.
- Process roles: `NIXPLOY_ROLE=panel|worker` with `install.sh --split-worker`
  (a `nixploy-worker` service takes the deploy queue, crons and Traefik
  provisioning, coordinated over Postgres LISTEN/NOTIFY) and a `/ws/events`
  push stream that replaces dashboard polling.
- Pooled SSH transport to managed servers (keepalive, bounded channels, a
  per-server circuit breaker exposed as `server.transportState`) and bounded
  fan-out in the crons.
- TCP/UDP routing through Traefik: instance-level entrypoints (Settings →
  Server) and `protocol` / `tlsMode` on domains (HostSNI, terminate or
  passthrough).
- Databases: a curated engine version picker (downgrades blocked, major
  upgrades confirmed) and additional logical databases/users per instance.
- Compose rollbacks from per-deploy snapshots, `compose.createFromUrl`, and
  organization template sources (`http-json` / `git`) merged into the catalog.
- Updater release notes and a version pin (`pinnedVersion`,
  `runUpdate({ version, allowDowngrade })`).
- Image schedules (`runMode: image`) and "Run once" jobs under the container
  hardening baseline.
- Prometheus exposition at `GET /api/metrics` (API key) and
  `NIXPLOY_METRICS_RETENTION_HOURS`.
- Server SSH web terminal and a volume file browser (instance admin, audited,
  path-confined).
- Security: address-pinned egress with an instance `allowPrivateEgress`
  toggle, `ENCRYPTION_KEYS` rotation with `nixploy:rotate-key`, build secrets
  off argv (env files, BuildKit secrets), streaming database dumps to S3, audit
  rows with IP / user agent, CSV export and optional forwarding, and rate
  limits that trust forwarded headers only from a trusted socket peer.
- CLI: registry-driven commands, `org list/use`, `audit list --since`,
  `audit export`, 429 handling; MCP with 32 tools; every procedure documented
  in OpenAPI (390 across 44 routers) and the landing API catalog generated
  from it.
- CI: a real end-to-end job on a Swarm, a UI golden path, cosign-signed
  images, SHA-pinned actions, installer checksums (`SHA256SUMS`), knip and
  Biome warnings as errors.

### Changed

- **No global HTTP → HTTPS redirect** in the static Traefik config — it
  overrode every domain's own `https` toggle. Domains with HTTPS on keep
  redirecting through a per-router `redirectScheme` middleware; a domain with
  HTTPS off is served plain on `:80`. `update.sh` migrates existing installs.
- **Org quotas `maxCpuShares` / `maxMemoryMb` are applied as per-service
  resource limits** when a service sets none.
- **Instance dumps use `pg_dump --clean --if-exists`**, so they restore over a
  database the panel already migrated; the restore procedure is reordered to
  match.
- Container hardening on every tenant container: `CapabilityDrop: ALL` plus a
  seven-cap add-set, `NoNewPrivileges`, `pids_limit` 1024, `nofile` 65536,
  rotating json-file logs.
- Builders receive **only** `buildArgs`; runtime env is no longer merged into
  the build environment (`NIXPLOY_BUILD_WITH_RUNTIME_ENV=1` restores it).
- Commands time out after 30 minutes, deployments after 60.
- The dashboard catch-all router is dropped once a dashboard domain is
  configured — the panel then answers on that host only.
- `install.sh` / `update.sh` forward **every** documented runtime knob when it
  is set, so it survives later updates.
- New installs give `nixploy-postgres` a `pg_isready` healthcheck, rotated
  logs and a 60 s stop grace; existing installs opt in with
  `NIXPLOY_UPDATE_POSTGRES_SPEC=1`.
- Compose files are rendered before validation, and the deny-list grew
  (`cgroup_parent`, oversized `tmpfs`, foreign log drivers, `deploy.mode:
  global`, manager-targeting placement, …).
- Instance backups, Swarm joins, the manager role, wildcard domains,
  `networkSwarm` overrides and host-privileged `compose.update` are
  instance-admin only.
- Unified service pages: one header, one tab order and one status badge across
  applications, compose and the five database kinds.
- API keys are minted with the `nxp_` prefix and expire after 90 days by
  default; existing keys keep working.
- Audit log: `organization_id` is nullable (history survives an
  organization's deletion) and rows carry `ip`, `user_agent` and
  `organization_name`; auth events write those as columns, not `metadata`.
- LAN targets for notifications, SMTP, registries and S3 need the instance
  toggle Settings → Server → "Outbound requests" (default off).
- Changing Traefik entrypoints restarts the proxy (about nine seconds of no
  routing); the static config is regenerated from the entrypoint table.

### Removed

- **`.env` is no longer included in instance backups** — shipping
  `ENCRYPTION_KEY` next to the dump it protects handed every tenant credential
  to whoever could read the bucket. Keep your own copy.
- Six dead tRPC procedures. The one with callers in the wild:
  `application.saveDockerProvider` → use `application.saveSource`
  (`{ sourceType: "docker", dockerImage }`).
- `NET_RAW` from tenant containers — `ping` inside a container and Uptime Kuma
  ICMP monitors no longer work (HTTP/TCP monitors are unaffected).
- Cross-environment and cross-organisation service DNS.

### Fixed

- HTTPS domains using the default certificate never routed.
- A deploy no longer wipes a domain's Traefik middleware chain.
- Boot recovery re-enqueues `queued` deployments and fails leftover `running`
  ones instead of leaving them hanging.
- Every compose domain routed to a nonexistent upstream name
  (`<app>-<svc>-<svc>-1`) and answered 502.
- A deployment was marked done before any task ran; it now waits for a
  running task and fails with the engine's reason when tasks keep failing.
- A queued backlog found at boot sat until the first request touched the
  deploy engine.
- Duplicate host or app names leaked the raw SQL statement to the client.
- Throttled API keys answered 401 instead of 429 with `Retry-After`.
- A stale session cookie looped between `/login` and `/dashboard`.
- The projects dashboard stayed on its empty state after the first project
  until a reload.
- Multi-arch images were listed once per platform under Docker → Images.

## [0.1.0]

Initial public release: projects, environments, applications, compose stacks,
five managed database engines, Git and Docker sources, Traefik routing with
Let's Encrypt, backups, schedules, notifications, monitoring, the REST/OpenAPI
adapter, the MCP endpoint and the published CLI.
