"use client";

import { isServer, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import { useState } from "react";
import superjson from "superjson";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TRPCProvider } from "@/lib/trpc";
import type { AppRouter } from "@/lib/trpc-types";

/**
 * In the browser, always call the origin the page was served from — a
 * build-time env URL would be baked into the Docker image and point at the
 * wrong host in production. The absolute form is only for the SSR pass.
 */
function trpcUrl(): string {
	if (typeof window !== "undefined") return "/api/trpc";
	return `${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}/api/trpc`;
}

function makeQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30 * 1000,
				refetchOnWindowFocus: false,
				// tRPC 4xx (NOT_FOUND, FORBIDDEN, …) will never succeed on retry —
				// fail fast so pages show their error state instead of hanging on
				// skeletons. Network/5xx errors get two retries.
				retry: (failureCount, error) => {
					const httpStatus = (error as { data?: { httpStatus?: number } } | null)?.data?.httpStatus;
					if (typeof httpStatus === "number" && httpStatus >= 400 && httpStatus < 500) {
						return false;
					}
					return failureCount < 2;
				},
			},
		},
	});
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
	if (isServer) {
		return makeQueryClient();
	}
	browserQueryClient ??= makeQueryClient();
	return browserQueryClient;
}

export function Providers({ children }: { children: React.ReactNode }) {
	const queryClient = getQueryClient();
	const [trpcClient] = useState(() =>
		createTRPCClient<AppRouter>({
			links: [
				httpBatchLink({
					url: trpcUrl(),
					transformer: superjson,
				}),
			],
		}),
	);

	return (
		<NextThemesProvider
			attribute="class"
			defaultTheme="light"
			enableSystem
			disableTransitionOnChange
		>
			<QueryClientProvider client={queryClient}>
				<TRPCProvider trpcClient={trpcClient} queryClient={queryClient}>
					<TooltipProvider>{children}</TooltipProvider>
					<Toaster richColors closeButton />
				</TRPCProvider>
			</QueryClientProvider>
		</NextThemesProvider>
	);
}
