"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Bell, KeyRound, LogOut, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { UserAvatar } from "@/components/user-avatar";
import { signOut, useSession } from "@/lib/auth-client";

const settingsItems = [
	{ label: "Profile", icon: User, href: "/dashboard/settings/profile" },
	{ label: "SSH keys", icon: KeyRound, href: "/dashboard/settings/ssh-keys" },
	{ label: "Notifications", icon: Bell, href: "/dashboard/settings/notifications" },
];

/** Compact avatar menu for the top header — shadcn-admin ProfileDropdown pattern. */
export function ProfileDropdown() {
	const router = useRouter();
	const queryClient = useQueryClient();
	const { data: session, isPending } = useSession();
	const [mounted, setMounted] = useState(false);
	useEffect(() => setMounted(true), []);

	const user = session?.user;

	const handleSignOut = async () => {
		try {
			// better-auth resolves with `{ error }` instead of throwing.
			const { error } = await signOut();
			if (error) {
				toast.error(error.message ?? "Failed to sign out");
				return;
			}
			queryClient.clear();
			router.push("/login");
			router.refresh();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Failed to sign out");
		}
	};

	if (!mounted || isPending) {
		return <Skeleton className="size-8 rounded-full" />;
	}

	return (
		<DropdownMenu modal={false}>
			<DropdownMenuTrigger asChild>
				<Button variant="ghost" className="relative size-8 rounded-full">
					<UserAvatar user={user} className="size-8" fallbackClassName="text-xs" size={64} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent className="w-56" align="end" forceMount>
				<DropdownMenuLabel className="font-normal">
					<div className="flex flex-col gap-1.5">
						<p className="text-sm leading-none font-medium">{user?.name ?? "User"}</p>
						<p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
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
