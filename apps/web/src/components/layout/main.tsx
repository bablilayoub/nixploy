import { cn } from "@/lib/utils";

type MainProps = React.ComponentProps<"main"> & {
	fixed?: boolean;
	fluid?: boolean;
};

export function Main({ fixed, fluid, className, ...props }: MainProps) {
	return (
		<main
			data-layout={fixed ? "fixed" : "auto"}
			className={cn(
				"mx-auto w-full min-w-0 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10",
				fixed && "flex grow flex-col overflow-hidden",
				!fluid && "max-w-[1600px]",
				className,
			)}
			{...props}
		/>
	);
}
