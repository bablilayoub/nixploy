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
     version: "v2.1.0",
     logo: "plausible",                  // simpleicons.org slug
     links: { github: "…", website: "…", docs: "…" },
     tags: ["analytics"],
     env: [                              // variables the deploy dialog asks for
       { key: "BASE_URL", description: "…", defaultValue: "http://localhost:8000" },
       { key: "SECRET_KEY_BASE", description: "…", generate: true }, // random on deploy
     ],
     compose: `services:\n  plausible:\n    image: …`,   // YAML, no host ports
     suggestedDomain: { service: "plausible", port: 8000 },
   }
   ```

3. Run `pnpm test` — the catalog tests will reject invalid YAML, dangling env
   refs, duplicate ids or host ports.

The gallery UI (search + category pills) and the ⌘K palette pick new entries
up automatically — no frontend changes needed.

## Deploy flow

`DeployTemplateDialog` asks for project + environment, the declared env vars
(`generate: true` values are filled with random secrets), and an optional
domain. It creates a **compose** service with the template's compose file,
env, and optional domain, then queues its first deployment. The server side
is the standard compose create + deploy path — templates carry no special
runtime logic.
