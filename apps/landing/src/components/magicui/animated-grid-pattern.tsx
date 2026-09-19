"use client";

/*
 * A grid in which a few squares fade in and out at random positions. Adapted
 * from magicui: stroke and fill on the theme's white, the square count and
 * opacity tuned for a near-black fold, and under reduced motion the grid is
 * drawn without any squares. Positions are picked after mount, so the server
 * and the first client paint agree (an empty grid).
 */

import { motion, useReducedMotion } from "motion/react";
import {
	type ComponentPropsWithoutRef,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";

import { cn } from "@/lib/utils";

interface AnimatedGridPatternProps extends ComponentPropsWithoutRef<"svg"> {
	/** Cell size in px. */
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	/** How many squares are lit at any time. */
	numSquares?: number;
	/** Peak opacity of a lit square. */
	maxOpacity?: number;
	/** Seconds for one square to fade in (and, mirrored, out). */
	duration?: number;
	repeatDelay?: number;
}

type Square = { id: number; pos: [number, number]; iteration: number };

export function AnimatedGridPattern({
	width = 48,
	height = 48,
	x = -1,
	y = -1,
	numSquares = 24,
	maxOpacity = 0.12,
	duration = 4,
	repeatDelay = 0.5,
	className,
	...props
}: AnimatedGridPatternProps) {
	const id = useId();
	const reduceMotion = useReducedMotion() === true;
	const containerRef = useRef<SVGSVGElement | null>(null);
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
	const [squares, setSquares] = useState<Square[]>([]);

	const getPos = useCallback((): [number, number] => {
		return [
			Math.floor((Math.random() * dimensions.width) / width),
			Math.floor((Math.random() * dimensions.height) / height),
		];
	}, [dimensions.height, dimensions.width, height, width]);

	const generateSquares = useCallback(
		(count: number): Square[] =>
			Array.from({ length: count }, (_, index) => ({ id: index, pos: getPos(), iteration: 0 })),
		[getPos],
	);

	const updateSquarePosition = useCallback(
		(squareId: number) => {
			setSquares((current) => {
				const square = current[squareId];
				if (!square || square.id !== squareId) return current;
				const next = current.slice();
				next[squareId] = { ...square, pos: getPos(), iteration: square.iteration + 1 };
				return next;
			});
		},
		[getPos],
	);

	useEffect(() => {
		if (reduceMotion) return;
		if (dimensions.width && dimensions.height) {
			setSquares(generateSquares(numSquares));
		}
	}, [dimensions.width, dimensions.height, generateSquares, numSquares, reduceMotion]);

	useEffect(() => {
		const element = containerRef.current;
		if (!element) return;
		const observer = new ResizeObserver((entries) => {
			for (const entry of entries) {
				setDimensions((current) => {
					const nextWidth = entry.contentRect.width;
					const nextHeight = entry.contentRect.height;
					if (current.width === nextWidth && current.height === nextHeight) return current;
					return { width: nextWidth, height: nextHeight };
				});
			}
		});
		observer.observe(element);
		return () => observer.disconnect();
	}, []);

	return (
		<svg
			ref={containerRef}
			aria-hidden="true"
			className={cn(
				"pointer-events-none absolute inset-0 h-full w-full fill-white stroke-white/[0.06]",
				className,
			)}
			{...props}
		>
			<defs>
				<pattern id={id} width={width} height={height} patternUnits="userSpaceOnUse" x={x} y={y}>
					<path d={`M.5 ${height}V.5H${width}`} fill="none" />
				</pattern>
			</defs>
			<rect width="100%" height="100%" fill={`url(#${id})`} />
			<svg x={x} y={y} className="overflow-visible" aria-hidden="true">
				{squares.map(({ pos: [squareX, squareY], id: squareId, iteration }, index) => (
					<motion.rect
						key={`${squareId}-${iteration}`}
						initial={{ opacity: 0 }}
						animate={{ opacity: maxOpacity }}
						transition={{
							duration,
							repeat: 1,
							delay: index * 0.1,
							repeatType: "reverse",
							repeatDelay,
						}}
						onAnimationComplete={() => updateSquarePosition(squareId)}
						width={width - 1}
						height={height - 1}
						x={squareX * width + 1}
						y={squareY * height + 1}
						fill="currentColor"
						strokeWidth="0"
					/>
				))}
			</svg>
		</svg>
	);
}
