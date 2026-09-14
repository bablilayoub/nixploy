"use client";

import { ExternalLink } from "lucide-react";

import { CopyButton } from "@/components/services/copy-button";
import { type DomainLike, domainLabel, domainUrl, primaryDomain } from "@/lib/service-url";
import { cn } from "@/lib/utils";

/**
 * The service's public address, as a link that opens the site plus a copy
 * button. Rendered under the service title and in the project services table
 * so "where is my app running" never needs the Domains tab.
 */
export function ServiceUrl({
	domain,
	className,
	compact = false,
}: {
	domain: DomainLike;
	className?: string;
	compact?: boolean;
}) {
	const url = domainUrl(domain);
	if (!url) return null;
	return (
		<span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
			<a
				href={url}
				target="_blank"
				rel="noreferrer noopener"
				className={cn(
					"inline-flex min-w-0 items-center gap-1 truncate underline-offset-2 hover:underline",
					compact ? "text-xs" : "text-sm",
				)}
				title={url}
			>
				<span className="truncate">{domainLabel(domain)}</span>
				<ExternalLink className={cn("shrink-0", compact ? "size-3" : "size-3.5")} />
			</a>
			<CopyButton
				value={url}
				label="Copy URL"
				className={compact ? "size-6 [&_svg]:size-3" : undefined}
			/>
		</span>
	);
}

/**
 * Header variant: the primary address plus a count of the others, which links
 * back to the Domains tab.
 */
export function ServiceUrlBar({
	domains,
	onShowAll,
	className,
}: {
	domains: readonly DomainLike[];
	onShowAll?: () => void;
	className?: string;
}) {
	const primary = primaryDomain(domains);
	if (!primary) return null;
	const others = domains.filter((domain) => !domain.previewDeploymentId).length - 1;
	return (
		<span className={cn("flex min-w-0 items-center gap-2", className)}>
			<ServiceUrl domain={primary} />
			{others > 0 ? (
				<button
					type="button"
					className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
					onClick={onShowAll}
				>
					+{others} more
				</button>
			) : null}
		</span>
	);
}
