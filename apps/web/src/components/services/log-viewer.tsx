"use client";

import { ArrowDownToLine, Download, Loader2, RefreshCw, Trash2, WrapText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { NotRunningState, type RuntimeEmptyProps } from "@/components/services/not-running-state";
import { StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const MAX_LINES = 5000;
const MAX_BACKOFF_MS = 15_000;
/** Transient closes are retried this many times before asking the user. */
const MAX_RECONNECT_ATTEMPTS = 8;
/** How often the "nothing deployed" empty state quietly re-checks the stream. */
const EMPTY_RETRY_MS = 5000;
/**
 * Close codes the server uses for permanent failures: 1008 (policy — auth or
 * an application error sent via `closeWithError`) and 1011 (handler crash).
 * Reconnecting cannot fix these, so the viewer stops and offers a manual retry.
 */
const PERMANENT_CLOSE_CODES = new Set([1008, 1011]);

// Matches CSI sequences and other common ANSI escapes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escapes requires matching the ESC control character
const ANSI_REGEX = /\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

const stripAnsi = (text: string) => text.replace(ANSI_REGEX, "").replace(/\r/g, "");

// ─── Line classification (level badges + colors) ────────────────────────────

type LineLevel = "error" | "warn" | "success" | "info" | "debug" | "default";

/** Explicit `[tag]` prefixes emitted by our own deploy/log pipelines. */
const PREFIX_TAG_REGEX = /^\[(error|warn(?:ing)?|info|debug|success|ok)\]\s*/i;
/** Leading ISO-ish timestamp, dimmed when rendering (e.g. postgres/docker). */
const TIMESTAMP_REGEX = /^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:\s?UTC|Z)?)\s*/;

const classifyLine = (line: string): { level: LineLevel; text: string } => {
	const prefix = line.match(PREFIX_TAG_REGEX);
	if (prefix) {
		const tag = prefix[1].toLowerCase();
		const level: LineLevel =
			tag === "error"
				? "error"
				: tag.startsWith("warn")
					? "warn"
					: tag === "info"
						? "info"
						: tag === "debug"
							? "debug"
							: "success";
		return { level, text: line.slice(prefix[0].length) };
	}
	if (/^--- Deployment finished:/i.test(line)) {
		return /done|success/i.test(line)
			? { level: "success", text: line }
			: { level: "error", text: line };
	}
	if (/\b(ERROR|FATAL|PANIC)\b/.test(line) || /\bfailed to\b|\berror:/i.test(line))
		return { level: "error", text: line };
	if (/\b(WARN|WARNING|CANCELED)\b/.test(line)) return { level: "warn", text: line };
	if (/\bDONE\b/.test(line) || /\bSUCCESS(FUL)?\b/.test(line) || /\bsuccessfully\b/i.test(line))
		return { level: "success", text: line };
	if (/\bDEBUG\b/.test(line)) return { level: "debug", text: line };
	if (/\b(INFO|NOTICE)\b/.test(line) || /\bLOG:/.test(line)) return { level: "info", text: line };
	return { level: "default", text: line };
};

const LEVEL_STYLES: Record<
	Exclude<LineLevel, "default">,
	{ tag: string; badge: string; text: string }
> = {
	error: {
		tag: "ERR",
		badge: "bg-destructive/15 text-destructive",
		text: "text-destructive",
	},
	warn: {
		tag: "WRN",
		badge: "bg-warning/15 text-warning",
		text: "text-warning",
	},
	success: {
		tag: "OK",
		badge: "bg-success/15 text-success",
		text: "text-success",
	},
	info: {
		tag: "INF",
		badge: "bg-info/15 text-info",
		text: "text-info",
	},
	debug: {
		tag: "DBG",
		badge: "bg-muted text-muted-foreground",
		text: "text-muted-foreground",
	},
};

/** One log line: level badge in a fixed gutter, dimmed timestamp, colored text. */
function LogLine({ line, wrap }: { line: string; wrap: boolean }) {
	const { level, text } = classifyLine(line);
	const style = level === "default" ? null : LEVEL_STYLES[level];
	const timestamp = text.match(TIMESTAMP_REGEX);
	const body = timestamp ? text.slice(timestamp[0].length) : text;
	return (
		<div className="flex gap-2">
			<span className="w-8 shrink-0 select-none text-right leading-5">
				{style && (
					<span
						className={cn(
							"inline-block rounded px-1 py-px text-[11px] font-semibold leading-3",
							style.badge,
						)}
					>
						{style.tag}
					</span>
				)}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1",
					wrap ? "whitespace-pre-wrap break-all" : "whitespace-pre",
					style?.text ?? "text-foreground",
				)}
			>
				{timestamp && <span className="text-muted-foreground">{timestamp[1]} </span>}
				{body || " "}
			</span>
		</div>
	);
}

type ConnectionStatus = "connecting" | "connected" | "disconnected" | "finished" | "error";

function wsUrl(path: string, params: Record<string, string | null | undefined>) {
	const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value) search.set(key, value);
	}
	return `${protocol}//${window.location.host}${path}?${search.toString()}`;
}

export function LogViewer({
	appName,
	containerId,
	serverId,
	deploymentId,
	onFinish,
	serviceStatus,
	notRunningAction,
}: {
	appName?: string;
	containerId?: string;
	serverId?: string | null;
	deploymentId?: string;
	/** Called once when a deployment stream sends its terminal `finish` frame. */
	onFinish?: (status: string) => void;
} & RuntimeEmptyProps) {
	const [lines, setLines] = useState<string[]>([]);
	const [status, setStatus] = useState<ConnectionStatus>("connecting");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [emptyMessage, setEmptyMessage] = useState<string | null>(null);
	const [pinned, setPinned] = useState(true);
	const [wrap, setWrap] = useState(false);
	const [filter, setFilter] = useState("");
	const [hiddenLevels, setHiddenLevels] = useState<Set<LineLevel>>(new Set());

	const containerRef = useRef<HTMLDivElement>(null);
	const wsRef = useRef<WebSocket | null>(null);
	const bufferRef = useRef("");
	const attemptsRef = useRef(0);
	const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const finishedRef = useRef(false);
	const pinnedRef = useRef(true);
	pinnedRef.current = pinned;
	const onFinishRef = useRef(onFinish);
	onFinishRef.current = onFinish;

	const appendChunk = useCallback((raw: string) => {
		const text = stripAnsi(raw);
		if (!text) return;
		// Real log data dismisses the "nothing deployed" empty state.
		setEmptyMessage(null);
		const combined = bufferRef.current + text;
		const parts = combined.split("\n");
		bufferRef.current = parts.pop() ?? "";
		if (parts.length === 0) return;
		setLines((previous) => {
			const next = [...previous, ...parts];
			return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
		});
	}, []);

	const connect = useCallback(() => {
		if (!deploymentId && !appName && !containerId) return;

		// emptyMessage is intentionally NOT cleared here: background retries
		// from the empty state stay invisible until log data actually arrives.
		finishedRef.current = false;
		setStatus("connecting");
		setErrorMessage(null);

		const url = deploymentId
			? wsUrl("/ws/deployment", { deploymentId })
			: wsUrl("/ws/logs", {
					appName,
					containerId,
					serverId,
				});

		const ws = new WebSocket(url);
		wsRef.current = ws;

		ws.onopen = () => {
			attemptsRef.current = 0;
			setStatus("connected");
		};

		ws.onmessage = (event: MessageEvent<string>) => {
			const data = typeof event.data === "string" ? event.data : "";
			if (!data) return;

			if (deploymentId) {
				// /ws/deployment speaks JSON: { type: "log" | "finish" | "error", ... }
				try {
					const frame = JSON.parse(data) as {
						type: string;
						message?: string;
						status?: string;
					};
					if (frame.type === "log" && frame.message) {
						appendChunk(frame.message);
					} else if (frame.type === "finish") {
						appendChunk(`\n--- Deployment finished: ${frame.status ?? "done"} ---\n`);
						finishedRef.current = true;
						setStatus("finished");
						onFinishRef.current?.(frame.status ?? "done");
					} else if (frame.type === "error") {
						appendChunk(`\n[error] ${frame.message ?? "Unknown error"}\n`);
					}
					return;
				} catch {
					// Not JSON — fall through to raw rendering.
				}
				appendChunk(data);
				return;
			}

			// /ws/logs is raw text, but control frames arrive as JSON: "error"
			// for failures, "empty" when the app has no running container.
			if (data.startsWith("{")) {
				try {
					const frame = JSON.parse(data) as { type?: string; message?: string };
					if (frame.type === "error") {
						appendChunk(`\n[error] ${frame.message ?? "Unknown error"}\n`);
						return;
					}
					if (frame.type === "empty") {
						// Nothing deployed/running — show an empty state instead of
						// spamming error lines, but keep quietly re-checking so logs
						// appear on their own once the service starts.
						finishedRef.current = true;
						setEmptyMessage(frame.message ?? null);
						setStatus("finished");
						reconnectTimerRef.current = setTimeout(connect, EMPTY_RETRY_MS);
						return;
					}
				} catch {
					// Raw log line that happens to start with '{'.
				}
			}
			appendChunk(data);
		};

		ws.onclose = (event: CloseEvent) => {
			if (wsRef.current !== ws) return; // Stale socket (already replaced/unmounted).
			wsRef.current = null;
			if (finishedRef.current) {
				setStatus("finished");
				return;
			}
			// Permanent failures (auth/policy, handler crash) never recover by
			// reconnecting — surface them and wait for a manual retry instead of
			// looping forever and appending an error line each cycle.
			if (PERMANENT_CLOSE_CODES.has(event.code)) {
				setErrorMessage(event.reason || `Connection closed (code ${event.code})`);
				setStatus("error");
				return;
			}
			const attempt = attemptsRef.current++;
			if (attempt >= MAX_RECONNECT_ATTEMPTS) {
				setErrorMessage("Lost connection to the log stream");
				setStatus("error");
				return;
			}
			setStatus("disconnected");
			const delay = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
			reconnectTimerRef.current = setTimeout(connect, delay);
		};

		ws.onerror = () => {
			ws.close();
		};
	}, [appName, containerId, serverId, deploymentId, appendChunk]);

	useEffect(() => {
		setLines([]);
		bufferRef.current = "";
		attemptsRef.current = 0;
		setEmptyMessage(null);
		connect();

		return () => {
			if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
			finishedRef.current = true; // Prevent the closing socket from scheduling a reconnect.
			const ws = wsRef.current;
			wsRef.current = null;
			ws?.close();
		};
	}, [connect]);

	// Auto-scroll to the bottom while pinned.
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolling is triggered by new log lines, which the effect reads only through refs
	useEffect(() => {
		const container = containerRef.current;
		if (container && pinnedRef.current) {
			container.scrollTop = container.scrollHeight;
		}
	}, [lines]);

	// Scrolling up unpins; scrolling back to the bottom re-pins.
	const handleScroll = () => {
		const container = containerRef.current;
		if (!container) return;
		const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 24;
		setPinned(atBottom);
	};

	const scrollToBottom = () => {
		const container = containerRef.current;
		if (container) {
			container.scrollTop = container.scrollHeight;
			setPinned(true);
		}
	};

	const needle = filter.trim().toLowerCase();
	const visibleLines = lines.filter((line) => {
		if (needle && !line.toLowerCase().includes(needle)) return false;
		const { level } = classifyLine(line);
		return !hiddenLevels.has(level);
	});

	const toggleLevel = (level: LineLevel) => {
		setHiddenLevels((previous) => {
			const next = new Set(previous);
			if (next.has(level)) next.delete(level);
			else next.add(level);
			return next;
		});
	};

	const downloadLogs = () => {
		const name = appName ?? containerId ?? deploymentId ?? "service";
		const blob = new Blob([visibleLines.join("\n")], { type: "text/plain" });
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = `${name}-logs.txt`;
		document.body.appendChild(anchor);
		anchor.click();
		anchor.remove();
		// Revoke after the click has been dispatched; Firefox/Safari abort the
		// download when the blob URL disappears synchronously.
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	};

	const reconnectNow = () => {
		if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
		attemptsRef.current = 0;
		setEmptyMessage(null);
		setErrorMessage(null);
		const ws = wsRef.current;
		wsRef.current = null;
		ws?.close();
		connect();
	};

	if (!deploymentId && !appName && !containerId) {
		return (
			<div className="flex h-64 items-center justify-center rounded-lg border border-border bg-card text-sm text-muted-foreground">
				Select a service to view its logs.
			</div>
		);
	}

	if (emptyMessage) {
		// The stream re-checks itself every EMPTY_RETRY_MS; Retry only makes
		// sense once the service has been deployed at least once.
		return (
			<NotRunningState
				action={notRunningAction}
				onRetry={serviceStatus === "idle" ? undefined : reconnectNow}
			/>
		);
	}

	return (
		<div className="overflow-hidden rounded-lg border border-border bg-card">
			<div className="flex items-center justify-between gap-2 border-b border-border bg-black/[0.02] px-3 py-1.5 dark:bg-white/[0.02]">
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<StatusDot
						status={
							status === "connected"
								? "success"
								: status === "connecting"
									? "warning"
									: status === "disconnected" || status === "error"
										? "error"
										: "neutral"
						}
					/>
					{status === "connected" && "Live"}
					{status === "connecting" && (
						<span className="inline-flex items-center gap-1.5">
							<Loader2 className="size-3 animate-spin" /> Connecting…
						</span>
					)}
					{status === "disconnected" && "Disconnected — reconnecting…"}
					{status === "finished" && "Stream finished"}
					{status === "error" && (
						<span className="text-destructive" title={errorMessage ?? undefined}>
							{errorMessage ?? "Connection failed"}
						</span>
					)}
				</div>
				<div className="flex items-center gap-1">
					{(status === "disconnected" || status === "error") && (
						<Tooltip>
							<TooltipTrigger asChild>
								<Button
									variant="outline"
									size="icon-sm"
									aria-label={status === "error" ? "Retry" : "Reconnect now"}
									onClick={reconnectNow}
								>
									<RefreshCw className="size-3.5" />
								</Button>
							</TooltipTrigger>
							<TooltipContent>{status === "error" ? "Retry" : "Reconnect now"}</TooltipContent>
						</Tooltip>
					)}
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={wrap ? "secondary" : "outline"}
								size="icon-sm"
								aria-label="Toggle line wrap"
								onClick={() => setWrap((value) => !value)}
							>
								<WrapText className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Toggle line wrap</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={pinned ? "secondary" : "outline"}
								size="icon-sm"
								aria-label="Scroll to latest output"
								onClick={scrollToBottom}
							>
								<ArrowDownToLine className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Follow latest logs</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant="outline"
								size="icon-sm"
								aria-label="Clear logs"
								onClick={() => {
									setLines([]);
									bufferRef.current = "";
								}}
							>
								<Trash2 className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Clear</TooltipContent>
					</Tooltip>
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-2 border-b border-border bg-black/[0.02] px-3 py-1.5 dark:bg-white/[0.02]">
				<Input
					placeholder="Filter logs…"
					aria-label="Filter logs"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="h-7 w-44 font-mono text-xs"
				/>
				{(Object.keys(LEVEL_STYLES) as (keyof typeof LEVEL_STYLES)[]).map((level) => (
					<button
						key={level}
						type="button"
						onClick={() => toggleLevel(level)}
						className={cn(
							"rounded px-1.5 py-0.5 text-[10px] font-semibold transition-opacity",
							LEVEL_STYLES[level].badge,
							hiddenLevels.has(level) && "opacity-30 line-through",
						)}
					>
						{LEVEL_STYLES[level].tag}
					</button>
				))}
				<span className="ml-auto text-[11px] text-muted-foreground">
					{visibleLines.length === lines.length
						? `${lines.length} lines`
						: `${visibleLines.length} / ${lines.length} lines`}
				</span>
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="outline"
							size="icon-sm"
							aria-label="Download logs"
							onClick={downloadLogs}
						>
							<Download className="size-3.5" />
						</Button>
					</TooltipTrigger>
					<TooltipContent>Download as .txt</TooltipContent>
				</Tooltip>
			</div>
			<div
				ref={containerRef}
				onScroll={handleScroll}
				className="h-[28rem] overflow-auto bg-card p-3 font-mono text-xs leading-5 text-foreground"
			>
				{visibleLines.length === 0 ? (
					status === "error" && lines.length === 0 ? (
						<div className="flex h-full flex-col items-center justify-center gap-2 text-center">
							<p className="text-sm font-medium text-foreground">Could not open the log stream</p>
							<p className="max-w-sm text-sm text-muted-foreground">
								{errorMessage ?? "The connection was closed by the server."}
							</p>
							<Button variant="outline" size="sm" onClick={reconnectNow}>
								<RefreshCw className="size-3.5" />
								Retry
							</Button>
						</div>
					) : (
						<span className="text-muted-foreground">
							{lines.length === 0
								? status === "connecting"
									? "Waiting for logs…"
									: "No logs yet."
								: "No lines match the current filters."}
						</span>
					)
				) : (
					visibleLines.map((line, index) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only, index keys are stable
						<LogLine key={index} line={line} wrap={wrap} />
					))
				)}
			</div>
		</div>
	);
}
