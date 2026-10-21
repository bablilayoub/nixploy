import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
	title: "Not found",
};

export default function NotFound() {
	return (
		<main className="mx-auto flex min-h-svh w-full max-w-xl flex-col items-start justify-center gap-6 px-6 py-16">
			<p className="text-xs text-muted-foreground normal-case">404 / Destination unavailable</p>
			<LogoMark className="mb-3 size-10 rounded-lg" />
			<div className="flex flex-col gap-3">
				<h1 className="text-4xl leading-tight font-semibold tracking-[-0.045em]">Page not found</h1>
				<p className="max-w-md text-sm leading-relaxed text-muted-foreground">
					The page you are looking for does not exist, or the resource it pointed at was deleted.
				</p>
			</div>
			<Button asChild size="sm">
				<Link href="/dashboard">Back to dashboard</Link>
			</Button>
		</main>
	);
}
