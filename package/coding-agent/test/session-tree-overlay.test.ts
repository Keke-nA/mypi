import { describe, expect, it } from "vitest";
import type { SessionEntry, SessionTreeNode } from "../src/core/session-types.js";
import { flattenSessionTree, formatTreeBranchPrefix } from "../src/ui/session-tree-overlay.js";

function createMessageEntry(
	id: string,
	parentId: string | null,
	role: "user" | "assistant",
	text: string,
): Extract<SessionEntry, { type: "message" }> {
	return {
		type: "message",
		id,
		parentId,
		timestamp: "2026-03-26T00:00:00.000Z",
		message: role === "user"
			? {
				role: "user",
				content: [{ type: "text", text }],
				timestamp: Date.now(),
			}
			: {
				role: "assistant",
				content: [{ type: "text", text }],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-5.4",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
			},
		};
}

function createNode(entry: SessionEntry | null, children: SessionTreeNode[] = [], isLeaf = false): SessionTreeNode {
	return {
		entryId: entry?.id ?? null,
		entry,
		label: null,
		children,
		isLeaf,
	};
}

describe("session tree overlay helpers", () => {
	it("renders prefixes only at actual branch points", () => {
		const endNode = createNode(createMessageEntry("e1", "d1", "assistant", "end"), [], true);
		const deepNode = createNode(createMessageEntry("d1", "c1", "assistant", "deep"), [endNode]);
		const mainBranch = createNode(createMessageEntry("c1", "b1", "assistant", "main"), [deepNode]);
		const sideLeaf = createNode(createMessageEntry("g1", "f1", "assistant", "side end"));
		const sideStart = createNode(createMessageEntry("f1", "b1", "user", "side"), [sideLeaf]);
		const splitPoint = createNode(createMessageEntry("b1", "a1", "assistant", "split"), [mainBranch, sideStart]);
		const startNode = createNode(createMessageEntry("a1", null, "user", "hello"), [splitPoint]);
		const root = createNode(null, [startNode]);

		const rows = flattenSessionTree(root);
		expect(rows.map((row) => formatTreeBranchPrefix(row))).toEqual(["", "", "", "├─ ", "│  ", "│  ", "└─ ", "   "]);
	});

	it("keeps ancestor path when filtering a deep branch", () => {
		const targetLeaf = createNode(createMessageEntry("a1", "u1", "assistant", "reply target"), [], true);
		const splitLeaf = createNode(createMessageEntry("u2", "u1", "user", "other branch"));
		const firstUser = createNode(createMessageEntry("u1", null, "user", "hello"), [targetLeaf, splitLeaf]);
		const root = createNode(null, [firstUser]);

		const rows = flattenSessionTree(root, { filter: "target" });
		expect(rows.map((row) => row.targetId)).toEqual([null, "u1", "a1"]);
		expect(rows.map((row) => formatTreeBranchPrefix(row))).toEqual(["", "", ""]);
	});

	it("honors collapsed subtrees when no filter is active", () => {
		const assistantNode = createNode(createMessageEntry("a1", "u1", "assistant", "reply"), [], true);
		const siblingNode = createNode(createMessageEntry("u2", "u1", "user", "other branch"));
		const firstUser = createNode(createMessageEntry("u1", null, "user", "hello"), [assistantNode, siblingNode]);
		const root = createNode(null, [firstUser]);

		const rows = flattenSessionTree(root, { collapsedIds: new Set(["u1"]) });
		expect(rows.map((row) => row.targetId)).toEqual([null, "u1"]);
	});
});
