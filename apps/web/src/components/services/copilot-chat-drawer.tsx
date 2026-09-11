"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2, Send, Settings2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCapabilities } from "@/hooks/use-capabilities";
import { toastError } from "@/lib/describe-error";
import { useTRPC } from "@/lib/trpc";

import { capabilityHint } from "./capability-hint";

/** `id` is a per-session counter so repeated identical messages keep distinct React keys. */
type ChatMessage = { id: number; role: "user" | "assistant"; content: string };

let nextMessageId = 1;

type ProposedAction =
	| { type: "redeploy" | "deploy" | "start" | "stop"; label: string }
	| { type: "applyComposeDraft"; label: string; composeFile: string };

export type CopilotTarget =
	| { type: "application"; id: string; name: string }
	| { type: "compose"; id: string; name: string };

const SUGGESTIONS: Record<CopilotTarget["type"], string[]> = {
	application: [
		"Why might this be restarting?",
		"How do I add a healthcheck?",
		"Suggest a redeploy if config looks stale.",
	],
	compose: [
		"Generate a compose stack for Postgres + Redis + an API.",
		"Review the compose file for obvious issues.",
		"Suggest a redeploy after fixing the stack.",
	],
};

/**
 * Deploy Copilot — one button for applications and compose stacks.
 * Suggestions and confirmed actions adapt to the current service type.
 */
export function CopilotChatDrawer({ target }: { target: CopilotTarget }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { can } = useCapabilities();
	const canChat = can("ai.use");
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [pendingActions, setPendingActions] = useState<ProposedAction[]>([]);

	// Deep link from the command palette (?copilot=1) opens the drawer once.
	useEffect(() => {
		if (searchParams.get("copilot") !== "1") {
			return;
		}
		setOpen(true);
		// Strip the param so a refresh doesn't reopen the drawer.
		const params = new URLSearchParams(searchParams.toString());
		params.delete("copilot");
		const query = params.toString();
		router.replace(query ? `${pathname}?${query}` : pathname, {
			scroll: false,
		});
	}, [searchParams, router, pathname]);

	const aiSettings = useQuery({
		...trpc.ai.getSettings.queryOptions(),
		retry: false,
	});
	const aiEnabled = Boolean(aiSettings.data?.enabled);

	const chatPayload = useMemo(
		() => (target.type === "application" ? { applicationId: target.id } : { composeId: target.id }),
		[target],
	);

	const chat = useMutation(
		trpc.ai.chat.mutationOptions({
			onSuccess: (result) => {
				setMessages((prev) => [
					...prev,
					{ id: nextMessageId++, role: "assistant", content: result.reply },
				]);
				setPendingActions((result.proposedActions ?? []) as ProposedAction[]);
			},
			onError: (error) => toastError(error),
		}),
	);

	/** Capability the server checks for a proposed action. */
	const actionCapability = (action: ProposedAction): string => {
		switch (action.type) {
			case "deploy":
			case "redeploy":
				return "service.deploy";
			case "start":
			case "stop":
				return "service.runtime";
			case "applyComposeDraft":
				return "service.write";
		}
	};

	const appDeploy = useMutation(trpc.application.deploy.mutationOptions({}));
	const appRedeploy = useMutation(trpc.application.redeploy.mutationOptions({}));
	const appStart = useMutation(trpc.application.start.mutationOptions({}));
	const appStop = useMutation(trpc.application.stop.mutationOptions({}));
	const composeDeploy = useMutation(trpc.compose.deploy.mutationOptions({}));
	const composeRedeploy = useMutation(trpc.compose.redeploy.mutationOptions({}));
	const composeStart = useMutation(trpc.compose.start.mutationOptions({}));
	const composeStop = useMutation(trpc.compose.stop.mutationOptions({}));
	const saveCompose = useMutation(trpc.compose.saveComposeFile.mutationOptions({}));

	const confirmBusy =
		appDeploy.isPending ||
		appRedeploy.isPending ||
		appStart.isPending ||
		appStop.isPending ||
		composeDeploy.isPending ||
		composeRedeploy.isPending ||
		composeStart.isPending ||
		composeStop.isPending ||
		saveCompose.isPending;

	const onActionDone = async (message: string) => {
		toast.success(message);
		setPendingActions([]);
		if (target.type === "application") {
			await queryClient.invalidateQueries({
				queryKey: trpc.application.one.queryKey({ applicationId: target.id }),
			});
		} else {
			await queryClient.invalidateQueries({
				queryKey: trpc.compose.one.queryKey({ composeId: target.id }),
			});
		}
	};

	const confirmAction = async (action: ProposedAction) => {
		try {
			if (action.type === "applyComposeDraft") {
				if (target.type !== "compose") {
					toast.error("Compose draft can only be applied on a compose service");
					return;
				}
				await saveCompose.mutateAsync({
					composeId: target.id,
					composeFile: action.composeFile,
				});
				await onActionDone("Compose draft saved — review the Compose file tab");
				return;
			}

			if (target.type === "application") {
				const payload = { applicationId: target.id };
				switch (action.type) {
					case "deploy":
						await appDeploy.mutateAsync(payload);
						await onActionDone("Deployment queued");
						break;
					case "redeploy":
						await appRedeploy.mutateAsync(payload);
						await onActionDone("Redeployment queued");
						break;
					case "start":
						await appStart.mutateAsync(payload);
						await onActionDone("Application started");
						break;
					case "stop":
						await appStop.mutateAsync(payload);
						await onActionDone("Application stopped");
						break;
				}
				return;
			}

			const payload = { composeId: target.id };
			switch (action.type) {
				case "deploy":
					await composeDeploy.mutateAsync(payload);
					await onActionDone("Deployment queued");
					break;
				case "redeploy":
					await composeRedeploy.mutateAsync(payload);
					await onActionDone("Redeployment queued");
					break;
				case "start":
					await composeStart.mutateAsync(payload);
					await onActionDone("Compose started");
					break;
				case "stop":
					await composeStop.mutateAsync(payload);
					await onActionDone("Compose stopped");
					break;
			}
		} catch (error) {
			toastError(error, "Action failed");
		}
	};

	const send = (contentOverride?: string) => {
		const content = (contentOverride ?? input).trim();
		if (!content || chat.isPending || !aiEnabled || !canChat) return;
		const next: ChatMessage[] = [...messages, { id: nextMessageId++, role: "user", content }];
		setMessages(next);
		setInput("");
		setPendingActions([]);
		chat.mutate({
			...chatPayload,
			messages: next.slice(-16).map(({ role, content: text }) => ({ role, content: text })),
		});
	};

	const kindLabel = target.type === "application" ? "application" : "compose stack";

	const trigger = (
		<Button variant="outline" type="button" disabled={aiSettings.isPending}>
			<Bot className="size-4" />
			Copilot
		</Button>
	);

	if (!aiEnabled && !aiSettings.isPending) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex">
							<Button variant="outline" asChild>
								<Link href="/dashboard/settings/server">
									<Bot className="size-4" />
									Copilot
								</Link>
							</Button>
						</span>
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-xs">
						Deploy Copilot is off — enable it in Settings → Platform (BYO API key).
					</TooltipContent>
				</Tooltip>
			</TooltipProvider>
		);
	}

	return (
		<Sheet
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setPendingActions([]);
				}
			}}
		>
			<SheetTrigger asChild>{trigger}</SheetTrigger>
			<SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
				<SheetHeader className="space-y-1 border-b px-4 pt-4 pb-3 pr-12 text-left">
					<SheetTitle className="flex items-center gap-2">
						<Bot className="size-4" />
						Deploy Copilot
					</SheetTitle>
					<SheetDescription>
						Ask about {target.name} ({kindLabel}). Suggested mutations need your confirm.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
					{messages.length === 0 && (
						<div className="flex flex-col gap-2">
							<p className="text-sm text-muted-foreground">Try one of these:</p>
							<div className="flex flex-col gap-1.5">
								{SUGGESTIONS[target.type].map((suggestion) => (
									<button
										key={suggestion}
										type="button"
										className="rounded-md border bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 disabled:opacity-50"
										onClick={() => send(suggestion)}
										disabled={chat.isPending || !canChat}
										title={canChat ? undefined : capabilityHint("ai.use")}
									>
										{suggestion}
									</button>
								))}
							</div>
						</div>
					)}
					{messages.map((message) => (
						<div
							key={message.id}
							className={
								message.role === "user"
									? "ml-6 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
									: "mr-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap"
							}
						>
							{message.content}
						</div>
					))}
					{chat.isPending && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Thinking…
						</div>
					)}
					{pendingActions.length > 0 && (
						<div className="flex flex-wrap gap-2 rounded-lg border border-dashed p-3">
							<p className="w-full text-xs text-muted-foreground">
								Confirm to run (never applied silently):
							</p>
							{pendingActions.map((action) => (
								<Button
									key={`${action.type}-${action.label}`}
									size="sm"
									variant="secondary"
									disabled={confirmBusy || !can(actionCapability(action))}
									title={
										can(actionCapability(action))
											? undefined
											: capabilityHint(actionCapability(action))
									}
									onClick={() => void confirmAction(action)}
								>
									{confirmBusy ? <Loader2 className="size-3 animate-spin" /> : null}
									{action.label}
								</Button>
							))}
							<Button
								size="sm"
								variant="ghost"
								disabled={confirmBusy}
								onClick={() => setPendingActions([])}
							>
								Dismiss
							</Button>
						</div>
					)}
				</div>

				<div className="flex items-center gap-2 border-t px-4 py-2 text-xs text-muted-foreground">
					<Settings2 className="size-3.5" />
					<Link href="/dashboard/settings/server" className="underline-offset-2 hover:underline">
						AI settings
					</Link>
				</div>

				<form
					className="flex gap-2 border-t px-4 py-4"
					onSubmit={(event) => {
						event.preventDefault();
						send();
					}}
				>
					<Input
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder={
							target.type === "compose" ? "Ask Copilot or describe a stack…" : "Ask Copilot…"
						}
						disabled={chat.isPending}
					/>
					<Button
						type="submit"
						size="icon"
						aria-label="Send message"
						disabled={chat.isPending || !input.trim()}
					>
						<Send className="size-4" />
					</Button>
				</form>
			</SheetContent>
		</Sheet>
	);
}
