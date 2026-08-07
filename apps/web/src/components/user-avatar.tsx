"use client";

import { useEffect, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { resolveUserImageSrc, userInitials } from "@/lib/user-avatar";
import { cn } from "@/lib/utils";

type UserLike = {
	name?: string | null;
	email?: string | null;
	image?: string | null;
};

/** Session/user avatar with Gravatar marker resolution and initials fallback. */
export function UserAvatar({
	user,
	className,
	fallbackClassName,
	size = 128,
}: {
	user: UserLike | null | undefined;
	className?: string;
	fallbackClassName?: string;
	size?: number;
}) {
	const [src, setSrc] = useState<string | null>(null);
	const initials = userInitials(user?.name, user?.email);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const resolved = await resolveUserImageSrc(user?.image, user?.email, size);
			if (!cancelled) setSrc(resolved);
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.image, user?.email, size]);

	return (
		<Avatar className={className}>
			{src ? <AvatarImage src={src} alt="" /> : null}
			<AvatarFallback className={cn(fallbackClassName)}>{initials}</AvatarFallback>
		</Avatar>
	);
}
