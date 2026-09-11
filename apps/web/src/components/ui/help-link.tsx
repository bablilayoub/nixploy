import { ExternalLink } from "lucide-react";

import { cn } from "@/lib/utils";

/** Documentation pages published at nixploy.com/docs (`apps/landing/src/lib/docs/pages.ts`). */
export type DocSlug =
	| "install"
	| "getting-started"
	| "migrate"
	| "deploy"
	| "domains"
	| "git"
	| "templates"
	| "databases"
	| "backups"
	| "observability"
	| "servers"
	| "security"
	| "schedules"
	| "cli"
	| "gitops"
	| "mcp"
	| "ai";

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
