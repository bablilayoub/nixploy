"use client";

import { createContext, useContext } from "react";

/**
 * Instance whitelabel, handed down from the server layout.
 *
 * A context rather than a query: the login page, the setup wizard and the
 * favicon all need it before a session exists, and a client fetch would mean
 * every page flashes "Nixploy" before becoming whatever the operator called
 * it. The server resolves it once per render and passes it as a prop.
 */

export interface Branding {
	productName: string;
	accentColor: string | null;
	logoLightUrl: string | null;
	logoDarkUrl: string | null;
	faviconUrl: string | null;
	footerText: string | null;
	supportUrl: string | null;
	docsUrl: string | null;
	customCss: string | null;
	customised: boolean;
}

export const DEFAULT_BRANDING: Branding = {
	productName: "Nixploy",
	accentColor: null,
	logoLightUrl: null,
	logoDarkUrl: null,
	faviconUrl: null,
	footerText: null,
	supportUrl: null,
	docsUrl: null,
	customCss: null,
	customised: false,
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({
	branding,
	children,
}: {
	branding: Branding;
	children: React.ReactNode;
}) {
	return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

/** The instance's branding, falling back to Nixploy's own. */
export const useBranding = (): Branding => useContext(BrandingContext);
