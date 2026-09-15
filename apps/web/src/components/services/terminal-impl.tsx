"use client";

import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { Loader2, RotateCcw } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { NotRunningState, type RuntimeEmptyProps } from "@/components/services/not-running-state";
import { Button } from "@/components/ui/button";
import { nixployTerminalTheme } from "@/lib/codemirror-theme";
import { cn } from "@/lib/utils";

/** Websocket endpoints this component can drive; both speak the same frames. */
export type TerminalEndpoint = "terminal" | "server-terminal";

function wsUrl(endpoint: TerminalEndpoint, params: Record<string, string | null | undefined>) {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) search.set(key, value);
	}
	return `${protocol}//${window.location.host}/ws/${endpoint}?${search.toString()}`;
}

type TerminalStatus = "connecting" | "connected" | "disconnected";

/**
 * Interactive shell into a Nixploy service (`appName`), a raw Docker
 * container (`containerId`, Docker control center) or — with
 * `endpoint="server-terminal"` — the SSH host shell of a managed server
 * (`serverId` alone).
 *
 * All three endpoints exchange the same frames (`{type:"stdin"|"resize"}` out,
 * raw bytes in), so the xterm plumbing below is shared; only the URL and the
 * "what do we need to connect" check differ.
 */
export function ServiceTerminal({
	appName,
	containerId,
	serverId,
	endpoint = "terminal",
	connectingLabel = "Connecting to container…",
	serviceStatus,
	notRunningAction,
}: {
	appName?: string;
	containerId?: string;
	serverId?: string | null;
	endpoint?: TerminalEndpoint;
	/** Overlay text while the socket opens. */
	connectingLabel?: string;
} & RuntimeEmptyProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const terminalRef = useRef<Terminal | null>(null);
	const [status, setStatus] = useState<TerminalStatus>("connecting");
	const [lastError, setLastError] = useState<string | null>(null);
	/**
	 * The last slice of what the container actually printed. A docker exec that
	 * fails because the image ships no shell reports it on stderr and then the
	 * socket closes — there is no error frame — so without this the overlay fell
	 * back to "deploy the service first" for a service that is plainly running.
	 */
	const tailRef = useRef("");
	const [noShell, setNoShell] = useState(false);
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
		if (endpoint === "server-terminal" ? !serverId : !appName && !containerId) {
			setStatus("disconnected");
			setLastError(
				endpoint === "server-terminal"
					? "No server specified"
					: "No service or container specified",
			);
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
				wsUrl(endpoint, {
					appName,
					containerId,
					serverId,
				}),
			);
			ws.binaryType = "arraybuffer";

			/** Keep only the last couple of KB — enough to read the closing error. */
			const noteOutput = (chunk: string) => {
				tailRef.current = (tailRef.current + chunk).slice(-2048);
			};

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
								// The overlay prints it once the socket closes — no red xterm
								// line as well.
								setLastError(frame.message ?? "Unknown error");
								return;
							}
						} catch {
							// Plain terminal output.
						}
					}
					noteOutput(event.data);
					terminal?.write(event.data);
				} else {
					const bytes = new Uint8Array(event.data);
					noteOutput(new TextDecoder().decode(bytes));
					terminal?.write(bytes);
				}
			};
			ws.onclose = () => {
				if (disposed) return;
				setStatus("disconnected");
				// `exec: "sh": executable file not found in $PATH` — a scratch or
				// distroless image. Worth naming, because the generic advice
				// ("deploy it first") sends you to fix something that is not broken.
				setNoShell(/executable file not found|no such file or directory/i.test(tailRef.current));
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
	}, [appName, containerId, serverId, endpoint, session]);

	const startNewSession = () => {
		setStatus("connecting");
		setLastError(null);
		setNoShell(false);
		tailRef.current = "";
		setSession((current) => current + 1);
	};
	// The server closes with "No running container found …" when nothing is
	// deployed; a never-deployed service (`idle`) cannot be retried either way.
	const notRunning =
		status === "disconnected" &&
		(serviceStatus === "idle" || /no running container/i.test(lastError ?? ""));

	if (notRunning) {
		return (
			<NotRunningState
				action={notRunningAction}
				onRetry={serviceStatus === "idle" ? undefined : startNewSession}
				className="min-h-[26rem]"
			/>
		);
	}

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
							<Loader2 className="size-4 animate-spin" /> {connectingLabel}
						</span>
					) : (
						<>
							<span className="font-medium text-foreground">Connection closed</span>
							{lastError ? (
								<p className="max-w-md text-xs text-destructive">{lastError}</p>
							) : noShell ? (
								<p className="max-w-md text-xs">
									This image has no shell, so there is nothing to attach to. A terminal needs
									<code className="mx-1 font-mono">/bin/sh</code>
									in the image — scratch and distroless images ship without one.
								</p>
							) : serviceStatus === "idle" ? (
								<p className="max-w-md text-xs">
									Deploy the service first, then start a new session.
								</p>
							) : (
								<p className="max-w-md text-xs">The session ended. Start a new one to reconnect.</p>
							)}
							<Button size="sm" variant="secondary" onClick={startNewSession}>
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
