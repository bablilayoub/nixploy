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
				"mx-auto w-full min-w-0 px-4 py-7 sm:px-6 sm:py-9 lg:px-10 lg:py-10",
				fixed && "flex grow flex-col overflow-hidden",
				!fluid && "max-w-[1440px]",
				className,
			)}
			{...props}
		/>
	);
}
