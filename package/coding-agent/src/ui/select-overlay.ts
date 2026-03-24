import { Container, type Component, type OverlayHandle, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import type { SelectListTheme } from "@mariozechner/pi-tui";
import { uiColors } from "./theme.js";

class SelectOverlayComponent implements Component {
	private readonly container = new Container();
	private readonly list: SelectList;

	constructor(
		title: string,
		items: SelectItem[],
		theme: SelectListTheme,
		onDone: (item: SelectItem | null) => void,
	) {
		this.container.addChild(new Text(uiColors.header(title), 1, 0));
		this.container.addChild(new Text(uiColors.muted("↑↓ navigate • enter select • esc cancel"), 1, 0));
		this.list = new SelectList(items, Math.min(Math.max(items.length, 3), 12), theme);
		this.list.onSelect = (item) => onDone(item);
		this.list.onCancel = () => onDone(null);
		this.container.addChild(this.list);
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	handleInput(data: string): void {
		this.list.handleInput?.(data);
	}

	invalidate(): void {
		this.container.invalidate();
	}
}

export async function showSelectOverlay(input: {
	tui: import("@mariozechner/pi-tui").TUI;
	title: string;
	items: SelectItem[];
	theme: SelectListTheme;
}): Promise<SelectItem | null> {
	return new Promise<SelectItem | null>((resolve) => {
		let handle: OverlayHandle | undefined;
		const component = new SelectOverlayComponent(input.title, input.items, input.theme, (item) => {
			handle?.hide();
			resolve(item);
		});
		handle = input.tui.showOverlay(component, {
			width: "80%",
			minWidth: 50,
			maxHeight: "60%",
			anchor: "center",
		});
	});
}
