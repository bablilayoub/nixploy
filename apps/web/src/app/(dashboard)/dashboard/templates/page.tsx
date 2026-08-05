import type { Metadata } from "next";
import { Suspense } from "react";

import { TemplatesView } from "@/components/templates/templates-view";

export const metadata: Metadata = {
	title: "Templates",
};

export default function TemplatesPage() {
	return (
		<Suspense>
			<TemplatesView />
		</Suspense>
	);
}
