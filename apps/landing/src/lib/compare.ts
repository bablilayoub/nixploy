/**
 * Comparison pages.
 *
 * **Every claim about another project carries a source URL and was read from
 * that source, not from memory.** Two of them contradicted what a summary or a
 * search result said, which is exactly why the rule exists: their MCP server
 * is not read-only, and one of the three does not paywall anything at all.
 *
 * Rules for editing this file:
 *
 * 1. If you cannot link it, do not claim it. Opinions about reliability,
 *    memory use or security history are not facts and do not belong here.
 * 2. Say where they are better. A comparison that finds the author wins every
 *    row is an advertisement, and readers price it as one.
 * 3. Re-read the sources before changing `VERIFIED_ON`. These projects ship
 *    weekly; a stale table is a wrong table.
 */

/** The date every fact below was last read from its source. */
export const VERIFIED_ON = "18 September 2026";

export interface Fact {
	label: string;
	/** What the other project does. Must be supported by `source`. */
	theirs: string;
	/** What Nixploy does. Checkable in this repository. */
	ours: string;
	/** Where `theirs` was read from. */
	source: string;
}

export interface Comparison {
	slug: string;
	/** Product name, spelled the way they spell it. */
	name: string;
	stars: string;
	license: string;
	licenseSource: string;
	/** Neutral one-paragraph description of what they are. */
	what: string;
	/** The single most important difference, in one sentence. */
	headline: string;
	facts: Fact[];
	/** Honest reasons to choose them instead. Not filler. */
	chooseThem: string[];
	/** Reasons to choose Nixploy. */
	chooseUs: string[];
}

const DOKPLOY: Comparison = {
	slug: "dokploy",
	name: "Dokploy",
	stars: "37.4k",
	license: "Apache-2.0, except a /proprietary directory under a source-available licence",
	licenseSource: "https://github.com/Dokploy/dokploy/blob/canary/LICENSE.MD",
	what: "A self-hosted PaaS built on Docker Swarm and Traefik, with Git deploys, Compose stacks, databases and backups. It moved to an open-core model: most of the repository is Apache-2.0, and a /proprietary directory is licensed separately, with production use requiring a commercial agreement.",
	headline:
		"The governance features Dokploy sells as Enterprise — SSO/SAML, fine-grained roles, audit logs and white-labelling — are in Nixploy's free, Apache-2.0 build.",
	facts: [
		{
			label: "Single sign-on",
			theirs: "“SSO / SAML (Azure, OKTA, etc)” is listed under the Enterprise tier.",
			ours: "OIDC single sign-on in the box, with presets, group→role mapping and per-organization enforcement. Free.",
			source: "https://dokploy.com/pricing",
		},
		{
			label: "Roles and permissions",
			theirs:
				"Hobby is “1 User” with basic role permissions unavailable; “Basic RBAC (Admin, Developer)” starts at the Startup tier; “Fine-grained RBAC” is Enterprise.",
			ours: "A 27-entry capability catalogue with per-member overrides on top of a five-step role ladder, plus teams that scope a member to specific projects. Free.",
			source: "https://dokploy.com/pricing",
		},
		{
			label: "Audit log",
			theirs: "“Audit Logs” is listed under the Enterprise tier.",
			ours: "Every mutation writes a row with actor, IP and user agent; filterable, exportable as CSV, optionally forwarded to alerts. Free.",
			source: "https://dokploy.com/pricing",
		},
		{
			label: "White-labelling",
			theirs: "“White Labeling” is listed under the Enterprise tier.",
			ours: "Product name, logos, favicon, accent and sanitised custom CSS, applied to the login page too. Free.",
			source: "https://dokploy.com/pricing",
		},
		{
			label: "SCIM user provisioning",
			theirs: "“SCIM User Provisioning” is listed under the Enterprise tier.",
			ours: "Not built. Group→role mapping on SSO login covers most of the demand; SCIM is a deliberate deferral.",
			source: "https://dokploy.com/pricing",
		},
		{
			label: "Licence",
			theirs:
				"Apache-2.0 outside /proprietary; that directory is under the Dokploy Source Available Licence, which permits production use only with a commercial agreement.",
			ours: "Apache-2.0, whole repository, no proprietary directory, no commercial agreement.",
			source: "https://github.com/Dokploy/dokploy/blob/canary/LICENSE.MD",
		},
	],
	chooseThem: [
		"It is a far bigger project — 37.4k stars against our 3 — with the community, the third-party tutorials and the battle-testing that follows from that.",
		"It has a much larger template catalogue and a longer track record on real production installs.",
		"If you want somebody to call, they sell support tiers and we do not.",
	],
	chooseUs: [
		"Nothing is held back for a paid tier. There is no paid tier.",
		"The MCP endpoint is a first-class surface, not a wrapper: 35 annotated tools dispatching through the same routers as the UI, so organization scope, capability checks and the audit trail apply to an agent identically.",
		"Teams scope a member to projects, and a project they cannot reach answers “not found”, never “forbidden”.",
		"Any domain can be put behind the panel's own login in one switch, with your 2FA and SSO policy.",
	],
};

const COOLIFY: Comparison = {
	slug: "coolify",
	name: "Coolify",
	stars: "62.0k",
	license: "Apache-2.0",
	licenseSource: "https://github.com/coollabsio/coolify",
	what: "The largest open-source self-hosted PaaS by some distance. Deploys applications, databases and Compose stacks to servers you own, with automatic TLS and a big integration surface. Self-hosting is free with no feature restrictions; the paid product is their managed cloud, which runs the control plane for you.",
	headline:
		"This one is not about price — Coolify's self-hosted build is free and complete. The differences are architectural.",
	facts: [
		{
			label: "What is paid",
			theirs:
				"Nothing, if you self-host: the pricing page states full access to all features with no limitation or restrictions. The paid tier is their managed cloud.",
			ours: "Also nothing. There is no managed cloud to sell you either.",
			source: "https://coolify.io/pricing",
		},
		{
			label: "Licence",
			theirs: "Apache-2.0.",
			ours: "Apache-2.0.",
			source: "https://github.com/coollabsio/coolify",
		},
		{
			label: "Agent surface",
			theirs:
				"Ships an MCP server whose tools can inspect and operate resources, with read-only MCP resources alongside them.",
			ours: "42 MCP tools, each carrying hand-declared readOnlyHint / destructiveHint / idempotentHint with a test that fails the build on a missing entry, plus task tools that return a deploy's real outcome in one call instead of a polling loop.",
			source: "https://coolify.io/docs/integrations/mcp",
		},
		{
			label: "Size and maturity",
			theirs: "62.0k stars, years of production use, a large contributor base.",
			ours: "3 stars. New. You are early.",
			source: "https://github.com/coollabsio/coolify",
		},
	],
	chooseThem: [
		"It is vastly more mature and more widely deployed. If the most important property to you is “many people have already hit the bugs”, that is a real and correct reason.",
		"Far more integrations, providers and community content, and an active Discord with people who have solved your problem already.",
		"They offer a managed cloud, so you can stop running the control plane yourself without giving up the product.",
	],
	chooseUs: [
		"Swarm-native throughout: remote servers join one cluster over SSH and deploys, logs, metrics and backups behave identically on all of them.",
		"A closed set of Traefik middlewares with a hand-written schema and renderer each — there is no raw-YAML escape hatch, so nothing a tenant types reaches the proxy config unvalidated.",
		"Tenancy is enforced in one place and tested: every list procedure must declare how it filters by organization and by project, or CI fails.",
		"Agent-first by design — annotated MCP tools, llms.txt, agents.md and a Markdown twin of every docs page.",
	],
};

const CAPROVER: Comparison = {
	slug: "caprover",
	name: "CapRover",
	stars: "15.2k",
	license: "Apache-2.0",
	licenseSource: "https://github.com/caprover/caprover",
	what: "One of the oldest projects in this category, and the most deliberately simple. Docker Swarm underneath with nginx as the reverse proxy and Let's Encrypt for certificates, one-click apps, CLI and webhook deploys. Free forever, with no paid tier at all.",
	headline:
		"Both are Swarm-native and both are free. CapRover is the smaller, simpler tool; Nixploy carries the operations surface — backups, monitoring, teams, audit — that CapRover leaves to you.",
	facts: [
		{
			label: "Orchestration",
			theirs: "Docker Swarm, with nginx as the reverse proxy and Let's Encrypt for TLS.",
			ours: "Docker Swarm, with Traefik v3 as the reverse proxy and Let's Encrypt for TLS.",
			source: "https://caprover.com/",
		},
		{
			label: "Price",
			theirs: "Free forever, Apache-2.0, no paid tier.",
			ours: "The same.",
			source: "https://caprover.com/",
		},
		{
			label: "Deploys",
			theirs:
				"CLI, dashboard, webhooks and Git workflow integration; one-click apps for common services.",
			ours: "The same sources plus Compose stacks as first-class services, PR previews with a fork gate, rollbacks that restore config and environment, and deploy-any-ref.",
			source: "https://caprover.com/",
		},
		{
			label: "Size",
			theirs: "15.2k stars, active since 2017.",
			ours: "3 stars. New.",
			source: "https://github.com/caprover/caprover",
		},
	],
	chooseThem: [
		"It is simpler, and simple is a feature. If you want one box, a handful of apps and nothing to learn, CapRover asks less of you than we do.",
		"Eight years of production use and a large body of community answers.",
		"Lower resource use, because it does less.",
	],
	chooseUs: [
		"Encrypted database and volume backups on a schedule, to S3 or disk, with verified restores — and a self-backup of the panel itself.",
		"Live logs, a web terminal, 48 hours of metrics, alert rules, uptime probes and a per-service event timeline that records OOM kills and restarts.",
		"Organizations, a role ladder, capability overlays, teams, SSO and an audit trail with CSV export.",
		"A REST API, a CLI, GitOps from a nixploy.yaml and an MCP endpoint for AI agents.",
	],
};

export const comparisons: Comparison[] = [DOKPLOY, COOLIFY, CAPROVER];

export const comparisonSlugs = comparisons.map((entry) => entry.slug);

export const findComparison = (slug: string): Comparison | undefined =>
	comparisons.find((entry) => entry.slug === slug);
