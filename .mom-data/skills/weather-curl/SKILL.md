---
name: weather-curl
description: Use curl against wttr.in to query weather, then summarize the result for the user.
---

# Weather via curl

Use this skill when the user asks about weather and network access from the sandbox is available.

This is a documentation-only skill. No helper script is required.

## Preferred usage

Run `curl` directly with the `bash` tool from the workspace root.

### Current weather

```bash
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=3'
```

### Forecast / tomorrow

```bash
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=j1'
```

## Guidance

- If the user asks `杭州天气` or `杭州明天天气`, map it to `Hangzhou`.
- For a quick current answer, prefer `format=3`.
- For tomorrow's forecast, use `format=j1`, extract the useful parts, then summarize them in natural language.
- Try this skill before saying you cannot access the internet.
- Do not dump raw JSON unless the user explicitly asks for it.
- After you get the result, answer directly with a concise weather summary.

## Examples

```bash
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=3'
curl -fsSL --max-time 20 'https://wttr.in/Hangzhou?format=j1'
```
