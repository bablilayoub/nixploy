"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { createContext, useContext, useEffect, useRef, useState } from "react";

type Preference = "light" | "dark" | "system";
const ThemeContext = createContext<{
	preference: Preference;
	setPreference: (value: Preference) => void;
}>({ preference: "system", setPreference: () => {} });
function valid(value: string | null): Preference {
	return value === "light" || value === "dark" || value === "system" ? value : "dark";
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
	const [preference, setPreference] = useState<Preference>("dark");
	const current = useRef<Preference>("dark");
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			document.documentElement.classList.toggle(
				"dark",
				current.current === "dark" || (current.current === "system" && media.matches),
			);
		};
		const sync = () => {
			try {
				current.current = valid(localStorage.getItem("theme"));
			} catch {
				/* Keep the in-memory preference. */
			}
			setPreference(current.current);
			apply();
		};
		sync();
		media.addEventListener("change", apply);
		window.addEventListener("storage", sync);
		return () => {
			media.removeEventListener("change", apply);
			window.removeEventListener("storage", sync);
		};
	}, []);
	const change = (value: Preference) => {
		setPreference(value);
		current.current = value;
		try {
			localStorage.setItem("theme", value);
		} catch {
			/* In-memory theme still works. */
		}
		document.documentElement.classList.toggle(
			"dark",
			value === "dark" ||
				(value === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches),
		);
	};
	return (
		<ThemeContext.Provider value={{ preference, setPreference: change }}>
			{children}
		</ThemeContext.Provider>
	);
}

export function ThemeToggle() {
	const { preference, setPreference } = useContext(ThemeContext);
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger
				className="inline-flex size-10 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground"
				aria-label="Color theme"
			>
				<Sun className="size-4 dark:hidden" />
				<Moon className="hidden size-4 dark:block" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align="end"
					sideOffset={8}
					className="z-50 min-w-40 rounded-lg border bg-popover p-1.5 text-sm shadow-[var(--overlay-shadow)]"
				>
					<DropdownMenu.RadioGroup
						value={preference}
						onValueChange={(value) => setPreference(valid(value))}
					>
						{[
							{ value: "light", Icon: Sun, label: "Light" },
							{ value: "dark", Icon: Moon, label: "Dark" },
							{ value: "system", Icon: Monitor, label: "System" },
						].map(({ value, Icon, label }) => (
							<DropdownMenu.RadioItem
								key={value}
								value={value}
								className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-3 outline-none focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-1 select-none data-[highlighted]:bg-accent"
							>
								<Icon aria-hidden="true" className="size-4" />
								{label}
								<DropdownMenu.ItemIndicator className="ms-auto text-xs">
									✓
								</DropdownMenu.ItemIndicator>
							</DropdownMenu.RadioItem>
						))}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}
