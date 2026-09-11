import { redirect } from "next/navigation";

/** The audit log moved under Monitoring (UX audit F11); old links keep working. */
export default function ActivityPage() {
	redirect("/dashboard/monitoring?tab=audit");
}
