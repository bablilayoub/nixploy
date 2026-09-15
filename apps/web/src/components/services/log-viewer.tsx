"use client";

import {
	AlertTriangle,
	ChevronsDown,
	Copy,
	Download,
	ListFilter,
	Loader2,
	MoreHorizontal,
	RefreshCw,
	Trash2,
	WrapText,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { NotRunningState, type RuntimeEmptyProps } from "@/components/services/not-running-state";
import { StatusDot } from "@/components/shell";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
		const tag = (prefix[1] ?? "").toLowerCase();
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
	// `failed` on its own, not only `failed to`: the line that actually explains
	// a broken deploy is usually "Deployment failed: …" or "Build failed", and
	// the errors-only filter was hiding exactly the line it exists to find.
	if (/\b(ERROR|FATAL|PANIC)\b/.test(line) || /\bfail(ed|ure)\b|\berror:/i.test(line))
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
	{ tag: string; label: string; badge: string; text: string; rule: string }
> = {
	error: {
		tag: "ERR",
		label: "Errors",
		badge: "bg-destructive/15 text-destructive",
		text: "text-destructive",
		rule: "bg-destructive",
	},
	warn: {
		tag: "WRN",
		label: "Warnings",
		badge: "bg-warning/15 text-warning",
		text: "text-warning",
		rule: "bg-warning",
	},
	success: {
		tag: "OK",
		label: "Success",
		badge: "bg-success/15 text-success",
		text: "text-success",
		rule: "bg-success",
	},
	info: {
		tag: "INF",
		label: "Info",
		badge: "bg-info/15 text-info",
		text: "text-info",
		rule: "bg-info",
	},
	debug: {
		tag: "DBG",
		label: "Debug",
		badge: "bg-muted text-muted-foreground",
		text: "text-muted-foreground",
		rule: "bg-muted-foreground/40",
	},
};

/**
 * One log line: line number, a level rule, the dimmed timestamp, the text.
 *
 * The three-letter badge that used to sit in front of every line is gone. It
 * repeated what the colour of the text already said, and a column of ERR / INF /
 * DBG chips down the left made the whole block read as a table of tags rather
 * than as output. The rule keeps errors just as findable while the text itself
 * starts at a straight left edge.
 *
 * The number is the line's position in the *unfiltered* stream, so it still
 * means something after a filter narrows the view — and gives you something to
 * point at when someone asks which line failed.
 */
function LogLine({ line, number, wrap }: { line: string; number: number; wrap: boolean }) {
	const { level, text } = classifyLine(line);
	const style = level === "default" ? null : LEVEL_STYLES[level];
	const timestamp = text.match(TIMESTAMP_REGEX);
	const body = timestamp ? text.slice(timestamp[0].length) : text;
	return (
		<div className="group flex gap-2">
			<span className="w-10 shrink-0 select-none pe-1 text-right text-muted-foreground/50 tabular-nums">
				{number}
			</span>
			<span
				aria-hidden
				className={cn("w-0.5 shrink-0 rounded-full", style ? style.rule : "bg-transparent")}
			/>
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
	// Numbered against the unfiltered stream so a line keeps its identity while
	// a filter is on, and counted per level in the same pass the filter makes.
	const levelCounts: Record<LineLevel, number> = {
		error: 0,
		warn: 0,
		success: 0,
		info: 0,
		debug: 0,
		default: 0,
	};
	const visible: { line: string; number: number }[] = [];
	lines.forEach((line, index) => {
		const { level } = classifyLine(line);
		levelCounts[level] += 1;
		if (needle && !line.toLowerCase().includes(needle)) return;
		if (hiddenLevels.has(level)) return;
		visible.push({ line, number: index + 1 });
	});
	const visibleLines = visible.map((row) => row.line);

	// "Why did it fail" is the question a log is opened with, and a thousand-line
	// build answers it in one line somewhere in the middle. This narrows to that
	// line in one click and restores the full stream in a second.
	const errorCount = levelCounts.error;
	const errorsOnly =
		errorCount > 0 &&
		(["warn", "success", "info", "debug", "default"] as LineLevel[]).every((level) =>
			hiddenLevels.has(level),
		);
	const toggleErrorsOnly = () =>
		setHiddenLevels(
			errorsOnly
				? new Set()
				: new Set(["warn", "success", "info", "debug", "default"] as LineLevel[]),
		);

	const copyLogs = async () => {
		try {
			await navigator.clipboard.writeText(visibleLines.join("\n"));
			toast.success("Logs copied");
		} catch {
			toast.error("Failed to copy — use Download instead");
		}
	};

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
			{/*
			 * One toolbar, not two. It used to be a status row and a filter row —
			 * seven controls over two lines, with the follow-latest arrow sitting
			 * one button away from the download arrow and looking identical to it.
			 * What is left here is what a log is actually driven with: what it is
			 * doing, a search box, a level filter, and the one question anybody
			 * opens a failed deploy to ask. The rest lives behind the overflow.
			 */}
			<div className="flex flex-wrap items-center gap-2 border-b border-border bg-black/[0.02] px-3 py-2 dark:bg-white/[0.02]">
				<div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
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
					<span className="truncate">
						{status === "connected" && "Live"}
						{status === "connecting" && (
							<span className="inline-flex items-center gap-1.5">
								<Loader2 className="size-3 animate-spin" /> Connecting…
							</span>
						)}
						{status === "disconnected" && "Reconnecting…"}
						{status === "finished" && "Finished"}
						{status === "error" && (
							<span className="text-destructive" title={errorMessage ?? undefined}>
								{errorMessage ?? "Connection failed"}
							</span>
						)}
					</span>
				</div>

				<Input
					placeholder="Filter…"
					aria-label="Filter logs"
					value={filter}
					onChange={(event) => setFilter(event.target.value)}
					className="h-7 w-32 font-mono text-xs sm:w-44"
				/>

				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							variant={hiddenLevels.size > 0 ? "secondary" : "outline"}
							size="sm"
							className="h-7 gap-1.5 px-2 text-xs"
						>
							<ListFilter className="size-3.5" />
							{hiddenLevels.size > 0 ? `${hiddenLevels.size} hidden` : "Levels"}
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="start" className="w-44">
						<DropdownMenuLabel>Show levels</DropdownMenuLabel>
						{(Object.keys(LEVEL_STYLES) as (keyof typeof LEVEL_STYLES)[]).map((level) => (
							<DropdownMenuCheckboxItem
								key={level}
								checked={!hiddenLevels.has(level)}
								onCheckedChange={() => toggleLevel(level)}
								onSelect={(event) => event.preventDefault()}
							>
								<span className="flex-1">{LEVEL_STYLES[level].label}</span>
								<span className="tabular-nums text-muted-foreground">{levelCounts[level]}</span>
							</DropdownMenuCheckboxItem>
						))}
						{hiddenLevels.size > 0 ? (
							<>
								<DropdownMenuSeparator />
								<DropdownMenuItem onSelect={() => setHiddenLevels(new Set())}>
									Show everything
								</DropdownMenuItem>
							</>
						) : null}
					</DropdownMenuContent>
				</DropdownMenu>

				{errorCount > 0 && (
					<Button
						variant={errorsOnly ? "secondary" : "outline"}
						size="sm"
						className={cn("h-7 gap-1.5 px-2 text-xs", !errorsOnly && "text-destructive")}
						onClick={toggleErrorsOnly}
					>
						<AlertTriangle className="size-3.5" />
						{errorsOnly ? "Show all" : `${errorCount} ${errorCount === 1 ? "error" : "errors"}`}
					</Button>
				)}

				<span className="ms-auto text-xs tabular-nums text-muted-foreground">
					{visible.length === lines.length
						? `${lines.length} ${lines.length === 1 ? "line" : "lines"}`
						: `${visible.length} of ${lines.length}`}
				</span>

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
								aria-label="Wrap long lines"
								aria-pressed={wrap}
								onClick={() => setWrap((value) => !value)}
							>
								<WrapText className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Wrap long lines</TooltipContent>
					</Tooltip>
					<Tooltip>
						<TooltipTrigger asChild>
							<Button
								variant={pinned ? "secondary" : "outline"}
								size="icon-sm"
								aria-label="Follow latest output"
								aria-pressed={pinned}
								onClick={scrollToBottom}
							>
								{/* Not an arrow-to-line: that is the download glyph, and the
								    two sat next to each other meaning different things. */}
								<ChevronsDown className="size-3.5" />
							</Button>
						</TooltipTrigger>
						<TooltipContent>Follow latest output</TooltipContent>
					</Tooltip>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="outline" size="icon-sm" aria-label="More log actions">
								<MoreHorizontal className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							<DropdownMenuItem onSelect={() => void copyLogs()}>
								<Copy className="size-4" />
								Copy what is shown
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={downloadLogs}>
								<Download className="size-4" />
								Download as .txt
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								variant="destructive"
								onSelect={() => {
									setLines([]);
									bufferRef.current = "";
								}}
							>
								<Trash2 className="size-4" />
								Clear
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
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
								: "No lines match the current filter."}
						</span>
					)
				) : (
					visible.map((row) => (
						<LogLine key={row.number} line={row.line} number={row.number} wrap={wrap} />
					))
				)}
			</div>
		</div>
	);
}
