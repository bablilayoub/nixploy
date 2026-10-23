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

/** Library Card composition keeps each settings task and its actions together. */
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
			tabIndex={id ? -1 : undefined}
			className={cn(
				"scroll-mt-24",
				bare && "border-0 bg-transparent shadow-none",
				danger && "border-input",
				className,
			)}
		>
			<CardHeader>
				<CardTitle as="h3">{title}</CardTitle>
				{description && <CardDescription>{description}</CardDescription>}
			</CardHeader>
			{children && (
				<CardContent>
					<div className={cn("flex min-w-0 flex-col gap-4", !wide && !bare && "max-w-3xl")}>
						{children}
					</div>
				</CardContent>
			)}
			{actions && <CardFooter className="border-t">{actions}</CardFooter>}
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
