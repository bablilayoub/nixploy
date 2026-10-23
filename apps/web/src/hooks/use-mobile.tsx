import * as React from "react";

const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
	const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);
	React.useEffect(() => {
		const root = document.documentElement;
		// Text enlargement needs the same room as viewport zoom. Switch to the
		// native Sheet before the rem-sized sidebar consumes the form column.
		const update = () => {
			const scale = Math.max(1, Number.parseFloat(getComputedStyle(root).fontSize) / 16);
			setIsMobile(window.innerWidth < MOBILE_BREAKPOINT * scale);
		};
		const observer = new ResizeObserver(update);
		observer.observe(root);
		const style = new MutationObserver(update);
		style.observe(root, { attributes: true, attributeFilter: ["style", "class"] });
		window.addEventListener("resize", update);
		update();
		return () => {
			observer.disconnect();
			style.disconnect();
			window.removeEventListener("resize", update);
		};
	}, []);
	return !!isMobile;
}
