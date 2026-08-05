"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { LogViewer } from "@/components/services/log-viewer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function LogsTab({ compose }: { compose: ComposeService }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-sm font-medium">Logs</CardTitle>
				<CardDescription>Real-time container logs for this compose service.</CardDescription>
			</CardHeader>
			<CardContent>
				<LogViewer appName={compose.appName} serverId={compose.serverId} />
			</CardContent>
		</Card>
	);
}
