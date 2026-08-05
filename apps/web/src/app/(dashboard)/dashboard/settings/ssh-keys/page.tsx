import type { Metadata } from "next";

import { SshKeysView } from "@/components/settings/ssh-keys/ssh-keys-view";

export const metadata: Metadata = {
	title: "SSH Key Settings",
};

export default function SshKeysSettingsPage() {
	return <SshKeysView />;
}
