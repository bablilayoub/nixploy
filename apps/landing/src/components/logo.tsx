import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";

/** The whole site is near-black, so the white mark is the only one used. */
export const NIXPLOY_MARK_SRC = "/brand/nixploy-mark-light.png";

export function LogoMark({ className }: { className?: string }) {
	return (
		<span
			className={cn("relative inline-flex size-6 shrink-0 overflow-hidden rounded-md", className)}
		>
			<Image
				src={NIXPLOY_MARK_SRC}
				alt=""
				width={80}
				height={80}
				className="size-full object-cover"
				priority
			/>
		</span>
	);
}

export function Logo({
	className,
	href = "/",
	showWordmark = true,
}: {
	className?: string;
	href?: string;
	showWordmark?: boolean;
}) {
	return (
		<Link
			href={href}
			className={cn("inline-flex items-center gap-2.5 text-foreground", className)}
			aria-label="Nixploy"
		>
			<LogoMark className="size-7" />
			{showWordmark ? (
				<span className="font-display text-lg font-semibold tracking-tight">Nixploy</span>
			) : null}
		</Link>
	);
}
