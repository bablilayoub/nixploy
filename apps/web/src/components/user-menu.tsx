"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, KeyRound, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { signOut, useSession } from "@/lib/auth-client";

const settingsItems = [
	{ label: "Profile", icon: User, href: "/dashboard/settings/profile" },
	{ label: "SSH keys", icon: KeyRound, href: "/dashboard/settings/ssh-keys" },
	{
		label: "Notifications",
		icon: Bell,
		href: "/dashboard/settings/notifications",
	},
];

export function UserMenu() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useSession();
	// Render the skeleton until mounted so SSR and the first client render
	// match (useSession resolves synchronously on the client → hydration
	// mismatch otherwise).
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const user = session?.user;
	const initials = (user?.name || user?.email || "?")
		.split(/\s+/)
		.map((part) => part.charAt(0).toUpperCase())
		.slice(0, 2)
		.join("");

	const handleSignOut = async () => {
		try {
			await signOut();
			queryClient.clear();
			router.push("/login");
			router.refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to sign out");
		}
	};

	if (!mounted || isPending) {
		return <Skeleton className="size-7 rounded-full" />;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<button
					type="button"
					className="rounded-full outline-none ring-offset-background transition-opacity hover:opacity-80 focus-visible:ring-[3px] focus-visible:ring-ring/50"
				>
					<Avatar className="size-7">
						<AvatarFallback className="text-xs">{initials}</AvatarFallback>
					</Avatar>
					<span className="sr-only">Account menu</span>
				</button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="min-w-56" align="end" sideOffset={6}>
				<DropdownMenuLabel className="p-0 font-normal">
					<div className="flex items-center gap-2 px-1.5 py-1.5 text-left text-sm">
						<Avatar className="size-8">
							<AvatarFallback>{initials}</AvatarFallback>
						</Avatar>
						<div className="grid flex-1 text-left text-sm leading-tight">
							<span className="truncate font-semibold">{user?.name ?? "User"}</span>
							<span className="truncate text-xs text-muted-foreground">{user?.email}</span>
						</div>
					</div>
				</DropdownMenuLabel>
				<DropdownMenuSeparator />
				<DropdownMenuGroup>
					{settingsItems.map((item) => (
						<DropdownMenuItem key={item.label} asChild>
							<Link href={item.href}>
								<item.icon className="size-4" />
								{item.label}
							</Link>
						</DropdownMenuItem>
					))}
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" onSelect={handleSignOut}>
					<LogOut className="size-4" />
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
