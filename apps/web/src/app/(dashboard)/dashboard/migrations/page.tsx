import type { Metadata } from "next";
import { MigrationsView } from "@/components/migrations/migrations-view";

export const metadata: Metadata = { title: "Migrations" };

export default function MigrationsPage() {
	return <MigrationsView />;
}
