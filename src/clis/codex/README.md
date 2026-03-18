# OpenAI Codex Adapter for OpenCLI

Control the **OpenAI Codex Desktop App** headless or headfully via Chrome DevTools Protocol (CDP).
Because Codex is built on Electron, OpenCLI can directly drive its internal UI, automate slash commands, and manipulate its AI agent threads.

## Prerequisites

1. You must have the official OpenAI Codex app installed.
2. Launch it via the terminal and expose the remote debugging port:
   ```bash
   # macOS 
   /Applications/Codex.app/Contents/MacOS/Codex --remote-debugging-port=9222
   ```

## Setup

Export the CDP endpoint in your shell:
```bash
export OPENCLI_CODEX_CDP_ENDPOINT="http://127.0.0.1:9222"
```

## Commands

### Diagnostics
- `opencli codex status`: Checks connection and reads the current active window URL/title.
- `opencli codex dump`: Dumps the full UI DOM and Accessibility tree into `/tmp` (ideal for building AI automation tools on top of it).

### Agent Manipulation
- `opencli codex new`: Simulates `Cmd+N` to start a completely fresh and isolated Git Worktree thread context.
- `opencli codex send "message"`: Robustly finds the active Thread Composer and injects your text.
  - *Pro-tip*: You can trigger internal shortcuts by sending them, e.g., `opencli codex send "/review"` or `opencli codex send "$imagegen draw a cat"`.
- `opencli codex read`: Extracts the entire current thread history and AI reasoning logs into readable text.
- `opencli codex extract-diff`: Automatically scrapes any visual Patch chunks and Code Diffs the AI generated inside the review UI.
