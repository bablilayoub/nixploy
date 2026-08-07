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

/**
 * Interactive shell into a Nixploy service (`appName`) or a raw Docker
 * container (`containerId`, Docker control center).
 */
export function ServiceTerminal({
	appName,
	containerId,
	serverId,
}: {
	appName?: string;
	containerId?: string;
	serverId?: string | null;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const [status, setStatus] = useState<TerminalStatus>("connecting");
	const [lastError, setLastError] = useState<string | null>(null);
	// A closed shell cannot be resumed, so reconnecting is an explicit action
	// that starts a fresh session rather than a silent background retry.
	const [session, setSession] = useState(0);
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme !== "light";

	useEffect(() => {
		const term = terminalRef.current;
		if (!term) return;
		term.options.theme = nixployTerminalTheme[isDark ? "dark" : "light"];
	}, [isDark]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `session` re-runs this effect to open a fresh shell.
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		if (!appName && !containerId) {
			setStatus("disconnected");
			setLastError("No service or container specified");
			return;
		}

		let disposed = false;
		let terminal: Terminal | null = null;
		let fitAddon: FitAddon | null = null;
		let ws: WebSocket | null = null;
		let resizeObserver: ResizeObserver | null = null;

		const setup = async () => {
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

			setLastError(null);
			ws = new WebSocket(
				wsUrl({
					appName,
					containerId,
					serverId,
				}),
			);
			ws.binaryType = "arraybuffer";

			ws.onopen = () => {
				if (disposed) return;
				setStatus("connected");
				terminal?.focus();
				sendResize();
			};
			ws.onmessage = (event: MessageEvent<ArrayBuffer | string>) => {
				if (typeof event.data === "string") {
					if (event.data.startsWith("{")) {
						try {
							const frame = JSON.parse(event.data) as { type?: string; message?: string };
							if (frame.type === "error") {
								const message = frame.message ?? "Unknown error";
								setLastError(message);
								terminal?.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
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
				setLastError((current) => current ?? "WebSocket connection failed");
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
	}, [appName, containerId, serverId, session]);

	return (
		<div className="relative overflow-hidden rounded-lg border border-border bg-card">
			{status !== "connected" && (
				<div
					className={cn(
						"absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/80 px-6 text-center",
						"text-sm text-muted-foreground",
					)}
				>
					{status === "connecting" ? (
						<span className="flex items-center gap-2">
							<Loader2 className="size-4 animate-spin" /> Connecting to container…
						</span>
					) : (
						<>
							<span className="font-medium text-foreground">Connection closed</span>
							{lastError ? (
								<p className="max-w-md text-xs text-destructive">{lastError}</p>
							) : (
								<p className="max-w-md text-xs">
									Deploy the service first, then start a new session.
								</p>
							)}
							<Button
								size="sm"
								variant="secondary"
								onClick={() => {
									setStatus("connecting");
									setLastError(null);
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
