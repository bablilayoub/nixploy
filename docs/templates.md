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

## Deploy flow

`DeployTemplateDialog` asks for project + environment, the declared env vars
(`generate: true` values are filled with random secrets), and an optional
domain. It creates a **compose** service with the template's compose file,
env, and optional domain (subject to the org's service quota), then queues its first deployment. The server side
is the standard compose create + deploy path — templates carry no special
runtime logic.

## Template sources (bring your own catalog)

The built-in catalog is compiled into the image, so it only changes with a
release. An organization can add its own catalogs under
**Settings → Templates** (product audit, Platform row "Templates are a fixed
TS catalog"). Sources are **org-scoped**: a source belongs to one organization
and only ever appears in that organization's gallery.

Two kinds:

| Kind | What it points at |
| --- | --- |
| `http-json` | One JSON document: a bare array of templates, or `{ "templates": [ … ] }` so the index can carry its own metadata. |
| `git` | A repository whose `templates/index.json` has that same shape. Cloned shallow, read, and discarded — only the cache survives. |

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
   shell-safe, compose body ≤ 128 KiB, ≤ 500 templates per source);
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

## Deploy from a compose URL

`compose.createFromUrl({ url, environmentId, name })` creates a raw compose
service from a compose file at an http(s) URL. The URL goes through the same
egress guard, the body through the same safety checks `saveComposeFile` runs,
and nothing is deployed until `compose.deploy`.

Give it the **raw** file URL: redirects are not followed, and an HTML response
(the usual mistake — a repository page instead of the raw file) is rejected
with that message.
