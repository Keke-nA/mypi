export const DEFAULT_MAX_BYTES = 50 * 1024;
export const DEFAULT_MAX_LINES = 2000;

export interface TruncationResult {
  content: string;
  truncated: boolean;
  totalLines: number;
  outputLines: number;
  outputBytes: number;
  truncatedBy?: "lines" | "bytes";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes}B`;
  }
  return `${(bytes / 1024).toFixed(1)}KB`;
}

export function truncateHead(text: string): TruncationResult {
  const lines = text.split("\n");
  let selected = lines.slice(0, DEFAULT_MAX_LINES).join("\n");
  let truncated = lines.length > DEFAULT_MAX_LINES;
  let truncatedBy: "lines" | "bytes" | undefined = truncated ? "lines" : undefined;

  while (Buffer.byteLength(selected, "utf8") > DEFAULT_MAX_BYTES && selected.length > 0) {
    const nextLength = Math.max(0, Math.floor(selected.length * 0.9));
    selected = selected.slice(0, nextLength);
    truncated = true;
    truncatedBy = "bytes";
  }

  const outputLines = selected.length === 0 ? 0 : selected.split("\n").length;
  return {
    content: selected,
    truncated,
    totalLines: lines.length,
    outputLines,
    outputBytes: Buffer.byteLength(selected, "utf8"),
    ...(truncatedBy === undefined ? {} : { truncatedBy }),
  };
}

export function truncateTail(text: string): TruncationResult {
  const lines = text.split("\n");
  let selectedLines = lines.slice(-DEFAULT_MAX_LINES);
  let selected = selectedLines.join("\n");
  let truncated = lines.length > DEFAULT_MAX_LINES;
  let truncatedBy: "lines" | "bytes" | undefined = truncated ? "lines" : undefined;

  while (Buffer.byteLength(selected, "utf8") > DEFAULT_MAX_BYTES && selectedLines.length > 0) {
    selectedLines = selectedLines.slice(Math.max(1, Math.floor(selectedLines.length * 0.1)));
    selected = selectedLines.join("\n");
    truncated = true;
    truncatedBy = "bytes";
  }

  return {
    content: selected,
    truncated,
    totalLines: lines.length,
    outputLines: selectedLines.length,
    outputBytes: Buffer.byteLength(selected, "utf8"),
    ...(truncatedBy === undefined ? {} : { truncatedBy }),
  };
}
