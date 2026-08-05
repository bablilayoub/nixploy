import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSession } from "@/lib/auth-server";

import { SwaggerExplorer } from "./swagger-explorer";

export const metadata: Metadata = {
	title: "API Reference",
};

export const dynamic = "force-dynamic";

export default async function SwaggerPage() {
	const session = await getSession();
	if (!session) {
		redirect("/login");
	}
	return <SwaggerExplorer />;
}
