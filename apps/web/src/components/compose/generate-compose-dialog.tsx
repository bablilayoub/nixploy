"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTRPC } from "@/lib/trpc";

/**
 * "Generate with Copilot" — drafts a docker-compose.yml from a prompt.
 * The draft is only accepted into the editor on explicit confirm; never saved.
 */
export function GenerateComposeDialog({ onAccept }: { onAccept: (composeFile: string) => void }) {
	const trpc = useTRPC();
	const [open, setOpen] = useState(false);
	const [prompt, setPrompt] = useState("");
	const [draft, setDraft] = useState<{ composeFile: string; model: string } | null>(null);

	const aiSettings = useQuery({
		...trpc.ai.getSettings.queryOptions(),
		retry: false,
	});
	const aiEnabled = Boolean(aiSettings.data?.enabled);

	const generate = useMutation(
		trpc.ai.generateCompose.mutationOptions({
			onSuccess: (result) => setDraft(result),
			onError: (error) => toast.error(error.message),
		}),
	);

	const close = (next: boolean) => {
		setOpen(next);
		if (!next) setDraft(null);
	};

	// Copilot off — graceful hint instead of a dead button.
	if (!aiEnabled && !aiSettings.isPending) {
		return (
			<TooltipProvider>
				<Tooltip>
					<TooltipTrigger asChild>
						<span className="inline-flex">
							<Button size="sm" variant="outline" asChild>
								<Link href="/dashboard/settings/server">
									<Sparkles className="size-4" />
									Generate with Copilot
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
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>
				<Button size="sm" variant="outline" disabled={aiSettings.isPending}>
					<Sparkles className="size-4" />
					Generate with Copilot
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="size-4" />
						Generate a compose file
					</DialogTitle>
					<DialogDescription>
						Describe the stack you want. The draft is previewed here — nothing is saved until you
						accept it and hit Save.
					</DialogDescription>
				</DialogHeader>

				<form
					className="flex flex-col gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (prompt.trim().length < 8 || generate.isPending) return;
						generate.mutate({ prompt: prompt.trim() });
					}}
				>
					<Textarea
						value={prompt}
						onChange={(event) => setPrompt(event.target.value)}
						placeholder="e.g. Postgres 16 with a persistent volume, Redis, and a Node API on port 3000"
						className="min-h-20"
						disabled={generate.isPending}
					/>
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">
							{prompt.trim().length > 0 && prompt.trim().length < 8
								? "Describe the stack in a few more words."
								: "Generated YAML is validated before previewing."}
						</p>
						<Button
							type="submit"
							size="sm"
							disabled={generate.isPending || prompt.trim().length < 8}
						>
							{generate.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
							{draft ? "Regenerate" : "Generate"}
						</Button>
					</div>
				</form>

				{draft && (
					<div className="flex flex-col gap-2">
						<p className="text-xs text-muted-foreground">Draft (model: {draft.model})</p>
						<pre className="max-h-[40vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs whitespace-pre-wrap">
							{draft.composeFile}
						</pre>
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={() => close(false)}>
						Cancel
					</Button>
					<Button
						disabled={!draft || generate.isPending}
						onClick={() => {
							if (!draft) return;
							onAccept(draft.composeFile);
							close(false);
							toast.success("Draft loaded into the editor — review and Save");
						}}
					>
						Use this draft
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
