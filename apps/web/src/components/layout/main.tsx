import { cn } from "@/lib/utils";

type MainProps = React.ComponentPropsWithoutRef<"main"> & {
	as?: "main" | "div";
	fixed?: boolean;
	fluid?: boolean;
};

export function Main({ as: Tag = "main", fixed, fluid, className, ...props }: MainProps) {
	return (
		<Tag
			data-layout={fixed ? "fixed" : "auto"}
			className={cn(
				"mx-auto w-full min-w-0 px-4 py-8 sm:px-6 lg:px-10 lg:py-10",
				fixed && "flex grow flex-col overflow-hidden",
				!fluid && "max-w-screen-2xl",
				className,
			)}
			{...props}
		/>
	);
}
