import { PowerOff, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Props the runtime surfaces (logs, monitoring, terminal) accept so the page
 * can decide what the empty state offers: the service status drops the Retry
 * button for a never-deployed service (`idle`), and the page supplies the
 * Deploy / Start CTA because it owns those mutations.
 */
export interface RuntimeEmptyProps {
	serviceStatus?: string | null;
	notRunningAction?: ReactNode;
}

/**
 * Single empty state for every runtime surface when the service has no
 * running container — one panel, one message, one call to action.
 */
export function NotRunningState({
	title = "Service is not running",
	description = "Logs, metrics and the terminal are available once a container is up. Deploy or start the service first.",
	action,
	onRetry,
	className,
}: {
	title?: string;
	description?: string;
	/** Deploy / Start button supplied by the page that owns the mutation. */
	action?: ReactNode;
	/** Re-open the stream; omit for a service that was never deployed. */
	onRetry?: () => void;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-6 py-10 text-center",
				className,
			)}
		>
			<PowerOff className="mb-1 size-6 text-muted-foreground" aria-hidden />
			<p className="text-sm font-medium text-foreground">{title}</p>
			<p className="max-w-sm text-sm text-muted-foreground">{description}</p>
			{action || onRetry ? (
				<div className="mt-2 flex flex-wrap items-center justify-center gap-2">
					{action}
					{onRetry ? (
						<Button variant="outline" size="sm" onClick={onRetry}>
							<RefreshCw className="size-3.5" />
							Retry
						</Button>
					) : null}
				</div>
			) : null}
		</div>
	);
}
