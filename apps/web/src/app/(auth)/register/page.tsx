import { redirect } from "next/navigation";

/** Public registration is disabled — send leftovers to first-boot setup. */
export default function RegisterRedirectPage() {
	redirect("/setup");
}
