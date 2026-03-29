function timestamp(): string {
  return new Date().toISOString();
}

function print(level: "INFO" | "WARN" | "ERROR", message: string, details?: string): void {
  const prefix = `[mom ${level} ${timestamp()}]`;
  if (details) {
    console.log(`${prefix} ${message}: ${details}`);
    return;
  }
  console.log(`${prefix} ${message}`);
}

export function logInfo(message: string, details?: string): void {
  print("INFO", message, details);
}

export function logWarning(message: string, details?: string): void {
  print("WARN", message, details);
}

export function logError(message: string, details?: string): void {
  print("ERROR", message, details);
}
