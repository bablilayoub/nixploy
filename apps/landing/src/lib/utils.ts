import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** The shadcn `cn`: clsx for conditionals, tailwind-merge so a caller's class wins. */
export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}
