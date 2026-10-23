import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
	"inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-full text-sm font-semibold whitespace-normal text-center transition-[background-color,color,border-color,box-shadow] duration-150 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
	{
		variants: {
			variant: {
				default:
					"border border-transparent bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75",
				destructive:
					"bg-destructive text-primary-foreground hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive dark:focus-visible:ring-destructive/40",
				outline:
					"border border-border bg-background text-foreground hover:bg-accent hover:border-ring/60",
				secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
				ghost: "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
				link: "text-primary underline underline-offset-4 hover:decoration-2",
			},
			size: {
				default: "h-auto min-h-9 px-4 py-2 has-[>svg]:px-3",
				xs: "h-6 gap-1 rounded-full px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
				sm: "h-auto min-h-8 gap-1.5 py-1.5 rounded-full px-3 has-[>svg]:px-2.5",
				lg: "h-auto min-h-11 py-2 rounded-full px-6 has-[>svg]:px-4",
				icon: "size-9",
				"icon-xs": "size-6 rounded-full [&_svg:not([class*='size-'])]:size-3",
				"icon-sm": "size-8",
				"icon-lg": "size-10",
			},
		},
		defaultVariants: {
			variant: "default",
			size: "default",
		},
	},
);

function Button({
	className,
	variant = "default",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"button"> &
	VariantProps<typeof buttonVariants> & {
		asChild?: boolean;
	}) {
	const Comp = asChild ? Slot.Root : "button";

	return (
		<Comp
			data-slot="button"
			data-ui="button"
			data-variant={variant}
			data-size={size}
			className={cn(buttonVariants({ variant, size, className }))}
			{...props}
		/>
	);
}

export { Button, buttonVariants };
