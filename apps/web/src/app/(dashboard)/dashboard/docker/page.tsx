import type { Metadata } from "next";

import { DockerView } from "@/components/docker/docker-view";

export const metadata: Metadata = {
	title: "Docker",
};

export default function DockerPage() {
	return <DockerView />;
}
