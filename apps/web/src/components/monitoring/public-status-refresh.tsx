"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";

export function PublicStatusRefresh({ generatedAt }: { generatedAt: string }) {
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	const [online, setOnline] = useState(true);
	const lastRequest = useRef(0);
	const refresh = useCallback(() => {
		if (
			!navigator.onLine ||
			document.visibilityState !== "visible" ||
			Date.now() - lastRequest.current < 10_000
		)
			return;
		lastRequest.current = Date.now();
		startTransition(() => router.refresh());
	}, [router]);
	useEffect(() => {
		const connectivity = () => {
			setOnline(navigator.onLine);
			if (navigator.onLine) refresh();
		};
		setOnline(navigator.onLine);
		const timer = window.setInterval(refresh, 60_000);
		window.addEventListener("online", connectivity);
		window.addEventListener("offline", connectivity);
		document.addEventListener("visibilitychange", refresh);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("online", connectivity);
			window.removeEventListener("offline", connectivity);
			document.removeEventListener("visibilitychange", refresh);
		};
	}, [refresh]);
	return (
		<div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
			<p className="text-xs leading-relaxed text-muted-foreground" role="status">
				{online ? (
					<>
						Updated{" "}
						<time dateTime={generatedAt}>{generatedAt.slice(0, 16).replace("T", " ")} UTC</time> ·
						refreshes every minute
					</>
				) : (
					"You’re offline. Showing the last loaded status."
				)}
			</p>
			<Button variant="outline" size="sm" onClick={refresh} disabled={pending || !online}>
				<RefreshCw aria-hidden="true" className={pending ? "size-4 animate-spin" : "size-4"} />
				{pending ? "Refreshing…" : "Refresh status"}
			</Button>
		</div>
	);
}
