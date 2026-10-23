"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { SettingsSection } from "@/components/layout/settings-section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient, useSession } from "@/lib/auth-client";
import { toastError } from "@/lib/describe-error";

interface SessionRow {
	id: string;
	token: string;
	userAgent?: string | null;
	ipAddress?: string | null;
	createdAt: string | Date;
	expiresAt: string | Date;
}

/**
 * Query key for the better-auth session list. Other cards (change password
 * with `revokeOtherSessions`) invalidate it so this list stays truthful.
 */
export const SESSIONS_QUERY_KEY = ["auth", "sessions"] as const;

/** "Chrome on macOS" from a user agent string, best effort. */
function describeUserAgent(userAgent: string | null | undefined): string {
	if (!userAgent) {
		return "Unknown device";
	}
	const os = userAgent.match(/Windows/)
		? "Windows"
		: userAgent.match(/Android/)
			? "Android"
			: userAgent.match(/iPhone|iPad/)
				? "iOS"
				: userAgent.match(/Mac OS X|Macintosh/)
					? "macOS"
					: userAgent.match(/Linux/)
						? "Linux"
						: null;
	const browser = userAgent.match(/Edg\//)
		? "Edge"
		: userAgent.match(/Firefox\//)
			? "Firefox"
			: userAgent.match(/Chrome\//)
				? "Chrome"
				: userAgent.match(/Safari\//)
					? "Safari"
					: null;
	return [browser, os].filter(Boolean).join(" on ") || userAgent.slice(0, 40);
}

function isMobile(userAgent: string | null | undefined): boolean {
	return Boolean(userAgent && /Mobile|Android|iPhone|iPad/.test(userAgent));
}

export function SessionsCard() {
	const { data: currentSession } = useSession();
	const queryClient = useQueryClient();
	const [revoking, setRevoking] = useState<string | null>(null);

	const sessionsQuery = useQuery({
		queryKey: SESSIONS_QUERY_KEY,
		queryFn: async () => {
			// better-auth resolves with `{ data, error }` — surface the error so
			// the card shows a retry instead of an empty list.
			const { data, error } = await authClient.listSessions();
			if (error) throw new Error(error.message ?? "Failed to load sessions");
			return (data ?? []) as SessionRow[];
		},
	});

	async function revoke(session: SessionRow) {
		setRevoking(session.id);
		const { error } = await authClient.revokeSession({ token: session.token });
		setRevoking(null);
		if (error) {
			toastError(error, "Failed to revoke session");
			return;
		}
		toast.success("Session revoked");
		await queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
	}

	const currentToken = currentSession?.session?.token;
	// Pin the current session to the top of the list.
	const sortedSessions = [...(sessionsQuery.data ?? [])].sort((a, b) =>
		a.token === currentToken ? -1 : b.token === currentToken ? 1 : 0,
	);

	return (
		<SettingsSection
			title="Active sessions"
			description="Devices currently signed in to your account."
		>
			{sessionsQuery.isPending ? (
				<div className="flex flex-col gap-2">
					<Skeleton className="h-10 w-full" />
					<Skeleton className="h-10 w-full" />
				</div>
			) : sessionsQuery.isError ? (
				<div className="flex flex-col items-center gap-2 rounded-md border border-dashed py-8 text-center">
					<p className="text-sm font-medium">Could not load sessions</p>
					<p className="text-sm text-muted-foreground">{sessionsQuery.error.message}</p>
					<Button variant="outline" size="sm" onClick={() => void sessionsQuery.refetch()}>
						Retry
					</Button>
				</div>
			) : sortedSessions.length === 0 ? (
				<p className="text-sm text-muted-foreground">No active sessions.</p>
			) : (
				<div className="divide-y rounded-lg border">
					{sortedSessions.map((session) => {
						const isCurrent = session.token === currentToken;
						const DeviceIcon = isMobile(session.userAgent) ? Smartphone : Monitor;
						return (
							<div key={session.id} className="flex items-center gap-3 px-4 py-3">
								<DeviceIcon className="size-4 shrink-0 text-muted-foreground" />
								<div className="flex min-w-0 flex-1 flex-col">
									<span className="flex items-center gap-2 text-sm font-medium">
										{describeUserAgent(session.userAgent)}
										{isCurrent && <Badge variant="secondary">Current</Badge>}
									</span>
									<span className="text-xs text-muted-foreground">
										{format(new Date(session.createdAt), "MMM d, yyyy HH:mm")}
										{session.ipAddress ? ` · ${session.ipAddress}` : ""}
									</span>
								</div>
								{!isCurrent && (
									<Button
										variant="ghost"
										size="sm"
										disabled={revoking === session.id}
										onClick={() => revoke(session)}
									>
										{revoking === session.id && <Loader2 className="size-4 animate-spin" />}
										Revoke
									</Button>
								)}
							</div>
						);
					})}
				</div>
			)}
		</SettingsSection>
	);
}
