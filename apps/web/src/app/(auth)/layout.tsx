import Link from "next/link";

import { Logo } from "@/components/shell/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-8 bg-secondary p-6 md:p-10">
			<div className="flex w-full max-w-md flex-col gap-6">
				<Link
					href="/"
					className="self-center rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<Logo className="text-base" />
				</Link>
				{children}
			</div>
		</div>
	);
}
