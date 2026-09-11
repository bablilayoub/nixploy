import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Documentation pages published at nixploy.com/docs.
 *
 * Every entry must exist in the landing registry
 * (`apps/landing/src/lib/docs/pages.ts`), or the "Learn more" link 404s.
 * `help-link.test.ts` next to this file asserts that, so the two packages
 * cannot drift apart silently.
 */
export const DOC_SLUGS = [
	"install",
	"getting-started",
	"migrate",
	"deploy",
	"domains",
	"tcp-udp-routing",
	"git",
	"templates",
	"databases",
	"backups",
	"observability",
	"servers",
	"security",
	"private-egress",
	"key-rotation",
	"schedules",
	"troubleshooting",
	"cli",
	"gitops",
	"mcp",
	"ai",
] as const;

export type DocSlug = (typeof DOC_SLUGS)[number];

export const DOCS_BASE_URL = "https://nixploy.com/docs";

export function docsUrl(slug?: DocSlug): string {
	return slug ? `${DOCS_BASE_URL}/${slug}` : DOCS_BASE_URL;
}

/**
 * "Learn more" link to the public docs, for options whose consequences are
 * not obvious from their one-line description (UX audit F16). Keep it inline
 * with the description text so it reads as part of the explanation.
 */
export function HelpLink({
	slug,
	label = "Learn more",
	className,
}: {
	slug: DocSlug;
	label?: string;
	className?: string;
}) {
	return (
		<a
			href={docsUrl(slug)}
			target="_blank"
			rel="noreferrer noopener"
			className={cn(
				"inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline",
				className,
			)}
		>
			{label}
			<ExternalLink aria-hidden className="size-3" />
			<span className="sr-only">(opens nixploy.com/docs in a new tab)</span>
		</a>
	);
}
