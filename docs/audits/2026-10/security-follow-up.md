# Authorization and dependency follow-up — 2026-10-20

Baseline: main `ba76640`. This bounded review does not establish that every
vulnerability is eliminated. Workspace packages, development tools, the Node
executable and the built image are distinct inventories.

## Authorization

- Protected requests fail closed if project visibility cannot be resolved.
  One failed authorization query does not imply later data queries will fail.
  Trusted workers/crons outside a caller scope retain unrestricted access.
- ZIP source-upload and generic deploy-webhook lookups now resolve current
  project visibility in addition to organization membership. Existing API-key
  organization bindings and capability ceilings remain. Both direct routes
  enforce the organization SSO requirement as well as 2FA.
- Copilot checks project visibility before cached explanations, logs/context
  or environment changes, for both application and Compose parents. Hidden
  projects remain indistinguishable from absent ones.

The new tests first reproduce the pre-fix bypasses, then cover denial,
authorized requests and later recovery. They exercise actual authorization
helpers/middleware with controlled database/side-effect boundaries; they do
not read tenant logs, upload source or deploy against the primary database.

## Fresh package inventory

Commands: `pnpm audit --prod --json`, `pnpm audit --json` and
`npm audit --omit=dev --json --prefix docker/migrate-deps`. Counts are reported
package/path findings, not independently reachable exploits.

| Inventory | Before | After |
| --- | --- | --- |
| Production workspace | 2 moderate | 1 moderate |
| Entire workspace | 8 high, 9 moderate, 4 low | 1 high, 1 moderate, 1 low |
| Separate migration runner | 0 | 0 |

Compatible updates preserve existing major versions and the Vitest 5 runner:

| Path | Resolution | Primary evidence |
| --- | --- | --- |
| MCP SDK → Hono | 4.13.7 → 4.13.13; override floor 4.13.11 | [Static-path middleware bypass](https://github.com/advisories/GHSA-5r4p-p66f-jhc7). Nixploy uses MCP's web-standard transport, not Hono static serving. |
| Web development → shadcn | 4.21.0 → 4.22.1 | [Upstream release](https://github.com/shadcn-ui/ui/releases/tag/shadcn%404.22.1). The imported Tailwind stylesheet and registry tooling remain. |
| shadcn → MCP SDK | 1.29.0 removed; shares 1.32.1 | [OAuth credential disclosure](https://github.com/advisories/GHSA-6qxp-vccf-f47h). The vulnerable OAuth client is distinct from Nixploy's MCP server. |
| shadcn → Undici | 7.29.0 → 7.30.1 | Includes fixes for [TLS option loss](https://github.com/nodejs/undici/security/advisories/GHSA-w293-vg96-wgc3), [WebSocket subprotocol crash](https://github.com/nodejs/undici/security/advisories/GHSA-rfgv-xxqx-mfg5) and the related cache/retry/decompression findings in the raw audit. This npm update does not patch Node's bundled Undici. |
| shadcn → ts-morph → minimatch → brace-expansion | 5.0.9 → 5.0.12 | [Quadratic rewrite](https://github.com/advisories/GHSA-q2hr-2g5m-vwhr), [nested groups](https://github.com/advisories/GHSA-qhr7-859c-m2p7), [comma recursion](https://github.com/advisories/GHSA-6j4f-fj2g-mc7p). |
| shadcn → cosmiconfig → js-yaml | Old subtree removed; existing override floor raised to 4.3.2 | [Ordered-map CPU exhaustion](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [empty merge-source budget bypass](https://github.com/advisories/GHSA-2883-xcg3-v3hh). Nixploy's own YAML implementation remains `yaml`. |
| shadcn → postcss-selector-parser | 7.1.4 → 7.1.6 | [Flat-selector CPU exhaustion](https://github.com/advisories/GHSA-rj75-hqrm-r3gf). Typography's separate major-6 pin remains below. |

## Explicit residual risk

| Finding | Reachability and decision |
| --- | --- |
| High: `braces@3.0.3`, [CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | shadcn → fast-glob → micromatch. No patched release is published. Deeply nested attacker-controlled patterns exhaust the stack. Request handlers and repository scripts do not run this generator, but the panel build imports `shadcn/tailwind.css`, so it is not an unused package. Do not feed untrusted patterns/configuration to the tool. A supported parent fix or separately reviewed replacement of its stylesheet/tool contract remains necessary. No patch or audit suppression is claimed. |
| Moderate: `postcss-selector-parser@6.0.10`, [CVE-2026-104844](https://github.com/advisories/GHSA-rj75-hqrm-r3gf) | Latest Typography 0.5.20 still [pins 6.0.10](https://github.com/tailwindlabs/tailwindcss-typography/blob/v0.5.20/package.json). It processes trusted landing CSS at build time. The fix is 7.1.6; forcing an unsupported major is outside this change. Recheck the parent release. |
| Low: `esbuild@0.27.7`, [GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) | tsup 8 is required by CLI build/watch scripts. Its current major requests esbuild 0.27; the fix is 0.28.1. The advisory concerns the Windows development server, which those scripts do not launch. Do not expose that serving API. A supported tsup transition remains separate work. |

The Dockerfile copies the installed workspace store, including development
packages. Development-only reachability does not mean those files are absent
from the image. Trivy retains its existing advisory mode (`exit-code: 0`);
a green image-build job does not establish a clean scan. The production npm
high/critical audit remains blocking and unchanged.

## Node and image boundary

The local audit process reports Node **22.21.0**, bundled Undici **6.22.0** and
OpenSSL **3.5.4**, which pnpm does not audit or update. Node's
[June security release](https://nodejs.org/en/blog/vulnerability/june-2026-security-releases)
updated the 22.x line and its libraries; [22.23.3](https://nodejs.org/en/blog/release/v22.23.3)
includes Undici 6.28.1 and OpenSSL 3.5.8. This workstation remains behind
published security updates. The change does not replace its Node installation
or restart the operator's panel.

As of October 20, Node has [announced a security release for October 21](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases),
including a high-severity issue in 22.x. That release is not verified here.
Operators should apply the supported security release when available and
rebuild/redeploy, checking actual Node/OpenSSL/Undici versions inside the image.
The floating `node:22-alpine` tag does not update existing containers. No claim
is made about the user's current image digest, Alpine advisory count or a
future unbuilt image.

## Evidence and preservation

Audit JSON, red/green regression output and gate logs live under
`.nixploy-data/verification/security-audit-20261020/` in the audit worktree.
Read-only primary observations captured 69 public tables, 2 users, four
service identities, 74 volume names, current networks and seven proxy-file
hashes. Tests use isolated data. No primary environment, account, workload,
proxy file or source checkout is rewritten by these fixes.

Local gates passed 3,299 server tests (the optional image-registry probe is the
sole skip), 118 web tests, 94 CLI tests and six smoke-error tests. All four
workspace TypeScript checks, strict Biome, knip and all three production builds
passed. The temporary Postgres databases were removed. Final primary counts
remain 69 tables / 2 users, login returns HTTP 200, and every original Docker
identity and proxy hash is preserved. One additional unattributed volume is
preserved rather than pruned. The shadcn stylesheet diff only adds
reduced-motion handling for the unused `shimmer` utility; no UI component or
existing rendered style is changed, and no new browser verification is claimed.
Merge still requires independent review and exact-head CI.
