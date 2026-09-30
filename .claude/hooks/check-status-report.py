#!/usr/bin/env python3
"""Stop hook: blocks finishing a session that changed code without updating PROJECT_NOTES.md.

- Opt-in: does nothing unless PROJECT_NOTES.md exists in the project root.
- Git repos: compares the time of the last commit touching code with the last commit
  touching PROJECT_NOTES.md (plus uncommitted edits). A fresh clone never triggers it.
- No git: falls back to file modification times.
- Only cares about changes from the last WINDOW_HOURS. Blocks once (stop_hook_active guard).
"""
import json
import os
import subprocess
import sys
import time

WINDOW_HOURS = 6
DOCS = {"PROJECT_NOTES.md", "PROJECT_STATUS.html", "CHANGELOG.md"}
IGNORE_DIRS = {".git", "node_modules", ".next", "dist", "build", ".venv", "venv",
               "__pycache__", ".claude", "coverage", ".turbo", ".cache", ".idea", ".vscode"}
EXCLUDES = [":(exclude)" + d for d in sorted(DOCS)] + [":(exclude).claude"]


def git(root, *args):
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=8)
        return r.returncode, r.stdout
    except Exception:
        return 1, ""


def last_commit_ts(root, *pathspec):
    rc, out = git(root, "log", "-1", "--format=%ct", "--", *pathspec)
    out = out.strip()
    return int(out) if rc == 0 and out.isdigit() else 0


def is_code(path):
    parts = path.replace("\\", "/").split("/")
    return parts[-1] not in DOCS and not (set(parts[:-1]) & IGNORE_DIRS)


def mtime(root, rel):
    try:
        return os.path.getmtime(os.path.join(root, rel))
    except OSError:
        return 0


def timestamps_git(root):
    code_ts = last_commit_ts(root, ".", *EXCLUDES)
    notes_ts = last_commit_ts(root, "PROJECT_NOTES.md")
    newest = None
    _, status = git(root, "status", "--porcelain", "--untracked-files=all")
    for line in status.splitlines():
        rel = line[3:].split(" -> ")[-1].strip().strip('"')
        if rel == "PROJECT_NOTES.md":
            notes_ts = max(notes_ts, mtime(root, rel))
        elif is_code(rel):
            m = mtime(root, rel)
            if m > code_ts:
                code_ts, newest = m, rel
    return code_ts, notes_ts, newest


def timestamps_mtime(root):
    notes_ts = mtime(root, "PROJECT_NOTES.md")
    code_ts, newest = 0.0, None
    for folder, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in IGNORE_DIRS]
        for name in files:
            if name in DOCS:
                continue
            rel = os.path.relpath(os.path.join(folder, name), root)
            m = mtime(root, rel)
            if m > code_ts:
                code_ts, newest = m, rel
    return code_ts, notes_ts, newest


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0
    if data.get("stop_hook_active"):
        return 0
    root = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    if not os.path.isfile(os.path.join(root, "PROJECT_NOTES.md")):
        return 0

    rc, _ = git(root, "rev-parse", "--is-inside-work-tree")
    code_ts, notes_ts, newest = timestamps_git(root) if rc == 0 else timestamps_mtime(root)

    recent = code_ts >= time.time() - WINDOW_HOURS * 3600
    if recent and code_ts > notes_ts + 1:
        what = newest or "a recent commit"
        print(json.dumps({"decision": "block", "reason": (
            f"Code changed ({what}) but PROJECT_NOTES.md was not updated. Before finishing: "
            "update PROJECT_NOTES.md (current state, decisions and why, what is next) and add a "
            "CHANGELOG.md line. If a task or phase changed status, also update PROJECT_STATUS.html "
            "(only mark something done if you have evidence). Commit and push these files too.")}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
