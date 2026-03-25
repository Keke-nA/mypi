import { Input, type Component, type Focusable, type TUI, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import type { SessionEntry, SessionTreeNode } from "../core/session-types.js";
import { messageToText } from "../core/messages.js";
import { uiColors } from "./theme.js";

const OVERLAY_MAX_HEIGHT_PERCENT = 88;
const ROOT_COLLAPSE_ID = "__root__";

export interface SessionTreeOverlayResult {
	targetId: string | null;
	summarize: boolean;
}

export interface SessionTreeRow {
	node: SessionTreeNode;
	targetId: string | null;
	parentId: string | null;
	branchPath: boolean[];
	isBranchEntry: boolean;
	visibleChildCount: number;
	hasChildren: boolean;
	expanded: boolean;
	label: string;
	searchText: string;
}

export function formatTreeBranchPrefix(row: Pick<SessionTreeRow, "branchPath" | "isBranchEntry">): string {
	if (row.branchPath.length === 0) {
		return "";
	}
	if (row.isBranchEntry) {
		const ancestors = row.branchPath.slice(0, -1).map((hasNext) => (hasNext ? "│  " : "   ")).join("");
		const connector = row.branchPath[row.branchPath.length - 1] ? "├─ " : "└─ ";
		return `${ancestors}${connector}`;
	}
	return row.branchPath.map((hasNext) => (hasNext ? "│  " : "   ")).join("");
}

export function describeTreeNode(node: SessionTreeNode): { label: string; searchText: string } {
	if (!node.entry) {
		return {
			label: "root",
			searchText: "root session start beginning",
		};
	}

	const labelPrefix = node.label ? `[${node.label}] ` : "";
	switch (node.entry.type) {
		case "message": {
			const text = collapseWhitespace(messageToText(node.entry.message));
			return {
				label: `${labelPrefix}${node.entry.message.role}: ${shorten(text, 96)}`,
				searchText: [node.entry.id, node.entry.timestamp, node.entry.message.role, node.label, text].filter(Boolean).join(" ").toLowerCase(),
			};
		}
		case "branch_summary":
			return {
				label: `${labelPrefix}branch_summary: ${shorten(collapseWhitespace(node.entry.summary), 96)}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.summary, "branch_summary"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "compaction":
			return {
				label: `${labelPrefix}compaction: ${shorten(collapseWhitespace(node.entry.summary), 96)}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.summary, "compaction"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "model_change":
			return {
				label: `${labelPrefix}model → ${node.entry.model.modelId}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.model.provider, node.entry.model.modelId, "model_change"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "thinking_level_change":
			return {
				label: `${labelPrefix}thinking → ${node.entry.level}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.level, "thinking_level_change"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "session_info":
			return {
				label: `${labelPrefix}session → ${node.entry.name ?? "(cleared)"}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.name, "session_info"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "label":
			return {
				label: `${labelPrefix}label → ${node.entry.label ?? "(cleared)"}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.label, "label"].filter(Boolean).join(" ").toLowerCase(),
			};
		case "custom_message": {
			const text = collapseWhitespace(messageToText(node.entry.message));
			return {
				label: `${labelPrefix}custom: ${shorten(text, 96)}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, text, "custom_message"].filter(Boolean).join(" ").toLowerCase(),
			};
		}
		case "custom":
			return {
				label: `${labelPrefix}custom: ${node.entry.name}`,
				searchText: [node.entry.id, node.entry.timestamp, node.label, node.entry.name, "custom"].filter(Boolean).join(" ").toLowerCase(),
			};
	}
}

export function flattenSessionTree(
	root: SessionTreeNode,
	options: { filter?: string; collapsedIds?: ReadonlySet<string> } = {},
): SessionTreeRow[] {
	const rows: SessionTreeRow[] = [];
	const filter = (options.filter ?? "").trim().toLowerCase();
	const collapsedIds = options.collapsedIds ?? new Set<string>();

	const includesNode = (node: SessionTreeNode): boolean => {
		if (!filter) {
			return true;
		}
		const description = describeTreeNode(node);
		if (description.searchText.includes(filter)) {
			return true;
		}
		return node.children.some((child) => includesNode(child));
	};

	const visit = (
		node: SessionTreeNode,
		branchPath: boolean[],
		isBranchEntry: boolean,
	): void => {
		if (!includesNode(node)) {
			return;
		}
		const description = describeTreeNode(node);
		const collapseId = node.entryId ?? ROOT_COLLAPSE_ID;
		const hasChildren = node.children.length > 0;
		const includedChildren = node.children.filter((child) => includesNode(child));
		const visibleChildCount = includedChildren.length;
		const expanded = node.entryId === null || filter.length > 0 || !collapsedIds.has(collapseId);
		rows.push({
			node,
			targetId: node.entryId,
			parentId: node.entry?.parentId ?? null,
			branchPath,
			isBranchEntry,
			visibleChildCount,
			hasChildren,
			expanded,
			label: description.label,
			searchText: description.searchText,
		});
		if (!expanded) {
			return;
		}
		const currentIsBranchPoint = includedChildren.length > 1;
		includedChildren.forEach((child, index) => {
			const isLastChild = index === includedChildren.length - 1;
			const childBranchPath = currentIsBranchPoint
				? [...branchPath, !isLastChild]
				: branchPath;
			visit(child, childBranchPath, currentIsBranchPoint);
		});
	};

	visit(root, [], false);
	return rows;
}

class SessionTreeOverlayComponent implements Component, Focusable {
	private readonly searchInput = new Input();
	private readonly collapsedIds = new Set<string>();
	private selectedIndex = 0;
	private summarize = false;
	private _focused = false;

	get focused(): boolean {
		return this._focused;
	}

	set focused(value: boolean) {
		this._focused = value;
		this.searchInput.focused = value;
	}

	constructor(
		private readonly tui: TUI,
		private readonly tree: SessionTreeNode,
		private readonly onDone: (result: SessionTreeOverlayResult | null) => void,
	) {
		this.selectedIndex = this.findInitialSelection();
	}

	handleInput(data: string): void {
		const rows = this.getRows();
		if (matchesKey(data, "escape") || matchesKey(data, "ctrl+c")) {
			this.onDone(null);
			return;
		}
		if (matchesKey(data, "enter")) {
			const row = rows[this.selectedIndex];
			if (!row) {
				this.onDone(null);
				return;
			}
			this.onDone({ targetId: row.targetId, summarize: this.summarize });
			return;
		}
		if (matchesKey(data, "tab")) {
			this.summarize = !this.summarize;
			return;
		}
		if (matchesKey(data, "home")) {
			this.selectedIndex = 0;
			return;
		}
		if (matchesKey(data, "end")) {
			this.selectedIndex = Math.max(0, rows.length - 1);
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.selectedIndex = Math.max(0, this.selectedIndex - this.pageStep());
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.selectedIndex = Math.min(Math.max(0, rows.length - 1), this.selectedIndex + this.pageStep());
			return;
		}
		if (matchesKey(data, "up")) {
			this.selectedIndex = this.selectedIndex === 0 ? Math.max(0, rows.length - 1) : this.selectedIndex - 1;
			return;
		}
		if (matchesKey(data, "down")) {
			this.selectedIndex = this.selectedIndex >= rows.length - 1 ? 0 : this.selectedIndex + 1;
			return;
		}
		if (matchesKey(data, "left")) {
			this.handleLeft(rows);
			return;
		}
		if (matchesKey(data, "right")) {
			this.handleRight(rows);
			return;
		}

		const before = this.searchInput.getValue();
		const previousTargetId = rows[this.selectedIndex]?.targetId ?? null;
		this.searchInput.handleInput(data);
		if (before !== this.searchInput.getValue()) {
			this.syncSelection(previousTargetId);
		}
	}

	invalidate(): void {
		this.searchInput.invalidate();
	}

	render(width: number): string[] {
		const bodyWidth = Math.max(20, width);
		const rows = this.getRows();
		this.ensureSelectionInRange(rows);
		const overlayHeight = this.overlayHeight();
		const headerLines = 6;
		const footerLines = 3;
		const bodyHeight = Math.max(4, overlayHeight - headerLines - footerLines);
		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(bodyHeight / 2), Math.max(0, rows.length - bodyHeight)));
		const visibleRows = rows.slice(startIndex, startIndex + bodyHeight);
		const divider = uiColors.panelBorder("─".repeat(bodyWidth));
		const lines: string[] = [
			divider,
			this.pad(truncateToWidth(uiColors.header("Session Tree"), bodyWidth, ""), bodyWidth),
			this.pad(
				truncateToWidth(
					uiColors.muted("↑/↓ move • ←/→ fold/branch • enter navigate • tab summary • type to search • esc cancel"),
					bodyWidth,
					"",
				),
				bodyWidth,
			),
			this.pad(truncateToWidth(uiColors.muted("Type to search:"), bodyWidth, ""), bodyWidth),
			...this.searchInput.render(bodyWidth).map((line) => this.pad(truncateToWidth(line, bodyWidth, ""), bodyWidth)),
			divider,
		];

		if (visibleRows.length === 0) {
			lines.push(this.pad(truncateToWidth(uiColors.notice("No matching tree nodes."), bodyWidth, ""), bodyWidth));
		} else {
			for (let index = 0; index < visibleRows.length; index++) {
				const absoluteIndex = startIndex + index;
				lines.push(this.renderRow(visibleRows[index]!, bodyWidth, absoluteIndex === this.selectedIndex));
			}
		}

		while (lines.length < headerLines + bodyHeight) {
			lines.push(" ".repeat(bodyWidth));
		}

		const selected = rows[this.selectedIndex];
		lines.push(divider);
		lines.push(this.pad(truncateToWidth(this.renderFooterSummary(selected, rows.length), bodyWidth, ""), bodyWidth));
		lines.push(this.pad(truncateToWidth(this.renderFooterMeta(selected, rows.length, startIndex, visibleRows.length), bodyWidth, ""), bodyWidth));
		lines.push(divider);
		return lines;
	}

	private getRows(): SessionTreeRow[] {
		return flattenSessionTree(this.tree, {
			filter: this.searchInput.getValue(),
			collapsedIds: this.collapsedIds,
		});
	}

	private findInitialSelection(): number {
		const rows = this.getRows();
		const leafIndex = rows.findIndex((row) => row.node.isLeaf);
		return leafIndex >= 0 ? leafIndex : 0;
	}

	private syncSelection(preferredTargetId: string | null): void {
		const rows = this.getRows();
		const preferredIndex = rows.findIndex((row) => row.targetId === preferredTargetId);
		if (preferredIndex >= 0) {
			this.selectedIndex = preferredIndex;
			return;
		}
		const leafIndex = rows.findIndex((row) => row.node.isLeaf);
		this.selectedIndex = leafIndex >= 0 ? leafIndex : 0;
	}

	private ensureSelectionInRange(rows: SessionTreeRow[]): void {
		if (rows.length === 0) {
			this.selectedIndex = 0;
			return;
		}
		this.selectedIndex = Math.max(0, Math.min(this.selectedIndex, rows.length - 1));
	}

	private handleLeft(rows: SessionTreeRow[]): void {
		const row = rows[this.selectedIndex];
		if (!row) return;
		if (row.hasChildren && row.expanded && row.targetId !== null) {
			this.collapsedIds.add(row.targetId);
			return;
		}
		const parentIndex = rows.findIndex((candidate) => candidate.targetId === row.parentId);
		if (parentIndex >= 0) {
			this.selectedIndex = parentIndex;
		}
	}

	private handleRight(rows: SessionTreeRow[]): void {
		const row = rows[this.selectedIndex];
		if (!row || !row.hasChildren) return;
		const collapseId = row.targetId ?? ROOT_COLLAPSE_ID;
		if (!row.expanded) {
			this.collapsedIds.delete(collapseId);
			return;
		}
		const childIndex = rows.findIndex((candidate) => candidate.parentId === row.targetId);
		if (childIndex >= 0) {
			this.selectedIndex = childIndex;
		}
	}

	private pageStep(): number {
		return Math.max(6, Math.floor(this.overlayHeight() / 3));
	}

	private overlayHeight(): number {
		return Math.max(14, Math.floor(this.tui.terminal.rows * (OVERLAY_MAX_HEIGHT_PERCENT / 100)) - 2);
	}

	private renderRow(row: SessionTreeRow, width: number, isSelected: boolean): string {
		const branchPrefix = formatTreeBranchPrefix(row);
		const expander = row.visibleChildCount > 1
			? row.expanded ? "▾ " : "▸ "
			: row.hasChildren ? "  " : "• ";
		const leafMarker = row.node.isLeaf ? "● " : "  ";
		const plainText = `${branchPrefix}${expander}${leafMarker}${row.label}`;
		const truncatedPlain = truncateToWidth(plainText, width, "");
		const paddedPlain = this.pad(truncatedPlain, width);
		if (isSelected) {
			return uiColors.selection(paddedPlain);
		}

		const prefixWidth = visibleWidth(branchPrefix + expander + leafMarker);
		const labelWidth = Math.max(0, width - prefixWidth);
		const styledPrefix = uiColors.muted(branchPrefix) + (row.visibleChildCount > 1 ? uiColors.accent(expander) : uiColors.subtle(expander)) + (row.node.isLeaf ? uiColors.current(leafMarker) : leafMarker);
		const styledLabel = this.styleLabel(row.node.entry, truncateToWidth(row.label, labelWidth, ""));
		return this.pad(styledPrefix + styledLabel, width);
	}

	private styleLabel(entry: SessionEntry | null, text: string): string {
		if (!entry) {
			return uiColors.bold(text);
		}
		if (entry.type === "message") {
			if (entry.message.role === "user") return uiColors.user(text);
			if (entry.message.role === "assistant") return uiColors.assistant(text);
			return uiColors.tool(text);
		}
		if (entry.type === "branch_summary" || entry.type === "compaction") {
			return uiColors.notice(text);
		}
		if (entry.type === "model_change" || entry.type === "thinking_level_change") {
			return uiColors.accent(text);
		}
		return uiColors.subtle(text);
	}

	private renderFooterSummary(selected: SessionTreeRow | undefined, totalRows: number): string {
		const targetLabel = selected ? `${selected.targetId ?? "root"}` : "(none)";
		return [
			`${uiColors.accent("action")} ${this.summarize ? "navigate + summary" : "navigate"}`,
			`${uiColors.accent("selected")} ${shorten(targetLabel, 24)}`,
			`${uiColors.accent("rows")} ${totalRows}`,
		].join("   ");
	}

	private renderFooterMeta(selected: SessionTreeRow | undefined, totalRows: number, startIndex: number, visibleCount: number): string {
		const position = totalRows === 0 ? "0/0" : `${this.selectedIndex + 1}/${totalRows}`;
		const selectedLabel = selected ? selected.label : "(none)";
		return [
			`${uiColors.muted(position)}`,
			uiColors.muted(`window ${startIndex + 1}-${startIndex + visibleCount}`),
			uiColors.muted(shorten(selectedLabel, 80)),
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

function collapseWhitespace(text: string): string {
	return text.replace(/[\r\n\t ]+/g, " ").trim();
}

function shorten(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function showSessionTreeOverlay(input: {
	tui: TUI;
	tree: SessionTreeNode;
}): Promise<SessionTreeOverlayResult | null> {
	return new Promise<SessionTreeOverlayResult | null>((resolve) => {
		let handle: import("@mariozechner/pi-tui").OverlayHandle | undefined;
		const component = new SessionTreeOverlayComponent(input.tui, input.tree, (result) => {
			handle?.hide();
			resolve(result);
		});
		handle = input.tui.showOverlay(component, {
			width: "96%",
			maxHeight: `${OVERLAY_MAX_HEIGHT_PERCENT}%`,
			anchor: "center",
			margin: 1,
		});
	});
}
