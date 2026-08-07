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
				"mx-auto w-full px-4 py-6 sm:px-6",
				fixed && "flex grow flex-col overflow-hidden",
				!fluid && "max-w-[1400px]",
				className,
			)}
			{...props}
		/>
	);
}
