import { redirect } from "next/navigation";

/** Incidents moved under Monitoring (UX audit F11); old links keep working. */
export default function IncidentsPage() {
	redirect("/dashboard/monitoring?tab=incidents");
}
