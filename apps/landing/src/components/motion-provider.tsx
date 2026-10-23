"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/*
 * `reducedMotion="user"` makes every Motion component on the site honour the
 * operating system's setting without each one asking. The registry components
 * animate with Motion and none of them check it themselves; the CSS-driven
 * ones (the marquee, the shimmer, the border beam) are handled by the
 * reduced-motion block in globals.css.
 */
export function MotionProvider({ children }: { children: ReactNode }) {
	return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
