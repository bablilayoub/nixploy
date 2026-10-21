# Fieldwork detailed refinement

Follow-up: the user likes the direction but rejects the shallow application to detailed pages. Preserve direction and all existing data/settings/contracts. No new dependencies.

Craft read: an operational workspace for developers, restrained Fieldwork product language, variance 4. Keep the project inventory as the signature; improve task order, navigability and feedback throughout detailed workflows.

## Concrete changes and acceptance

| Family | Observed problem | Intended result |
|---|---|---|
| Compose general | Source follows six deployment controls; switches sit in individual cards; save is distant | Source first, grouped behavior and separate commands; stable draft and one clearly scoped save |
| Application advanced | Eight equal pill tabs at a third navigation level; category meanings absent | Descriptive category rail on desktop, native selector on narrow screens; existing URL deep links preserved |
| Application general | Long source/build/resources form without overview or shortcuts | Saved configuration context and section navigation; truthful image/build behavior |
| Profile / organization / platform | Long undifferentiated stacks make lower tasks hard to find | Named groups with jump navigation; direct anchors, keyboard focus and dirty forms retained |
| Database general / connection | Identity and upgrade controls mixed; connection context and exposure state easy to miss | Identity separate from engine controls; clear internal/external connection context, described validation |
| Fleet monitoring | Unsearchable flat service list and unlabeled percentage pair | Search by project/environment/service, explicit selection and metric labels, useful no-match recovery |
| Environment | Large masked list lacks key search; truncated keys and values | Search keys without revealing secrets; readable rows, visible no-match reset, counts |
| Deployments | Tall metadata ladders and repeated actions slow scanning | Compact identity/status/time/action alignment with preserved log deep links and commit operations |
| Backups / schedules | Inventory requires row-by-row inspection to understand protection/activity | Real enabled/paused/failed summaries, actionable empty states and schedule status filtering |
| Migrations | Long disclosure and identical step cards obscure current step | Explicit connect/review/import progress and scannable preservation boundaries |

All remaining routes are rechecked against primary task, information order, actions, states, responsive behavior and keyboard access. Retain a sound page only with a concrete reason; no file-touch quota. Verify actual revised flows in both themes and narrow layouts. Independent design/a11y review is a separate gate.

## Completed review decisions

The listed changes are implemented. Added concrete recovery work from independent review: backup-code sign-in with one-use verification, persistent authenticator errors, failed API-key deletion retaining its dialog, native multi-select checkbox semantics, provider/SSH/passkey/Docker query retries, required notification fields, mobile dirty-navigation guards and branding drafts. Fixed populated mobile log rows, measured save-bar clearance, header-aware section anchors and enlarged-text dashboard rows.

| Remaining family reviewed | Decision |
|---|---|
| Project inventory / project environment, deployment and recovery tabs | Keep the selected project composition, scoped service toolbar and environment selector. Recovery object keys move into copyable details; recovery confirmations and typed service links remain. |
| Applications, Compose and all five database kinds | Directly revise general/build/connection, deploy, domains, environment, backups, schedules, advanced and settings paths as described above. Retain working live log/terminal/metrics editor surfaces and URL aliases. |
| Servers, SSH keys, certificates, registries, notifications, backup storage, template sources and Git providers | Their resource-first headers/tables and existing create/edit dialogs already fit Fieldwork. Keep their inventory structure; improve server validation, notification requirements, lookup recovery and Docker actions where concrete friction remained. |
| SSO, organization security / quotas / members / teams | Remove duplicated SSO headings and creation buttons; keep capability-scoped forms and existing confirmations. Organization groups now expose identity/configuration separately from people/access and deletion. |
| Login, setup, forgot/reset password and invitations | Keep the existing sequential forms and scoped recovery messages. Two-factor gets the missing backup-code path and persistent errors. No registration or policy change. |
| Public status, errors, maintenance, Swagger | Add visible freshness, manual/automatic status refresh and offline state. Retain truthful error/retry and API explorer contracts. |
| Marketing home, features, pricing, comparisons, API, agents, about/privacy and template detail | Retain canonical content and the selected Fieldwork layout. Refresh product captures, add searchable template discovery and narrow-screen article navigation. |

## Verification receipt

The322-route light/dark sweep found no runtime/hydration errors, outside overflow or unnamed controls. The420-case reflow sweep caught two dashboard overflow cases at320px/200%; a32-case focused layout/anchor pass closed those and verified section focus below the measured sticky header. The23 primary browser interaction cases and10 additional edge cases pass. A real-component12-option facet proof passes both themes;20 populated controls retain their sizing/labels without invoking operations. A disposable enrolled account verified an unused backup code signs in to the requested destination, and the consumed code is rejected inline; that account and its invitation were removed. Server3353 tests and web119 tests pass;137 database/infrastructure tests remain skipped by their normal opt-in gates. No deploy path was changed.

Independent read-only design and accessibility reviews found the issues that drove these changes. Final closure verified the save-bar spacing/focus and filter focus restoration independently. Scanner hints are triaged separately: focus is supplied by global CSS/component styles, the save bar is a non-modal status surface, database and infrastructure confirmations are preserved, and token unit choices follow the brief. Source counts and screenshots are evidence of coverage, not a claim of perfect design.


Final production builds for web and marketing pass. Workspace type checks,
strict Biome (1,179 files) and knip pass; generated next-env files are restored.
The latest settings closure covers12 SSO/branding cases in both themes at1440,
390 and320px/200% text, including dialog focus return and branding discard.
Eight marketing production captures cover the updated catalog and article
navigation; all12 current screenshot URLs return real image data. Four existing
primary-session dashboard/profile captures pass with zero hydration errors.

localhost3000 serves the final branch with the original primary environment,
auth/encryption keys, database and configuration path. The final graceful restart
preserves all72 table hashes/240 rows,62 persistent configuration files and primary
environment/generated-file hashes exactly. Health and readiness return200. A
PostgreSQL17 archive, configuration copy and previous build are private rollback
material. Test writes are restricted to a guarded disposable database; no primary
seed, reset, migration or infrastructure operation was used. The draft PR remains
unmerged. Private receipt names under `fieldwork-refinement`: `preservation-final.json`,
`settings-final-report.json`, `landing-final-report.json`, `browser-final.json`,
`build-web-final.log`, `build-landing-final.log`, `biome-final.log`.
