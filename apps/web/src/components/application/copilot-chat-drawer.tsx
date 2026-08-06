"use client";

import { useMutation } from "@tanstack/react-query";
import { Bot, Loader2, Send } from "lucide-react";
import { useState } from "react";
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
import { useTRPC } from "@/lib/trpc";

type ChatMessage = { role: "user" | "assistant"; content: string };

type ProposedAction = {
	type: "redeploy" | "deploy" | "start" | "stop";
	label: string;
};

export function CopilotChatDrawer({
	applicationId,
	applicationName,
}: {
	applicationId: string;
	applicationName: string;
}) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [input, setInput] = useState("");
	const [messages, setMessages] = useState<ChatMessage[]>([]);
	const [pendingActions, setPendingActions] = useState<ProposedAction[]>([]);

	const chat = useMutation(
		trpc.ai.chat.mutationOptions({
			onSuccess: (result) => {
				setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
				setPendingActions(result.proposedActions ?? []);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const deploy = useMutation(
		trpc.application.deploy.mutationOptions({
			onSuccess: () => {
				toast.success("Deployment queued");
				setPendingActions([]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const redeploy = useMutation(
		trpc.application.redeploy.mutationOptions({
			onSuccess: () => {
				toast.success("Redeployment queued");
				setPendingActions([]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const start = useMutation(
		trpc.application.start.mutationOptions({
			onSuccess: () => {
				toast.success("Application started");
				setPendingActions([]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);
	const stop = useMutation(
		trpc.application.stop.mutationOptions({
			onSuccess: () => {
				toast.success("Application stopped");
				setPendingActions([]);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const confirmBusy = deploy.isPending || redeploy.isPending || start.isPending || stop.isPending;

	const confirmAction = (action: ProposedAction) => {
		const input = { applicationId };
		switch (action.type) {
			case "deploy":
				deploy.mutate(input);
				break;
			case "redeploy":
				redeploy.mutate(input);
				break;
			case "start":
				start.mutate(input);
				break;
			case "stop":
				stop.mutate(input);
				break;
		}
	};

	const send = () => {
		const content = input.trim();
		if (!content || chat.isPending) return;
		const next: ChatMessage[] = [...messages, { role: "user", content }];
		setMessages(next);
		setInput("");
		setPendingActions([]);
		chat.mutate({ applicationId, messages: next.slice(-16) });
	};

	return (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button variant="outline" size="sm">
					<Bot className="size-4" />
					Copilot
				</Button>
			</SheetTrigger>
			<SheetContent className="flex w-full flex-col sm:max-w-md">
				<SheetHeader>
					<SheetTitle className="flex items-center gap-2">
						<Bot className="size-4" />
						Deploy Copilot
					</SheetTitle>
					<SheetDescription>
						Ask about {applicationName}. Suggested mutations need your confirm.
					</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-4">
					{messages.length === 0 && (
						<p className="text-sm text-muted-foreground">
							Try: “Why is this restarting?”, “How do I add a healthcheck?”, or “Wire a domain.”
						</p>
					)}
					{messages.map((message) => (
						<div
							key={`${message.role}-${message.content.slice(0, 48)}`}
							className={
								message.role === "user"
									? "ml-8 rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
									: "mr-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm whitespace-pre-wrap"
							}
						>
							{message.content}
						</div>
					))}
					{chat.isPending && (
						<div className="mr-4 flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" />
							Thinking…
						</div>
					)}
					{pendingActions.length > 0 && (
						<div className="mr-4 flex flex-wrap gap-2 rounded-lg border border-dashed p-3">
							<p className="w-full text-xs text-muted-foreground">
								Confirm to run (never applied silently):
							</p>
							{pendingActions.map((action) => (
								<Button
									key={`${action.type}-${action.label}`}
									size="sm"
									variant="secondary"
									disabled={confirmBusy}
									onClick={() => confirmAction(action)}
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

				<form
					className="flex gap-2 border-t pt-4"
					onSubmit={(event) => {
						event.preventDefault();
						send();
					}}
				>
					<Input
						value={input}
						onChange={(event) => setInput(event.target.value)}
						placeholder="Ask Copilot…"
						disabled={chat.isPending}
					/>
					<Button type="submit" size="icon" disabled={chat.isPending || !input.trim()}>
						<Send className="size-4" />
					</Button>
				</form>
			</SheetContent>
		</Sheet>
	);
}
