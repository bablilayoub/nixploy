"use client";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { Loader2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
	const [status, setStatus] = useState<TerminalStatus>("connecting");
	// A closed shell cannot be resumed, so reconnecting is an explicit action
	// that starts a fresh session rather than a silent background retry.
	const [session, setSession] = useState(0);

	// biome-ignore lint/correctness/useExhaustiveDependencies: `session` only exists to re-run this effect and open a new shell.
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
				theme: {
					background: "#0a0a0a",
					foreground: "#ededed",
					cursor: "#ededed",
					cursorAccent: "#0a0a0a",
					selectionBackground: "#333333",
					black: "#0a0a0a",
					red: "#ee0000",
					green: "#17c964",
					yellow: "#f5a524",
					blue: "#3291ff",
					magenta: "#c084fc",
					cyan: "#22d3ee",
					white: "#ededed",
					brightBlack: "#666666",
					brightRed: "#ff5555",
					brightGreen: "#4ade80",
					brightYellow: "#fde047",
					brightBlue: "#93c5fd",
					brightMagenta: "#d8b4fe",
					brightCyan: "#67e8f9",
					brightWhite: "#fafafa",
				},
			});
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
		};
	}, [appName, serverId, session]);

	return (
		<div className="relative overflow-hidden rounded-lg border border-border bg-[#0a0a0a]">
			{status !== "connected" && (
				<div
					className={cn(
						"absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[#0a0a0a]/80",
						"text-sm text-[#ededed]/60",
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
