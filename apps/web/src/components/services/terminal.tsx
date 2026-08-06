"use client";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { Loader2, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { nixployTerminalTheme } from "@/lib/codemirror-theme";
import { cn } from "@/lib/utils";

function wsUrl(params: Record<string, string | null | undefined>) {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) search.set(key, value);
	}
	return `${protocol}//${window.location.host}/ws/terminal?${search.toString()}`;
}

type TerminalStatus = "connecting" | "connected" | "disconnected";

export function ServiceTerminal({
	appName,
	serverId,
}: {
	appName: string;
	serverId?: string | null;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const [status, setStatus] = useState<TerminalStatus>("connecting");
	// A closed shell cannot be resumed, so reconnecting is an explicit action
	// that starts a fresh session rather than a silent background retry.
	const [session, setSession] = useState(0);
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme !== "light";

	// Keep chrome in sync with light/dark without tearing down the shell.
	useEffect(() => {
		const term = terminalRef.current;
		if (!term) return;
		term.options.theme = nixployTerminalTheme[isDark ? "dark" : "light"];
	}, [isDark]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `session` re-runs this effect to open a fresh shell.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let disposed = false;
		let terminal: Terminal | null = null;
		let fitAddon: FitAddon | null = null;
		let ws: WebSocket | null = null;
		let resizeObserver: ResizeObserver | null = null;

		const setup = async () => {
			// Dynamic imports keep xterm (and its DOM access) client-only.
			const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
				import("@xterm/xterm/css/xterm.css"),
			]);
			if (disposed) return;

			terminal = new XTerm({
				cursorBlink: true,
				fontSize: 13,
				fontFamily: "var(--font-jetbrains-mono), ui-monospace, SFMono-Regular, Menlo, monospace",
				convertEol: true,
				theme: nixployTerminalTheme[isDark ? "dark" : "light"],
			});
			terminalRef.current = terminal;
			fitAddon = new Fit();
			terminal.loadAddon(fitAddon);
			terminal.open(container);
			fitAddon.fit();

			const sendResize = () => {
				if (ws?.readyState === WebSocket.OPEN && terminal) {
					ws.send(
						JSON.stringify({
							type: "resize",
							cols: terminal.cols,
							rows: terminal.rows,
						}),
					);
				}
			};

			resizeObserver = new ResizeObserver(() => {
				try {
					fitAddon?.fit();
					sendResize();
				} catch {
					// Container hidden (display:none) — xterm throws on zero size.
				}
			});
			resizeObserver.observe(container);

			terminal.onData((data) => {
				if (ws?.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({ type: "stdin", data }));
				}
			});

			ws = new WebSocket(wsUrl({ appName, serverId }));
			ws.binaryType = "arraybuffer";

			ws.onopen = () => {
				setStatus("connected");
				terminal?.focus();
				sendResize();
			};
			ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
				if (typeof event.data === "string") {
					// Server-side failures may arrive as JSON error frames.
					if (event.data.startsWith("{")) {
						try {
							const frame = JSON.parse(event.data) as { type?: string; message?: string };
							if (frame.type === "error") {
								terminal?.writeln(`\r\n\x1b[31m${frame.message ?? "Unknown error"}\x1b[0m`);
								return;
							}
						} catch {
							// Plain terminal output.
						}
					}
					terminal?.write(event.data);
				} else {
					terminal?.write(new Uint8Array(event.data));
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				setStatus("disconnected");
				terminal?.writeln("\r\n\x1b[90m--- Connection closed ---\x1b[0m");
			};
			ws.onerror = () => {
				ws?.close();
			};
		};

		void setup();

		return () => {
			disposed = true;
			resizeObserver?.disconnect();
			ws?.close();
			terminal?.dispose();
			if (terminalRef.current === terminal) terminalRef.current = null;
		};
	}, [appName, serverId, session]);

	return (
		<div className="relative overflow-hidden rounded-lg border border-border bg-card">
			{status !== "connected" && (
				<div
					className={cn(
						"absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/80",
						"text-sm text-muted-foreground",
					)}
				>
					{status === "connecting" ? (
						<span className="flex items-center gap-2">
							<Loader2 className="size-4 animate-spin" /> Connecting to container…
						</span>
					) : (
						<>
							<span>Connection closed</span>
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									setStatus("connecting");
									setSession((current) => current + 1);
								}}
							>
								<RotateCcw className="size-4" />
								Start new session
							</Button>
						</>
					)}
				</div>
			)}
			<div ref={containerRef} className="h-[26rem] p-2" />
		</div>
	);
}
