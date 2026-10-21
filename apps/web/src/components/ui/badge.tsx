import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				default: "border-transparent bg-primary text-primary-foreground",
				secondary: "border-border/80 bg-secondary text-secondary-foreground",
				destructive:
					"border-destructive/30 bg-destructive/10 text-destructive dark:border-destructive/40 dark:bg-destructive/15",
				outline: "border-border bg-transparent text-foreground",
				ghost: "border-transparent text-muted-foreground",
				link: "border-transparent text-primary underline-offset-4 [a&]:hover:underline",
				success:
					"border-success/30 bg-success/10 text-success dark:border-success/35 dark:bg-success/15",
				warning:
					"border-warning/30 bg-warning/10 text-warning dark:border-warning/35 dark:bg-warning/15",
				info: "border-info/30 bg-info/10 text-info dark:border-info/35 dark:bg-info/15",
			},
		},
		defaultVariants: {
			variant: "secondary",
		},
	},
);

function Badge({
	className,
	variant = "secondary",
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			className={cn(badgeVariants({ variant }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
