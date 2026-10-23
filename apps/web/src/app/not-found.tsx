import type { Metadata } from "next";
import Link from "next/link";
import { LogoMark } from "@/components/shell/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
	title: "Not found",
};

export default function NotFound() {
	return (
		<div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
			<LogoMark className="size-12 rounded-xl" />
			<div className="flex flex-col gap-1">
				<h1 className="text-lg font-semibold">Page not found</h1>
				<p className="max-w-md text-sm text-muted-foreground">
					The page you are looking for does not exist, or the resource it pointed at was deleted.
				</p>
			</div>
			<Button asChild size="sm">
				<Link href="/dashboard">Back to dashboard</Link>
			</Button>
		</div>
	);
}
