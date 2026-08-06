type ClassValue = string | false | null | undefined | Record<string, boolean | undefined>;

export function cn(...inputs: ClassValue[]) {
	const classes: string[] = [];
	for (const input of inputs) {
		if (!input) continue;
		if (typeof input === "string") {
			classes.push(input);
			continue;
		}
		for (const [key, on] of Object.entries(input)) {
			if (on) classes.push(key);
		}
	}
	return classes.join(" ");
}
