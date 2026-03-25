import { Input, type Component, type Focusable, type OverlayHandle, type TUI, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SessionInfo } from "../core/session-types.js";
import { uiColors } from "./theme.js";

const OVERLAY_MAX_HEIGHT_PERCENT = 88;

type SessionScope = "project" | "all";

export interface SessionSelectorOverlayData {
	project: SessionInfo[];
	all: SessionInfo[];
}

export interface SessionSelectorOverlayResult {
	path: string;
}

export interface ShowSessionSelectorOverlayInput {
	tui: TUI;
	title?: string;
	initialScope?: SessionScope;
	loadData: () => Promise<SessionSelectorOverlayData>;
	deleteSession?: (sessionPath: string) => Promise<void>;
	getCurrentSessionPath?: () => string | undefined;
}

interface SessionSelectorRow {
	item: SessionInfo;
	label: string;
	description: string;
	searchText: string;
}

function collapseWhitespace(text: string | null | undefined): string {
	return (text ?? "").replace(/[\r\n\t ]+/g, " ").trim();
}

function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function matchesSessionFilter(item: SessionInfo, filter: string): boolean {
	if (!filter) return true;
	const haystack = [
		item.path,
		item.cwd,
		item.id,
		item.name,
		item.firstMessage,
		item.allMessagesText,
	].filter(Boolean).join(" ").toLowerCase();
	return haystack.includes(filter);
}

function toRow(item: SessionInfo, scope: SessionScope, currentSessionPath: string | undefined): SessionSelectorRow {
	const summary = collapseWhitespace(item.name ?? item.firstMessage ?? "(unnamed)");
	const labelPrefix = currentSessionPath === item.path ? "● " : "  ";
	return {
		item,
		label: `${labelPrefix}${shorten(summary || "(unnamed)", 72)}`,
		description:
			scope === "all"
				? `${item.modified} • ${item.messageCount} messages • ${shorten(item.cwd, 52)}`
				: `${item.modified} • ${item.messageCount} messages • ${shorten(item.path, 52)}`,
		searchText: [item.path, item.cwd, item.id, item.name, item.firstMessage, item.allMessagesText].filter(Boolean).join(" ").toLowerCase(),
	};
}

class SessionSelectorOverlayComponent implements Component, Focusable {
	private readonly searchInput = new Input();
	private focusedState = false;
	private scope: SessionScope;
	private selectedIndices: Record<SessionScope, number> = { project: 0, all: 0 };
	private data: SessionSelectorOverlayData = { project: [], all: [] };
	private loading = true;
	private deleting = false;
	private errorMessage: string | null = null;
	private deleteConfirmPath: string | null = null;

	constructor(
		private readonly input: ShowSessionSelectorOverlayInput,
		private readonly handle: () => OverlayHandle | undefined,
		private readonly done: (result: SessionSelectorOverlayResult | null) => void,
	) {
		this.scope = input.initialScope ?? "project";
		void this.reload();
	}

	get focused(): boolean {
		return this.focusedState;
	}

	set focused(value: boolean) {
		this.focusedState = value;
		this.searchInput.focused = value;
	}

	handleInput(data: string): void {
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.done(null);
			return;
		}
		if (this.loading || this.deleting) {
			return;
		}
		if (matchesKey(data, "tab")) {
			this.scope = this.scope === "project" ? "all" : "project";
			this.deleteConfirmPath = null;
			this.errorMessage = null;
			return;
		}
		if (matchesKey(data, "enter")) {
			const row = this.getSelectedRow();
			if (row) {
				this.done({ path: row.item.path });
			}
			return;
		}
		if (matchesKey(data, "delete")) {
			void this.handleDelete();
			return;
		}
		if (matchesKey(data, "up")) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, "down")) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, "home")) {
			this.selectedIndices[this.scope] = 0;
			this.deleteConfirmPath = null;
			return;
		}
		if (matchesKey(data, "end")) {
			this.selectedIndices[this.scope] = Math.max(0, this.getRows().length - 1);
			this.deleteConfirmPath = null;
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.selectedIndices[this.scope] = Math.max(0, this.selectedIndices[this.scope] - this.pageStep());
			this.deleteConfirmPath = null;
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.selectedIndices[this.scope] = Math.min(Math.max(0, this.getRows().length - 1), this.selectedIndices[this.scope] + this.pageStep());
			this.deleteConfirmPath = null;
			return;
		}

		const previousFilter = this.searchInput.getValue();
		const preferredPath = this.getSelectedRow()?.item.path;
		this.searchInput.handleInput(data);
		if (previousFilter !== this.searchInput.getValue()) {
			this.syncSelection(preferredPath);
			this.deleteConfirmPath = null;
			this.errorMessage = null;
		}
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}

	render(width: number): string[] {
		const bodyWidth = Math.max(24, width);
		const overlayHeight = Math.max(14, Math.floor(this.input.tui.terminal.rows * (OVERLAY_MAX_HEIGHT_PERCENT / 100)) - 2);
		const rows = this.getRows();
		this.ensureSelectionInRange(rows);
		const divider = uiColors.panelBorder("─".repeat(bodyWidth));
		const headerLines = 7;
		const footerLines = 4;
		const bodyHeight = Math.max(4, overlayHeight - headerLines - footerLines);
		const startIndex = Math.max(0, Math.min(this.selectedIndices[this.scope] - Math.floor(bodyHeight / 2), Math.max(0, rows.length - bodyHeight)));
		const visibleRows = rows.slice(startIndex, startIndex + bodyHeight);
		const lines: string[] = [
			divider,
			this.pad(truncateToWidth(uiColors.header(this.input.title ?? "Resume Session"), bodyWidth, ""), bodyWidth),
			this.pad(truncateToWidth(this.renderTabs(), bodyWidth, ""), bodyWidth),
			this.pad(truncateToWidth(uiColors.muted("↑/↓ move • tab switch scope • enter choose • delete remove • esc cancel"), bodyWidth, ""), bodyWidth),
			this.pad(truncateToWidth(uiColors.muted("Type to search:"), bodyWidth, ""), bodyWidth),
			...this.searchInput.render(bodyWidth).map((line) => this.pad(truncateToWidth(line, bodyWidth, ""), bodyWidth)),
			divider,
		];

		if (this.loading) {
			lines.push(this.pad(truncateToWidth(uiColors.notice("Loading sessions..."), bodyWidth, ""), bodyWidth));
		} else if (visibleRows.length === 0) {
			lines.push(this.pad(truncateToWidth(uiColors.notice("No matching sessions."), bodyWidth, ""), bodyWidth));
		} else {
			for (let index = 0; index < visibleRows.length; index++) {
				lines.push(this.renderRow(visibleRows[index]!, bodyWidth, startIndex + index === this.selectedIndices[this.scope]));
			}
		}

		while (lines.length < headerLines + bodyHeight) {
			lines.push(" ".repeat(bodyWidth));
		}

		lines.push(divider);
		lines.push(this.pad(truncateToWidth(this.renderFooter(rows.length), bodyWidth, ""), bodyWidth));
		if (this.errorMessage) {
			lines.push(this.pad(truncateToWidth(uiColors.error(this.errorMessage), bodyWidth, ""), bodyWidth));
		} else if (this.deleteConfirmPath) {
			lines.push(this.pad(truncateToWidth(uiColors.notice("Press delete again to confirm removal."), bodyWidth, ""), bodyWidth));
		} else {
			lines.push(this.pad(truncateToWidth(uiColors.muted("Project/All tabs use the same search input."), bodyWidth, ""), bodyWidth));
		}
		lines.push(divider);
		return lines;
	}

	private async reload(): Promise<void> {
		this.loading = true;
		this.errorMessage = null;
		this.input.tui.requestRender();
		try {
			this.data = await this.input.loadData();
			this.syncSelection(this.getCurrentSessionPath());
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.loading = false;
			this.input.tui.requestRender();
		}
	}

	private getCurrentSessionPath(): string | undefined {
		return this.input.getCurrentSessionPath?.();
	}

	private getActiveItems(): SessionInfo[] {
		return this.data[this.scope];
	}

	private getRows(): SessionSelectorRow[] {
		const filter = this.searchInput.getValue().trim().toLowerCase();
		const currentPath = this.getCurrentSessionPath();
		return this.getActiveItems()
			.filter((item) => matchesSessionFilter(item, filter))
			.map((item) => toRow(item, this.scope, currentPath));
	}

	private getSelectedRow(): SessionSelectorRow | undefined {
		const rows = this.getRows();
		this.ensureSelectionInRange(rows);
		return rows[this.selectedIndices[this.scope]];
	}

	private ensureSelectionInRange(rows: SessionSelectorRow[]): void {
		if (rows.length === 0) {
			this.selectedIndices[this.scope] = 0;
			return;
		}
		this.selectedIndices[this.scope] = Math.max(0, Math.min(this.selectedIndices[this.scope], rows.length - 1));
	}

	private syncSelection(preferredPath: string | undefined): void {
		const rows = this.getRows();
		if (preferredPath) {
			const preferredIndex = rows.findIndex((row) => row.item.path === preferredPath);
			if (preferredIndex >= 0) {
				this.selectedIndices[this.scope] = preferredIndex;
				return;
			}
		}
		this.ensureSelectionInRange(rows);
	}

	private moveSelection(delta: number): void {
		const rows = this.getRows();
		if (rows.length === 0) return;
		const nextIndex = this.selectedIndices[this.scope] + delta;
		if (nextIndex < 0) {
			this.selectedIndices[this.scope] = rows.length - 1;
		} else if (nextIndex >= rows.length) {
			this.selectedIndices[this.scope] = 0;
		} else {
			this.selectedIndices[this.scope] = nextIndex;
		}
		this.deleteConfirmPath = null;
	}

	private async handleDelete(): Promise<void> {
		if (!this.input.deleteSession) {
			this.errorMessage = "Delete is not available here.";
			this.input.tui.requestRender();
			return;
		}
		const row = this.getSelectedRow();
		if (!row) {
			return;
		}
		if (this.deleteConfirmPath !== row.item.path) {
			this.deleteConfirmPath = row.item.path;
			this.errorMessage = null;
			this.input.tui.requestRender();
			return;
		}
		this.deleting = true;
		this.errorMessage = null;
		this.input.tui.requestRender();
		try {
			await this.input.deleteSession(row.item.path);
			this.deleteConfirmPath = null;
			await this.reload();
		} catch (error) {
			this.errorMessage = error instanceof Error ? error.message : String(error);
		} finally {
			this.deleting = false;
			this.input.tui.requestRender();
		}
	}

	private pageStep(): number {
		return Math.max(6, Math.floor(this.input.tui.terminal.rows / 3));
	}

	private renderTabs(): string {
		const projectText = ` Project ${this.data.project.length} `;
		const allText = ` All ${this.data.all.length} `;
		const projectTab = this.scope === "project" ? uiColors.selection(projectText) : uiColors.subtle(projectText);
		const allTab = this.scope === "all" ? uiColors.selection(allText) : uiColors.subtle(allText);
		return `${projectTab}  ${allTab}`;
	}

	private renderRow(row: SessionSelectorRow, width: number, isSelected: boolean): string {
		const primary = row.label;
		const spacing = "  ";
		const availableDescription = Math.max(12, width - visibleWidth(primary) - visibleWidth(spacing));
		const text = `${truncateToWidth(primary, width, "")}${spacing}${truncateToWidth(row.description, availableDescription, "")}`;
		const padded = this.pad(truncateToWidth(text, width, ""), width);
		if (isSelected) {
			return uiColors.selection(padded);
		}
		return padded;
	}

	private renderFooter(totalRows: number): string {
		const selected = this.getSelectedRow();
		const current = this.getCurrentSessionPath();
		return [
			`${uiColors.accent("scope")} ${this.scope}`,
			`${uiColors.accent("rows")} ${totalRows}`,
			`${uiColors.accent("current")} ${current ? shorten(current, 30) : "(none)"}`,
			`${uiColors.accent("selected")} ${selected ? shorten(selected.item.path, 30) : "(none)"}`,
		].join("   ");
	}

	private pad(text: string, width: number): string {
		const currentWidth = visibleWidth(text);
		if (currentWidth >= width) {
			return truncateToWidth(text, width, "");
		}
		return text + " ".repeat(width - currentWidth);
	}
}

export async function showSessionSelectorOverlay(input: ShowSessionSelectorOverlayInput): Promise<SessionSelectorOverlayResult | null> {
	return new Promise<SessionSelectorOverlayResult | null>((resolve) => {
		let handle: OverlayHandle | undefined;
		const component = new SessionSelectorOverlayComponent(input, () => handle, (result) => {
			handle?.hide();
			resolve(result);
		});
		handle = input.tui.showOverlay(component, {
			width: "94%",
			maxHeight: `${OVERLAY_MAX_HEIGHT_PERCENT}%`,
			anchor: "center",
			margin: 1,
		});
	});
}
