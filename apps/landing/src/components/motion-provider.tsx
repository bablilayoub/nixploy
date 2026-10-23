"use client";
import { Pause, Play } from "lucide-react";
import { MotionConfig, motion, useReducedMotion } from "motion/react";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";

const MotionContext = createContext({ playing: true, toggle: () => {} });
export function MotionProvider({ children }: { children: ReactNode }) {
	const [playing, setPlaying] = useState(true);
	useEffect(() => {
		try {
			setPlaying(localStorage.getItem("nixploy-site-motion") !== "paused");
		} catch {}
	}, []);
	useEffect(() => {
		document.documentElement.dataset.motion = playing ? "playing" : "paused";
	}, [playing]);
	const toggle = () =>
		setPlaying((current) => {
			const next = !current;
			try {
				localStorage.setItem("nixploy-site-motion", next ? "playing" : "paused");
			} catch {}
			return next;
		});
	return (
		<MotionContext.Provider value={{ playing, toggle }}>
			<MotionConfig reducedMotion={playing ? "user" : "always"}>{children}</MotionConfig>
		</MotionContext.Provider>
	);
}
export function MotionToggle({ label = false }: { label?: boolean }) {
	const { playing, toggle } = useContext(MotionContext);
	const prefersReduced = useReducedMotion();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);
	const reduced = mounted && prefersReduced;
	const text = reduced
		? "Reduced motion enabled"
		: playing
			? "Pause animations"
			: "Play animations";
	const Icon = playing ? Pause : Play;
	return (
		<button
			type="button"
			onClick={toggle}
			disabled={Boolean(reduced)}
			aria-label={text}
			title={text}
			aria-pressed={!playing}
			className="signal-motion-toggle"
		>
			<Icon className="size-4" aria-hidden="true" />
			{label && <span>{text}</span>}
		</button>
	);
}
export function Reveal({
	children,
	className,
	delay = 0,
}: {
	children: ReactNode;
	className?: string;
	delay?: number;
}) {
	const { playing } = useContext(MotionContext);
	const reduced = useReducedMotion();
	return (
		<motion.div
			className={className}
			initial={{ y: 18 }}
			whileInView={{ y: 0 }}
			viewport={{ once: true, amount: 0.08 }}
			transition={{
				duration: playing && !reduced ? 0.3 : 0,
				delay: playing && !reduced ? delay : 0,
				ease: [0.22, 1, 0.36, 1],
			}}
		>
			{children}
		</motion.div>
	);
}
