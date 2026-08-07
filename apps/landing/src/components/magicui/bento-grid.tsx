import { ArrowRightIcon } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

import { cn } from "@/lib/utils";

interface BentoGridProps extends ComponentPropsWithoutRef<"div"> {
	children: ReactNode;
	className?: string;
}

interface BentoCardProps extends ComponentPropsWithoutRef<"div"> {
	name: string;
	className?: string;
	background?: ReactNode;
	Icon: React.ElementType;
	description: string;
	href?: string;
	cta?: string;
}

export function BentoGrid({ children, className, ...props }: BentoGridProps) {
	return (
		<div
			className={cn(
				"grid w-full auto-rows-[18rem] grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3",
				className,
			)}
			{...props}
		>
			{children}
		</div>
	);
}

export function BentoCard({
	name,
	className,
	background,
	Icon,
	description,
	href,
	cta,
	...props
}: BentoCardProps) {
	return (
		<div
			key={name}
			className={cn(
				"group relative col-span-1 flex flex-col justify-between overflow-hidden rounded-xl",
				"bg-black [border:1px_solid_rgba(255,255,255,.08)]",
				"transform-gpu",
				className,
			)}
			{...props}
		>
			<div>{background}</div>
			<div className="pointer-events-none z-10 flex transform-gpu flex-col gap-1 p-6 transition-all duration-300 group-hover:-translate-y-2">
				<Icon className="h-8 w-8 origin-left transform-gpu text-white/70 transition-all duration-300 ease-in-out group-hover:scale-75" />
				<h3 className="font-display text-xl font-semibold text-white">{name}</h3>
				<p className="max-w-lg text-sm text-neutral-400">{description}</p>
			</div>

			{href && cta ? (
				<div
					className={cn(
						"pointer-events-none absolute bottom-0 flex w-full translate-y-10 transform-gpu flex-row items-center p-4 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100",
					)}
				>
					<a
						href={href}
						className="pointer-events-auto inline-flex items-center gap-1 text-sm font-medium text-white hover:underline"
					>
						{cta}
						<ArrowRightIcon className="ms-1 size-4" />
					</a>
				</div>
			) : null}

			<div className="pointer-events-none absolute inset-0 transform-gpu transition-all duration-300 group-hover:bg-white/[.03]" />
		</div>
	);
}
