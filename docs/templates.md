# Templates

One-click deployable compose stacks, shown in the **Templates** gallery and
deployable as compose services. Catalog code lives in
`packages/server/src/modules/templates/`.

## Layout

- `types.ts` — `Template` (public shape, includes `category`) and
  `TemplateData` (`Omit<Template, "category">`, what data files declare).
- `data/<category>.ts` — one file per category (apps, cms, databases, ai,
  security, storage, …), each exporting a `TemplateData[]`.
- `catalog.ts` — wraps every data file with `categorize(category, list)` and
  exports the full ordered catalog.
- `catalog.test.ts` — validates **every** template automatically:
  unique kebab-case ids, valid compose YAML, env refs matching
  `${VAR}` declarations bidirectionally, no host ports published,
  `suggestedDomain.service` existing in the compose file, non-empty category.
- `images.ts` / `images-health.test.ts` — extracts every `image:` ref and
  (when `TEMPLATE_IMAGE_CHECK=1`) probes registry manifests so CI catches
  unpublished tags. Locally: `pnpm test:template-images`.

## Adding a template

1. Pick the right `data/<category>.ts` (or create a new one and register it
   in `catalog.ts` with `categorize("New Category", ...)`).
2. Append a `TemplateData` entry:

   ```ts
   {
     id: "plausible",                    // unique, kebab-case
     name: "Plausible",
     description: "…",
     // `category` comes from the file wrapper in catalog.ts — do NOT set it here
     logo: "plausible",                  // simpleicons.org slug, or absolute image URL
     links: { github: "…", website: "…", docs: "…" },
     tags: ["analytics"],
     env: [
       { key: "BASE_URL", description: "…", default: "http://localhost:8000" },
       { key: "SECRET_KEY_BASE", description: "…", default: "{{generateSecret}}" },
     ],
     compose: `services:\n  plausible:\n    image: …`,
     suggestedDomain: { serviceName: "plausible", port: 8000 },
     // Optional: what to do after deploying, in order, one short step each.
     // Rendered as a numbered list in the panel's template details and on
     // nixploy.com/templates/<id>. Only for templates whose first use is not
     // "open the URL" — a tunnel edge that needs a second domain and a CLI
     // pointed at it, a service that needs a client configured.
     setup: ["Point the CLI at the endpoint host …", "…"],
     // Optional: hostnames the stack needs, read from env values at deploy
     // and attached as domains of the compose service (HTTPS + Let's
     // Encrypt unless `https: false`; `wildcard: true` attaches `*.<value>`,
     // which is instance-admin only and gets the DNS-01 resolver when a
     // provider is linked, else no certificate). A value left at the
     // template's placeholder attaches nothing. With automatic DNS records
     // on, the A records are created at the provider too.
     domains: [
       { env: "TUNNEL_ENDPOINT_HOST", serviceName: "openhole", port: 8080 },
       { env: "PUBLIC_TUNNEL_DOMAIN", serviceName: "openhole", port: 8080, wildcard: true },
     ],
   }
   ```

3. Run `pnpm test` — the catalog tests will reject invalid YAML, dangling env
   refs, duplicate ids or host ports.
4. Regenerate the landing catalog, which is what nixploy.com/templates and the
   per-template pages render:

   ```bash
   pnpm -F @nixploy/server exec tsx ../../apps/landing/scripts/generate-template-catalog.mts
   pnpm exec biome check --write apps/landing/src/lib/templates.ts
   ```

   `apps/landing` deliberately has no dependency on `@nixploy/server` (it would
   pull drizzle, dockerode and ssh2 into a marketing build), so the data is
   generated and committed, the same way `docs/api-catalog.ts` is. Compose
   bodies are not copied — `images`, `volumes` and `env` are derived from them
   once, at generation time.

The gallery UI (search + category pills) and the ⌘K palette pick new entries
up automatically — no frontend changes needed. A new template also gets its own
page at `nixploy.com/templates/<id>`, in the sitemap, once step 4 has run.

## Env placeholders

A template's env `default` may carry placeholders that the panel resolves at
deploy time, before the value reaches the stack's `.env`
(`modules/templates/placeholders.ts`):

| Placeholder | Resolves to |
| --- | --- |
| `{{generateSecret}}` | 48 hex characters, fresh per occurrence (the original one) |
| `{{generatePassword:N:name}}` | N alphanumeric characters |
| `{{generateBase64:N:name}}` | base64 of N random bytes |
| `{{generateHash:N:name}}` | N hex characters |
| `{{generateUuid:name}}` | a UUID |
| `{{generateJwt:name:<base64url JSON>}}` | an HS256 JWT signed with the named value |
| `{{domain}}` | the host attached to the suggested service at deploy, else `localhost` |
| `{{env:OTHER_KEY}}` | another key's resolved value |

A trailing `:name` makes a generator **memoised for the deploy**: every
placeholder with the same name resolves to the same value, which is how a
database password can appear in `POSTGRES_PASSWORD` and inside
`DATABASE_URL` and still be one password. Without a name, each occurrence is
fresh. A value the operator provides at deploy is taken verbatim.

## Deploy flow

`DeployTemplateDialog` asks for project + environment, the declared env vars
(`generate: true` values are filled with random secrets), and an optional
domain. It creates a **compose** service with the template's compose file,
env, and optional domain (subject to the org's service quota), then queues its first deployment. The server side
is the standard compose create + deploy path — templates carry no special
runtime logic. A template's `domains` hints add hosts from the env values
the operator typed (the dialog previews them on the Domain step; `template.deploy`
needs `domains.manage`, and the instance admin for a wildcard): a host already
routed on the instance is skipped with a note rather than failing the deploy.
With *Create DNS records automatically* on (Settings → Platform → DNS
provider), every host attached — typed or hinted — also gets its A record at
the linked provider; the result's `domains` and `dns` arrays say what happened
per host (docs/domains-traefik.md § "DNS records created for you").

## MinIO and Authentik startup notes

MinIO's community release is distributed as source. The template uses the
official `golang:1.27.2-alpine` image and compiles the pinned upstream version
`v0.0.0-20251015172955-9e49d5e7a648` (release
[`RELEASE.2025-10-15T17-29-55Z`](https://github.com/minio/minio/releases/tag/RELEASE.2025-10-15T17-29-55Z)).
The first start needs outbound access to the Go module proxy and checksum
database. Go verifies module checksums; `GOTOOLCHAIN=local` prevents a separate
toolchain download. A ten-minute health-check grace period covers compilation.
The API stays on port 9000 and console on 9001; root credentials retain the
same env names. `minio-data:/data` preserves objects and `minio-build:/go`
preserves the binary, modules and build cache. Deleting the build volume
requires another download and compilation; deleting the data volume deletes
objects.

On the verification host (native Linux arm64), a cold compile with modules
already downloaded took 73 seconds at 2 CPUs / 1 GiB and reached the full
1 GiB memory limit. The cached build volume used about 2.3 GB; a warm restart
took 1.5 seconds. Allow several minutes, memory headroom and this extra disk
space on a small VPS. These measurements are observations, not minimum
requirements or startup guarantees. Authenticated S3 writes, reads and data
survival across recreation were checked.

The Authentik template pins both server and worker to `2026.8.4`, uses
PostgreSQL without Redis, and mounts the existing `authentik-media` volume at
the current `/data` path. The database and templates volumes keep their names.
Template updates apply to new deployments; saved compose files are not
rewritten. Review the upstream upgrade notes before changing an existing
Authentik deployment, especially one running a much older release.

## Template sources (bring your own catalog)

The built-in catalog is compiled into the image, so it only changes with a
release. An organization can add its own catalogs under
**Settings → Templates** (product audit, Platform row "Templates are a fixed
TS catalog"). Sources are **org-scoped**: a source belongs to one organization
and only ever appears in that organization's gallery.

Four kinds:

| Kind | What it points at |
| --- | --- |
| `http-json` | One JSON document: a bare array of templates, or `{ "templates": [ … ] }` so the index can carry its own metadata. |
| `git` | A repository whose `templates/index.json` has that same shape. Cloned shallow, read, and discarded — only the cache survives. |
| `coolify` | Coolify's generated `templates/service-templates.json` index, keyed by template id with Base64-encoded Compose. Select **Coolify catalog** in Settings → Templates to prefill the official source, or provide a compatible fork's URL. Each entry is translated explicitly, validated and checked by the existing Compose safety rules. |
| `blueprints` | A repository laid out as `blueprints/<id>/{meta.json, template.toml, docker-compose.yml}` — the format of the Dokploy templates catalog (`https://github.com/Dokploy/templates.git`, 500+ entries). Each folder is translated by `modules/templates/blueprints.ts`: `[variables]` helpers become deploy-time placeholders named after the variable (so a password used in three keys is generated once), `${domain}` becomes `{{domain}}`, `[[config.mounts]]` files become inline compose `configs:` (the volume line that referenced `../files/<file>` becomes a `configs:` attachment), an undeclared `../files/<dir>` becomes a named volume of the stack, `env_file: .env` becomes explicit `KEY: ${KEY}` entries, `traefik.*` labels are dropped (routing here is a domain row, not a label), the blueprint's tags are resolved to one of this catalog's own categories (`modules/templates/categories.ts` — the first tag that maps wins, generic tags like `self-hosted` are deliberately unmapped, and anything unrecognized lands in `Community`; taking the first tag verbatim gave **209 categories for 436 templates**, 125 of them holding one entry), and a blueprint with no domain gets its first `expose:`d port suggested — or, when nothing is exposed at all, its first service on 80 as a placeholder, because a tunnel client or a cache is still worth having. Every translated entry then goes through the same compose safety checks a deploy runs, so a template that mounts the Docker socket, binds host paths or asks for privileged capabilities is a rejection line, not a gallery card that fails at deploy. On the public catalog that is 436 of 532 deployable (2026-09-20); the rest are listed with their reason in the source's sync report. |

JSON and Git index entries use the `Template` shape above: `category`
defaults to `"Custom"` when omitted, and **`hostPrivileged` is never accepted
from a remote source** (it relaxes the compose safety checks and is an
instance-admin decision about the built-in catalog only).

### Coolify compatibility

The source format and generated-variable meanings follow the official
[template contribution guide](https://coolify.io/docs/contribute/service) and
[Compose variable reference](https://coolify.io/docs/services/configuration/docker-compose).
The translator supports one public Compose service target, optional internal
port suffixes, ordinary named volumes (including omitted top-level declarations),
`SERVICE_NAME`, `SERVICE_USER`, `SERVICE_LOWERCASEUSER`, `SERVICE_PASSWORD`,
`SERVICE_PASSWORDWITHSYMBOLS`, `SERVICE_BASE64`, `SERVICE_REALBASE64`, and `SERVICE_HEX`
with their documented sizes. The same complete variable name always resolves to
one value within an installation. A new installation generates fresh values;
ordinary redeploys keep the values saved in the Compose service's encrypted env.
`BASE64` produces alphanumeric text; `REALBASE64` encodes random bytes.

`SERVICE_FQDN` produces a hostname and `SERVICE_URL` produces an HTTP URL for the
domain attached at installation. Domain-dependent templates require that domain.
The initial domain uses HTTP; after enabling HTTPS in Domains, update the saved
`SERVICE_URL` values accordingly. Some legacy upstream templates use FQDN values
where their application expects a full URL: review the upstream application docs
and adjust those environment expressions before deploying. Bare environment keys
become explicit references. `${KEY:-value}` / `${KEY-value}` initialize defaults;
`${KEY:?value}` initializes a required field, matching the source's convention.
Missing required fields fail before a service row is created.

Multiple public targets, domain path suffixes or overrides, ambiguous magic
names, Supabase-specific JWT generation, nested interpolation, Coolify-only inline
file mounts and health-check exclusions are rejected with a per-entry reason.
Host mounts, sockets, capabilities, networking and port publishing still use the
same safety and instance-admin gates as every other source. A successful sync
means accepted definitions were indexed; it does not prove every application
starts or imports existing data. Read the sync report and test the selected stack.

**Published host ports are indexed, not rejected.** A catalogue entry is not a
running stack: `ports:` is refused on a compose row that has not opted in, but
a template whose file publishes ports is a normal thing to list, so the sync
validates it *as* a published-port stack — the same rules a stack with the
option on gets (no privileged or platform port, no host bind address, no
ranges) — and flags it. Deploying one creates the stack with **Publish host
ports** already on, and needs the instance admin, because those ports bypass
Traefik and with it domains, TLS, middlewares and the access log. The flag is
derived from the compose body on both sides (`modules/templates/safety.ts`),
never read from the source document, so an older cache cannot skip the gate.

### Syncing

Nothing is fetched while browsing the gallery. **Sync now** (or
`template.sourcesSync`) does the work and writes
`<config>/templates/sources/<id>.json` with mode `0600` — compose bodies
routinely carry example credentials.

A sync:

1. fetches the index through the egress guard — `assertSafeOutboundUrl` +
   `pinnedFetch` for `http-json` and `coolify` (https only unless the instance allows
   private egress, only vetted addresses dialled, **redirects are never
   followed**, body capped at 4 MiB), `assertSafeGitCloneUrl` plus the
   hardened git environment for `git`;
2. validates every entry with zod (ids kebab-case, links https, env keys
   shell-safe, ≤ 200 env keys, compose body ≤ 128 KiB, ≤ 1000 templates per
   source);
3. probes every image the templates reference with the same registry check
   `pnpm test:template-images` uses.

**A bad entry is dropped with a reason, not fatal** — one broken template in a
200-entry catalog should not take the other 199 offline. **An unreachable
image is a warning, not a rejection** — a template pointing at a private
registry is perfectly valid, we simply cannot confirm its tag anonymously.
Both show up on the source row in Settings → Templates.

Remote ids are namespaced `<templateSourceId>/<id>`, so a source can never
shadow a built-in template, and the gallery card carries the source's name as
a badge. Disabling a source hides its templates immediately; deleting one
drops the row and the cache — services already deployed from it are untouched.

Managing sources requires the **admin** or **owner** org role: a source's
compose bodies become deployable templates for the whole organization.

## Export a running stack as a template

The reverse of a template source: **Settings → Export as template** on a
compose service (`compose.exportTemplate`, `nixploy compose export-template
<id> -o shop.template.json`) downloads the stack in exactly the shape a
source serves — validated with `remoteTemplateSchema` on the way out, so a
file written by this never fails a sync. Put it in a repository's
`templates/index.json` (or behind an https URL) and add it as a source on any
instance, including this one.

Three rewrites, each listed next to the download:

- a **secret-shaped env key** (`PASSWORD`, `TOKEN`, `KEY`, `SECRET`, …)
  leaves with `{{generateSecret}}` as its default — a template is for
  redistribution, and a real credential must never leave in one;
- a value that is one of the stack's **own hostnames**, bare or as a URL,
  becomes `{{domain}}` (`https://shop.example.com/app` →
  `https://{{domain}}/app`), so a `BASE_URL` is right on the first deploy
  elsewhere;
- everything else is kept verbatim as the default — the values the operator
  already chose are the sane ones.

The suggested domain is the stack's first routed HTTP domain, else the first
service that publishes or exposes a port. Raw-source stacks only (a git-backed
stack's file lives in the repository); a host-privileged stack is refused,
since a source cannot carry `hostPrivileged`. The export needs `secrets.read`
— it embeds the env defaults. **Check the remaining defaults before
publishing the file**: a credential that rides inside a URL under a key that
is not secret-shaped (`DATABASE_URL=postgres://user:pw@db/…`) is kept
verbatim, because only the key is inspected.

## Deploy from a compose URL

In a project environment, choose **Add service → Compose**. Paste YAML or
upload a `.yml` / `.yaml` file (up to 1 MiB), choose **Raw file URL** to fetch
one (up to 256 KiB), or choose **Set up later** for an empty service. Choose
Docker Compose for a single server or Docker Stack for Swarm. Creating opens
the Compose file tab for review; no containers start until you choose Deploy.
Add environment variables and domains before that first deployment.

`compose.createFromUrl({ url, environmentId, name })` creates a raw compose
service from a compose file at an http(s) URL. The URL goes through the same
egress guard, the body through the same safety checks `saveComposeFile` runs,
and nothing is deployed until `compose.deploy`. `compose.create` also accepts
an optional `composeFile` when `sourceType` is `raw`. Validation happens
before the service row is inserted, so a refused file leaves no empty service.

Give it the **raw** file URL: redirects are not followed, and an HTML response
(the usual mistake — a repository page instead of the raw file) is rejected
with that message. Private addresses require private egress to be enabled
by the instance admin. Host binds, host port publishing and `build:` blocks
are refused on initial creation; use images and named volumes, route through
domains, or create an empty service and configure the supported options
before saving an adjusted file. No external files or data volumes are copied.
