import type { Metadata } from "next";

import { CertificatesView } from "@/components/settings/certificates/certificates-view";

export const metadata: Metadata = {
	title: "Certificate Settings",
};

export default function CertificatesSettingsPage() {
	return <CertificatesView />;
}
