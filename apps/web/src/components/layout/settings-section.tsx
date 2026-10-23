import type { ReactNode } from "react";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/** Shared settings composition using the standard shadcn Card. */
export function SettingsSection({
	title,
	description,
	children,
	danger = false,
	bare = false,
	wide = false,
	className,
	actions,
	id,
}: {
	title: ReactNode;
	description?: ReactNode;
	children?: ReactNode;
	danger?: boolean;
	bare?: boolean;
	wide?: boolean;
	className?: string;
	actions?: ReactNode;
	id?: string;
}) {
	return (
		<Card
			id={id}
			data-settings-section=""
			data-wide={wide || bare}
			data-danger={danger}
			tabIndex={id ? -1 : undefined}
			className={cn(
				"scroll-mt-24 min-w-0",
				bare && "border-0 p-0 shadow-none",
				danger && "border-destructive/50",
				className,
			)}
		>
			<CardHeader>
				<CardTitle as="h2">{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			{children && (
				<CardContent>
					<div className={cn("flex min-w-0 flex-col gap-4", !wide && !bare && "max-w-3xl")}>
						{children}
					</div>
				</CardContent>
			)}
			{actions && (
				<CardFooter className="flex-wrap justify-end gap-2 border-t bg-muted/30 py-4">
					{actions}
				</CardFooter>
			)}
		</Card>
	);
}
export function SettingsStack({
	children,
	className,
}: {
	children: ReactNode;
	className?: string;
}) {
	return <div className={cn("flex w-full min-w-0 flex-col gap-6", className)}>{children}</div>;
}
