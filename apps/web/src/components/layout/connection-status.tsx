"use client";

import { WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
	window.addEventListener("online", onChange);
	window.addEventListener("offline", onChange);
	return () => {
		window.removeEventListener("online", onChange);
		window.removeEventListener("offline", onChange);
	};
}

export function ConnectionStatus() {
	const online = useSyncExternalStore(
		subscribe,
		() => navigator.onLine,
		() => true,
	);
	if (online) return null;
	return (
		<div
			role="status"
			className="flex items-start gap-3 border-b bg-card px-5 py-3 text-sm sm:px-8"
		>
			<WifiOff className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
			<p>
				<span className="font-medium">You’re offline.</span>{" "}
				<span className="text-muted-foreground">
					Cached information may be out of date. Reconnect to refresh.
				</span>
			</p>
		</div>
	);
}
