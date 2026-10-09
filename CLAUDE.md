# Instructions for Claude

## This project: BOGA CAFÉ (read first)
- Official repository: `mohammedboghaleb9-boop/boga-cafe`. It is the only source of truth for code. Work only here.
- `mohammedboghaleb9-boop/map-test` is an old experimental copy, used only as a Supabase donor (branch `claude/boga-cafe-foundation` @ `f9ba067`; its `main` is empty). Never commit, branch or open a PR there. It will be archived once the comparison is done.

## Language and direction of replies
- Always reply to the owner in **Moroccan Darija** (Arabic script), including reports and summaries.
- Every line must read right to left: start each line or bullet with an Arabic word, never with an English word, a file name or code. Put English terms, file names and commands after the Arabic start of the line.
- Code, commit messages and code comments stay in English, as in the rest of the repository.

## Secrets
- This repository is public. Never put secrets, API keys, passwords or private tokens in code, commits, docs or chat. Use environment variables, Supabase secrets or placeholders.
- Only values that are public by design (Supabase URL, publishable/anon key) may appear in `.env` files that are committed.

## Git workflow
- One repository per project. Never create a second repository or a copy of this one without asking the owner.
- One branch per task. When the task is done and verified: merge into `main` (with the owner's approval), then delete the branch.
- Never start new work while an unmerged branch exists. Tell the owner first and finish or close that branch.
- Open branches: run `git branch -a` at session start; the owner tracks open branches in Notion. No docs-only commits on main while a branch is open.
- Start every session with `git branch -a`, then `git log main..<branch>` for each open branch, before reading or changing code.
- Never merge, force-push, rewrite history or delete a branch with unmerged work without the owner's approval.
- Never deploy (migrations, Edge Functions, site) from a branch that is not merged into main.


# Mohammed's working rules (added 2026-09-30)

## How to talk to me (most important)
- Talk like a real person, not a template. No generic, filler answers.
- Tell me the truth, even when I will not like it. Do not agree just to please me or make me feel good. Agree only when I am actually right.
- Criticize my ideas, my code and my way of working when something is weak. Say it directly and explain why, then propose a better option.
- If I forget something, miss a risk, or my workflow is wrong, tell me without waiting for me to ask.
- Give a real opinion and a recommendation. Not a list of "options" with no stance.
- If I am going in the wrong direction, say so before doing the work, not after.

## Never act on guesses
- Do not do anything until you are sure it is needed. No random or "just in case" changes, installs, refactors or files.
- If something is unclear and the answer changes the result, ask me one short question. If it does not change the result, choose the default and tell me which.
- Before changing something: read the relevant code first. Base every decision on evidence (the code, an error message, a test result, the docs) and show me the evidence in one or two lines.
- Never claim "fixed" or "works" without checking it. Say what you verified and what you did not.
- Do not invent APIs, functions, file names or library options. If not sure, check the docs or the code.

## Testing (few, strong, recent)
- Do NOT write 100 tests. Write the smallest set of tests that proves the change works and protects the risky parts (main path, one or two edge cases, the bug you fixed).
- Run them on the current code, not from memory. Report a short summary: what ran, what passed, what failed.
- If a test fails, find the cause before changing code. Do not loosen a test to make it pass.
- For UI work: open it and look at it (screenshot or preview) before saying it is done.

## Ownership of a project
- When I give you a project, you own it: understand it from the first file to the last before you start changing things.
- Give it full effort. Think about how parts connect: a change here can break something there. Check that.
- Keep the whole history in mind: what we decided, why, what was tried and failed. Do not repeat mistakes already made in this project.
- Claude does not remember between sessions by itself, so every project root has these files, kept up to date:
  - `PROJECT_NOTES.md` (short, max ~150 lines): what the project is, architecture, key decisions and why, known issues, open branches, what is next. Claude reads it FIRST at the start of every session and updates it BEFORE finishing any session that changed code.
  - `CHANGELOG.md`: one dated line per meaningful change.
  - `PROJECT_STATUS.html`: the professional Project Roadmap / Status Report for me (see below). Updated when a task or phase changes status, not after every small edit.
- A Stop hook (`.claude/hooks/check-status-report.py`) blocks finishing if code changed but `PROJECT_NOTES.md` was not updated. If it blocks, update the files, do not argue with it.

## Project Status Report (PROJECT_STATUS.html)
- Use the `project-status-report` skill to create and update it. Do not improvise its structure.
- Self-contained single HTML file, readable by a non-developer: summary first, details after.
- Evidence rule: nothing is marked COMPLETED without evidence (file, test, commit). No evidence = mark it "Needs Verification".
- Numbers that are estimates are labeled "Estimated" and the way they were computed is written next to them.
- Never fake progress. If something is blocked or weak, say so in red.
- Live page for me: https://claude.ai/artifact/ULj6DPP9wF7bMdfWpjuFDH ("BOGA CAFÉ Project Status"). Every time `PROJECT_STATUS.html` changes, republish it to that same link with the Artifact tool (from a new conversation: read that link first, then publish with it as `url`). Never create a second status page.
  The Artifact tool adds the document wrapper itself, so publish a copy without `<!doctype html>`, the `<html>` and `<head>` tags and the charset/viewport metas, with `<body>` … `</body></html>` replaced by `<div lang="ar" dir="rtl">` … `</div>`.

## Code organization (so I can fix things later)
- Always keep a clean, professional structure: split by responsibility (for example components, pages, services, utils, styles, config, tests). No giant files.
- One clear job per file and per function. Clear names. Short comments only where the why is not obvious.
- Follow the conventions already used in the project. Do not mix styles.
- Do not leave dead code, debug logs or unused files behind.
- When you add or move files, tell me the new structure in a few lines.

## Ready-made tools (source: https://www.aitmpl.com)
(These are my working rules. They do not replace the project, language, secrets and git rules written above in this file.)
Catalog index for Claude to read: https://docs.aitmpl.com/llms.txt

1. Do NOT install anything "just in case". Install only what the current task needs.
2. If a needed skill/agent/command is not installed, find it in the catalog, then install it:
   `npx claude-code-templates@latest --skill <category/name> --yes`
   (same flags: `--agent`, `--command`, `--hook`, `--mcp`, `--setting`)
3. Before installing any hook or MCP server: read its content, tell me in one line what it does, and ask me first. They run code on my machine.
4. Prefer project install (`.claude/` in the project). Global (`~/.claude/`) only for things I use everywhere.

## Which tool for which task
- Website / landing page / UI: skills `frontend-design`, `ui-ux-pro-max`; agent `ui-ux-designer`.
- React code (this project is Vite + React, not Next.js): agent `frontend-developer`; skill `senior-frontend`.
- Backend / API / database: skills `senior-backend`, `senior-architect`; agent `database-architect`.
- SEO for a site: agents `seo-specialist`, `seo-analyzer`.
- Before finishing a real code change: agent `code-reviewer`.
- Login, payments, user data, anything exposed online: agent `security-auditor`.
- Installed in this project (`.claude/agents/`, `model: sonnet`): `code-reviewer`, `security-auditor`, `supabase-schema-architect`. One independent review pass per slice, with these agents only; never a general-purpose subagent on the main model.
- New library or framework question: MCP `context7` (current docs), do not guess.
- A workflow I keep repeating: propose it as a skill (skill-creator).

## Optional (only if the task needs them)
- Ads work: `facebook-ads-mcp-server`, `google-ads-mcp-server` (need my own tokens and a local server).
- Podcast / video content: `podcast-content-analyzer`, `seo-podcast-optimizer`.

