"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { ComposeRuntimeTab } from "@/components/compose/runtime-tab";

export function TerminalTab({ compose }: { compose: ComposeService }) {
	return <ComposeRuntimeTab compose={compose} mode="terminal" />;
}
