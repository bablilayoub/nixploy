"use client";

import type { ComposeService } from "@/components/compose/compose-detail";
import { ComposeRuntimeTab } from "@/components/compose/runtime-tab";

export function LogsTab({ compose }: { compose: ComposeService }) {
	return <ComposeRuntimeTab compose={compose} mode="logs" />;
}
