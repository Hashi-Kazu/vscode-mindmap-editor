"""
AI Coder script: reads an Issue via env vars, sends the repo context to Claude,
and writes back any file modifications Claude proposes.
"""

import json
import os
import re
import sys
from pathlib import Path

import anthropic

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
MODEL = "claude-sonnet-4-6"
REPO_ROOT = Path(__file__).parent.parent

INCLUDE_EXTENSIONS = {
    ".ts", ".js", ".css", ".html",
    ".json", ".md", ".yml", ".yaml", ".py",
}
EXCLUDE_DIRS = {"node_modules", ".git", "dist", ".vscode"}
EXCLUDE_FILES = {"package-lock.json"}


def collect_source_files() -> dict[str, str]:
    """Return {relative_path: content} for all tracked source files."""
    files: dict[str, str] = {}
    for path in sorted(REPO_ROOT.rglob("*")):
        if path.is_dir():
            continue
        if any(part in EXCLUDE_DIRS for part in path.parts):
            continue
        if path.suffix not in INCLUDE_EXTENSIONS:
            continue
        if path.name in EXCLUDE_FILES:
            continue
        rel = path.relative_to(REPO_ROOT).as_posix()
        try:
            files[rel] = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            pass
    return files


def build_prompt(issue_number: str, issue_title: str, issue_body: str,
                 source_files: dict[str, str]) -> str:
    file_listing = "\n".join(
        f"### {path}\n```\n{content}\n```"
        for path, content in source_files.items()
    )
    return f"""You are an expert VS Code extension developer working on a Markdown Mind Map Editor
extension built with TypeScript and esbuild.

## Issue #{issue_number}: {issue_title}

{issue_body or "(no description provided)"}

## Repository source files

{file_listing}

## Task

Analyze the issue and propose the minimal code changes needed to implement or fix it.

Respond with a JSON object in the following format — **output only valid JSON, no markdown fences**:

{{
  "summary": "Brief description of what you changed and why",
  "files": [
    {{
      "path": "relative/path/from/repo/root",
      "content": "full updated file content as a string"
    }}
  ]
}}

Rules:
- Only include files you actually modified.
- Preserve all existing functionality unless the issue explicitly asks to remove it.
- Do not add unnecessary comments or change unrelated code.
- Paths must be relative to the repository root (e.g. "src/extension.ts" or "media/mindmap.js").
- Do not modify dist/ files — only source files that get compiled.
"""


def apply_changes(files: list[dict]) -> None:
    for entry in files:
        rel_path = entry.get("path", "").strip()
        content = entry.get("content", "")
        if not rel_path:
            continue
        target = (REPO_ROOT / rel_path).resolve()
        if not str(target).startswith(str(REPO_ROOT.resolve())):
            print(f"  SKIPPED (path outside repo): {rel_path}", file=sys.stderr)
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        print(f"  wrote: {rel_path}")


def main() -> None:
    issue_number = os.environ.get("ISSUE_NUMBER", "")
    issue_title = os.environ.get("ISSUE_TITLE", "")
    issue_body = os.environ.get("ISSUE_BODY", "")

    if not issue_number:
        print("ERROR: ISSUE_NUMBER environment variable is required.", file=sys.stderr)
        sys.exit(1)

    print(f"Processing issue #{issue_number}: {issue_title}")

    source_files = collect_source_files()
    print(f"Collected {len(source_files)} source files as context.")

    prompt = build_prompt(issue_number, issue_title, issue_body, source_files)

    print("Sending request to Claude via Anthropic SDK...")
    client = anthropic.Anthropic()
    message = client.messages.create(
        model=MODEL,
        max_tokens=8192,
        messages=[{"role": "user", "content": prompt}],
    )
    raw = message.content[0].text.strip()

    # Extract JSON: handle preamble text + ```json ... ``` or bare JSON object
    fence_match = re.search(r"```(?:json)?\s*\n([\s\S]*?)\n```", raw)
    if fence_match:
        raw = fence_match.group(1).strip()
    else:
        brace_match = re.search(r"\{[\s\S]*\}", raw)
        if brace_match:
            raw = brace_match.group(0)

    try:
        response = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(f"ERROR: Claude response is not valid JSON: {exc}", file=sys.stderr)
        print("Raw response:", message.content[0].text[:2000], file=sys.stderr)
        sys.exit(1)

    summary = response.get("summary", "")
    print(f"\nSummary: {summary or '(none)'}")
    (REPO_ROOT / "ai_summary.txt").write_text(summary, encoding="utf-8")

    changed_files = response.get("files", [])
    if not changed_files:
        print("No file changes proposed by Claude.")
        return

    print(f"\nApplying {len(changed_files)} file change(s):")
    apply_changes(changed_files)
    print("\nDone.")


if __name__ == "__main__":
    main()
