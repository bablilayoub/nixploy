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
     setup: ["Add `*.tunnels.example.com` as a second domain …", "…"],
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
runtime logic. With *Create DNS records automatically* on (Settings →
Platform → DNS provider), every host the dialog attaches also gets its A
record at the linked provider; the result's `dns` array says what happened
per host (docs/domains-traefik.md § "DNS records created for you").

## Template sources (bring your own catalog)

The built-in catalog is compiled into the image, so it only changes with a
release. An organization can add its own catalogs under
**Settings → Templates** (product audit, Platform row "Templates are a fixed
TS catalog"). Sources are **org-scoped**: a source belongs to one organization
and only ever appears in that organization's gallery.

Three kinds:

| Kind | What it points at |
| --- | --- |
| `http-json` | One JSON document: a bare array of templates, or `{ "templates": [ … ] }` so the index can carry its own metadata. |
| `git` | A repository whose `templates/index.json` has that same shape. Cloned shallow, read, and discarded — only the cache survives. |
| `blueprints` | A repository laid out as `blueprints/<id>/{meta.json, template.toml, docker-compose.yml}` — the format of the Dokploy templates catalog (`https://github.com/Dokploy/templates.git`, 500+ entries). Each folder is translated by `modules/templates/blueprints.ts`: `[variables]` helpers become deploy-time placeholders named after the variable (so a password used in three keys is generated once), `${domain}` becomes `{{domain}}`, `[[config.mounts]]` files become inline compose `configs:` (the volume line that referenced `../files/<file>` becomes a `configs:` attachment), an undeclared `../files/<dir>` becomes a named volume of the stack, `env_file: .env` becomes explicit `KEY: ${KEY}` entries, and a blueprint with no domain gets its first `expose:`d port suggested. Every translated entry then goes through the same compose safety checks a deploy runs, so a template that mounts the Docker socket, binds host paths, publishes host ports or asks for privileged capabilities is a rejection line, not a gallery card that fails at deploy. On the public catalog that is 417 of 532 deployable (2026-09-19); the rest are listed with their reason on the source row. |

Entries use exactly the `Template` shape above, minus two fields: `category`
defaults to `"Custom"` when omitted, and **`hostPrivileged` is never accepted
from a remote source** (it relaxes the compose safety checks and is an
instance-admin decision about the built-in catalog only).

### Syncing

Nothing is fetched while browsing the gallery. **Sync now** (or
`template.sourcesSync`) does the work and writes
`<config>/templates/sources/<id>.json` with mode `0600` — compose bodies
routinely carry example credentials.

A sync:

1. fetches the index through the egress guard — `assertSafeOutboundUrl` +
   `pinnedFetch` for `http-json` (https only unless the instance allows
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

`compose.createFromUrl({ url, environmentId, name })` creates a raw compose
service from a compose file at an http(s) URL. The URL goes through the same
egress guard, the body through the same safety checks `saveComposeFile` runs,
and nothing is deployed until `compose.deploy`.

Give it the **raw** file URL: redirects are not followed, and an HTML response
(the usual mistake — a repository page instead of the raw file) is rejected
with that message.
