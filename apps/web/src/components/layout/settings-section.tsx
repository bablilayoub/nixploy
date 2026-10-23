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

/** An open form section: headings explain the task; dividers separate related forms. */
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
				"scroll-mt-24 rounded-none border-0 border-b bg-transparent py-7 shadow-none",
				bare && "border-0 py-0",
				danger && "rounded-xl border border-input px-5",
				className,
			)}
		>
			<CardHeader className="px-0">
				<CardTitle as="h2">{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			{children && (
				<CardContent className="px-0">
					<div className={cn("flex min-w-0 flex-col gap-4", !wide && !bare && "max-w-3xl")}>
						{children}
					</div>
				</CardContent>
			)}
			{actions && <CardFooter className="px-0">{actions}</CardFooter>}
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
	return (
		<div className={cn("settings-stack flex w-full min-w-0 flex-col gap-0", className)}>
			{children}
		</div>
	);
}
