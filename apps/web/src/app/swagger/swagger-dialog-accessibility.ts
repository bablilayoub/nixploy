/** Adapt the standalone Swagger bundle's modal without changing its auth state. */
export function enhanceSwaggerDialogs(container: HTMLElement) {
	const document = container.ownerDocument;
	let dialog: HTMLElement | null = null;
	let opener: HTMLElement | null = null;
	let background: Array<{ element: HTMLElement; inert: boolean; hidden: string | null }> = [];
	let restoreScroll: (() => void) | null = null;

	const lockScroll = () => {
		const view = document.defaultView;
		const position = { left: view?.scrollX ?? 0, top: view?.scrollY ?? 0 };
		const saved = [document.documentElement, document.body].map((element) => ({
			element,
			properties: ["overflow-x", "overflow-y"].map((property) => ({
				property,
				value: element.style.getPropertyValue(property),
				priority: element.style.getPropertyPriority(property),
			})),
		}));
		for (const { element } of saved) element.style.setProperty("overflow", "hidden");
		return () => {
			for (const { element, properties } of saved) {
				element.style.removeProperty("overflow");
				for (const { property, value, priority } of properties) {
					if (value) element.style.setProperty(property, value, priority);
				}
			}
			view?.scrollTo({ ...position, behavior: "instant" });
		};
	};

	const focusable = () =>
		Array.from(
			dialog?.querySelectorAll<HTMLElement>(
				'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
			) ?? [],
		).filter(
			(element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'),
		);

	const restore = () => {
		for (const saved of background) {
			saved.element.inert = saved.inert;
			if (saved.hidden === null) saved.element.removeAttribute("aria-hidden");
			else saved.element.setAttribute("aria-hidden", saved.hidden);
		}
		background = [];
		dialog = null;
		restoreScroll?.();
		restoreScroll = null;
		if (opener?.isConnected) opener.focus({ preventScroll: true });
	};

	const rememberOpener = (event: MouseEvent) => {
		if (dialog || !(event.target instanceof Element)) return;
		const button = event.target.closest("button");
		if (button instanceof HTMLElement) opener = button;
	};

	const synchronize = () => {
		const next = container.querySelector<HTMLElement>(".dialog-ux .modal-ux");
		if (next === dialog) return;
		if (dialog) restore();
		if (!next) return;
		dialog = next;
		restoreScroll = lockScroll();
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		const title = dialog.querySelector<HTMLElement>(".modal-ux-header h3");
		if (title) {
			title.id ||= "swagger-authorization-title";
			dialog.setAttribute("aria-labelledby", title.id);
		} else dialog.setAttribute("aria-label", "API authorization");
		dialog.querySelector(".close-modal")?.setAttribute("aria-label", "Close authorization");

		// Hide sibling branches, preserving their previous state for close/unmount.
		let branch = dialog.closest<HTMLElement>(".dialog-ux");
		while (branch?.parentElement) {
			for (const element of branch.parentElement.children) {
				if (element === branch || !(element instanceof HTMLElement)) continue;
				background.push({
					element,
					inert: element.inert,
					hidden: element.getAttribute("aria-hidden"),
				});
				element.inert = true;
				element.setAttribute("aria-hidden", "true");
			}
			if (branch.parentElement === document.body) break;
			branch = branch.parentElement;
		}
		if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
	};

	const trapTab = (event: KeyboardEvent) => {
		if (!dialog || event.key !== "Tab") return;
		const elements = focusable();
		const first = elements[0];
		const last = elements.at(-1);
		if (!first || !last) return;
		const outside = !dialog.contains(document.activeElement);
		if (
			outside ||
			(event.shiftKey ? document.activeElement === first : document.activeElement === last)
		) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		}
	};
	const observer = new MutationObserver(synchronize);
	observer.observe(container, { childList: true, subtree: true });
	container.addEventListener("click", rememberOpener, true);
	document.addEventListener("keydown", trapTab, true);
	synchronize();
	return () => {
		observer.disconnect();
		container.removeEventListener("click", rememberOpener, true);
		document.removeEventListener("keydown", trapTab, true);
		if (dialog) restore();
	};
}
