"use client";

import { TerminalSquare } from "lucide-react";
import { useState } from "react";

import { ServiceTerminal } from "@/components/services/terminal";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * SSH host shell of a managed server, in a dialog next to the other row
 * actions (Settings → Servers).
 *
 * Instance admins only, and only for *remote* servers: there is no terminal
 * into the Nixploy host itself — the panel container runs as root with the
 * Docker socket mounted, so a shell there is a shell on every tenant at once.
 * Containers on the local host stay reachable from the Docker control centre.
 *
 * The xterm session is mounted only while the dialog is open, so closing it
 * ends the SSH connection.
 */
export function ServerTerminalDialog({
	serverId,
	serverName,
	disabled,
	disabledReason,
}: {
	serverId: string;
	serverName: string;
	disabled?: boolean;
	disabledReason?: string;
}) {
	const [open, setOpen] = useState(false);

	return (
		<>
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						disabled={disabled}
						title={disabledReason}
						onClick={() => setOpen(true)}
					>
						<TerminalSquare className="size-4" />
						<span className="sr-only">Open a terminal on {serverName}</span>
					</Button>
				</TooltipTrigger>
				<TooltipContent>{disabledReason ?? "Open a shell on this server over SSH"}</TooltipContent>
			</Tooltip>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-w-4xl">
					<DialogHeader>
						<DialogTitle>Terminal — {serverName}</DialogTitle>
						<DialogDescription>
							A shell on the server over SSH, as the configured user. Everything you type runs on
							the host: the session is written to the audit log and closes after 30 minutes of
							inactivity.
						</DialogDescription>
					</DialogHeader>
					{open && (
						<ServiceTerminal
							endpoint="server-terminal"
							serverId={serverId}
							connectingLabel="Connecting to the server…"
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}
