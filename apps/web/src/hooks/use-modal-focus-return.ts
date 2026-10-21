"use client";

import { useRef } from "react";

type FocusHandler = (event: Event) => void;

/** Controlled modals can have an ordinary button instead of a Radix trigger. */
export function useModalFocusReturn({
	onOpenAutoFocus,
	onCloseAutoFocus,
}: {
	onOpenAutoFocus?: FocusHandler;
	onCloseAutoFocus?: FocusHandler;
}) {
	const opener = useRef<HTMLElement | null>(null);
	return {
		onOpenAutoFocus(event: Event) {
			const active = document.activeElement;
			opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
			onOpenAutoFocus?.(event);
		},
		onCloseAutoFocus(event: Event) {
			onCloseAutoFocus?.(event);
			if (!event.defaultPrevented && opener.current?.isConnected) {
				event.preventDefault();
				opener.current.focus({ preventScroll: true });
			}
		},
	};
}
