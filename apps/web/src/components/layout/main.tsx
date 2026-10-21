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
				"mx-auto w-full min-w-0 px-5 py-6 md:px-8 lg:py-9 xl:px-12",
				fixed && "flex grow flex-col overflow-hidden",
				!fluid && "max-w-[1460px]",
				className,
			)}
			{...props}
		/>
	);
}
