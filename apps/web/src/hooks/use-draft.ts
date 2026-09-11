"use client";

import { useCallback, useRef, useState } from "react";

import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";

export interface Draft<T> {
	/** Current editor value — the server value until the user types. */
	value: T;
	/** Replace the value and mark the draft dirty. */
	set: (next: T | ((current: T) => T)) => void;
	/** Merge fields into an object draft and mark it dirty. */
	patch: (partial: Partial<T>) => void;
	/** True while the value differs from the last seeded/saved server value. */
	dirty: boolean;
	/** Discard local edits: fall back to `next` (default: the server value). */
	reset: (next?: T) => void;
	/**
	 * Clear `dirty` without touching the value — call it once a save
	 * succeeded, so the draft follows the server again without flashing the
	 * pre-save value while the refetch lands.
	 */
	markSaved: () => void;
}

/**
 * Stable identity for a seed value. Objects and arrays are compared by their
 * JSON shape, which is enough for the drafts in this app (strings, numbers,
 * booleans, string arrays, small records) and avoids re-seeding on every
 * render just because a parent rebuilt the object literal.
 */
export function draftKey(value: unknown): string {
	try {
		return JSON.stringify(value) ?? "undefined";
	} catch {
		// Circular or non-serialisable: fall back to identity, i.e. re-seed on
		// every new object. Callers in that situation should pass `key`.
		return String(value);
	}
}

/**
 * Local draft state for a form that edits server data.
 *
 * Mirrors the server value while the user is not editing — background
 * refetches (deploy status flips, window focus, websocket invalidations) must
 * not wipe typed text — and stops mirroring as soon as the draft is dirty.
 * This is the pattern the hand-rolled `if (dirty) return` effects implemented
 * in every service form; the re-seed happens during render here, so there is
 * no flash of the stale value.
 *
 * Registering with `useUnsavedChanges` is part of the hook, so every migrated
 * form keeps the beforeunload / link / tab-switch guard for free.
 *
 * ```tsx
 * const name = useDraft(application.name);
 * <Input value={name.value} onChange={(e) => name.set(e.target.value)} />
 * ```
 *
 * `key` overrides the identity used to decide "the server value changed" —
 * pass the row id when the seed itself is not comparable by value.
 */
export function useDraft<T>(initial: T, options: { key?: string } = {}): Draft<T> {
	const seed = options.key ?? draftKey(initial);
	const [state, setState] = useState<{ value: T; dirty: boolean; seed: string }>(() => ({
		value: initial,
		dirty: false,
		seed,
	}));

	// Latest seed/initial for the callbacks below, which run outside render.
	const latest = useRef({ initial, seed });
	latest.current = { initial, seed };

	// Adjust state during render when the server value changed and nothing is
	// being edited (React's "derived state from props" escape hatch).
	if (state.seed !== seed && !state.dirty) {
		setState({ value: initial, dirty: false, seed });
	}

	const set = useCallback((next: T | ((current: T) => T)) => {
		setState((current) => ({
			value: typeof next === "function" ? (next as (value: T) => T)(current.value) : next,
			dirty: true,
			seed: current.seed,
		}));
	}, []);

	const patch = useCallback((partial: Partial<T>) => {
		setState((current) => ({
			value: { ...current.value, ...partial },
			dirty: true,
			seed: current.seed,
		}));
	}, []);

	const reset = useCallback((next?: T) => {
		const { initial: seedValue, seed: seedKey } = latest.current;
		setState({
			value: next === undefined ? seedValue : next,
			dirty: false,
			seed: seedKey,
		});
	}, []);

	const markSaved = useCallback(() => {
		setState((current) => (current.dirty ? { ...current, dirty: false } : current));
	}, []);

	useUnsavedChanges(state.dirty);

	return { value: state.value, set, patch, dirty: state.dirty, reset, markSaved };
}

/** True when any of the given drafts holds unsaved edits. */
export function anyDirty(...drafts: Array<{ dirty: boolean }>): boolean {
	return drafts.some((draft) => draft.dirty);
}
