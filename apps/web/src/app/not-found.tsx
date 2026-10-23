import { FileQuestion } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";

export const metadata: Metadata = { title: "Not found" };

export default function NotFound() {
	return (
		<main className="flex min-h-svh items-center justify-center p-6">
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<FileQuestion aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>
						<h1>Page not found</h1>
					</EmptyTitle>
					<EmptyDescription>
						The page you are looking for does not exist, or the resource it pointed at was deleted.
					</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button asChild>
						<Link href="/dashboard">Back to dashboard</Link>
					</Button>
				</EmptyContent>
			</Empty>
		</main>
	);
}
