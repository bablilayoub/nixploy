"use client";

import type { ReactNode } from "react";
import { createContext, useContext } from "react";

import type { Application } from "./types";

const ApplicationContext = createContext<Application | null>(null);

/**
 * Holds the loaded `application.one` row for the whole detail page, so tabs
 * and cards stop threading it through every level (code-health F13: it used
 * to be a prop on 14 components, two of which existed only to forward it).
 *
 * The provider sits under the page's query, so the value is never null inside
 * the tree — `useApplication()` throws if a component is mounted outside it,
 * which is a programming error rather than a state to render.
 */
export function ApplicationProvider({
	application,
	children,
}: {
	application: Application;
	children: ReactNode;
}) {
	return <ApplicationContext.Provider value={application}>{children}</ApplicationContext.Provider>;
}

export function useApplication(): Application {
	const application = useContext(ApplicationContext);
	if (!application) {
		throw new Error("useApplication must be used inside <ApplicationProvider>");
	}
	return application;
}
