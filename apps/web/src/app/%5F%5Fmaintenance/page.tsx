import { Wrench } from "lucide-react";
import type { Metadata } from "next";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = {
	title: "Under maintenance",
	robots: { index: false, follow: false },
};

/** Static, unauthenticated response for Traefik's maintenance error middleware. */
export default function MaintenancePage() {
	return (
		<main className="flex min-h-svh items-center justify-center bg-background p-6 text-foreground">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Wrench aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>
						<h1>Under maintenance</h1>
					</EmptyTitle>
					<EmptyDescription>
						This site is temporarily unavailable while we carry out scheduled maintenance. Please
						try again shortly.
					</EmptyDescription>
				</EmptyHeader>
			</Empty>
		</main>
	);
}
