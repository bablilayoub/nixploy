"use client";

import { useEffect } from "react";

export const UNSAVED_CHANGES_MESSAGE = "You have unsaved changes. Leave and discard them?";

/**
 * Registry of forms that currently hold unsaved edits. Forms register while
 * dirty (`useUnsavedChanges`); the navigation guards consult it so an edit is
 * never discarded silently:
 *
 * - `beforeunload` for reloads, closed tabs and full navigations;
 * - a capture-phase click listener for in-app `<a>` / `<Link>` clicks
 *   (Next's Link bails out when the event was default-prevented);
 * - `confirmDiscardUnsavedChanges()` for programmatic tab switches
 *   (`useSyncedTab`, the project page tabs) whose `TabsContent` unmounts the
 *   form.
 *
 * Browser back/forward cannot be intercepted reliably in the App Router and is
 * left alone.
 */
const dirtyForms = new Set<symbol>();

export function hasUnsavedChanges(): boolean {
	return dirtyForms.size > 0;
}

/**
 * True when navigation may proceed: nothing is dirty, or the user agreed to
 * discard. The registry is left untouched — the dirty form unmounts with the
 * navigation and unregisters itself.
 */
export function confirmDiscardUnsavedChanges(): boolean {
	if (!hasUnsavedChanges()) return true;
	return window.confirm(UNSAVED_CHANGES_MESSAGE);
}

function guardedAnchor(event: MouseEvent): HTMLAnchorElement | null {
	if (event.defaultPrevented || event.button !== 0) return null;
	if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
	const target = event.target;
	if (!(target instanceof Element)) return null;
	const anchor = target.closest("a[href]");
	if (!(anchor instanceof HTMLAnchorElement)) return null;
	if (anchor.target && anchor.target !== "_self") return null;
	if (anchor.hasAttribute("download")) return null;
	// Cross-origin links are full navigations — beforeunload already covers them.
	if (anchor.origin !== window.location.origin) return null;
	const current = window.location;
	// Hash-only jumps (skip link, section anchors) keep the form mounted.
	if (anchor.pathname === current.pathname && anchor.search === current.search) return null;
	return anchor;
}

function onBeforeUnload(event: BeforeUnloadEvent) {
	if (!hasUnsavedChanges()) return;
	event.preventDefault();
	// Legacy browsers only show the prompt when returnValue is set.
	event.returnValue = UNSAVED_CHANGES_MESSAGE;
}

function onDocumentClick(event: MouseEvent) {
	if (!hasUnsavedChanges()) return;
	if (!guardedAnchor(event)) return;
	if (confirmDiscardUnsavedChanges()) return;
	event.preventDefault();
	event.stopImmediatePropagation();
}

function attachGuards() {
	window.addEventListener("beforeunload", onBeforeUnload);
	document.addEventListener("click", onDocumentClick, true);
}

function detachGuards() {
	window.removeEventListener("beforeunload", onBeforeUnload);
	document.removeEventListener("click", onDocumentClick, true);
}

/**
 * Register a form as dirty for as long as `dirty` is true. The global guards
 * are attached while at least one form is registered and removed with the
 * last one, so clean pages carry no listeners.
 */
export function useUnsavedChanges(dirty: boolean): void {
	useEffect(() => {
		if (!dirty) return;
		const token = Symbol("unsaved-form");
		if (dirtyForms.size === 0) attachGuards();
		dirtyForms.add(token);
		return () => {
			dirtyForms.delete(token);
			if (dirtyForms.size === 0) detachGuards();
		};
	}, [dirty]);
}
