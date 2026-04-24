#!/usr/bin/env bash
# Rick's harness — Pre-commit gate (P0-2).
#
# Wired as PreToolUse hook on the Bash tool (see .claude/settings.json).
# Filters internally for `git commit`, then enforces:
#   1. inside a real git work tree
#   2. repo has at least one remote
#   3. no obvious API keys in the staged diff
#
# Exit 0 = allow.
# Exit 2 = block + feedback Claude (it will see stderr and try to fix).

set -euo pipefail

# --- read hook input from stdin (JSON from Claude Code) ---
input=$(cat)
cmd=$(printf '%s' "$input"     | jq -r '.tool_input.command // ""')
hook_cwd=$(printf '%s' "$input" | jq -r '.cwd // ""')

# only act on `git commit`
echo "$cmd" | grep -qE '^[[:space:]]*git[[:space:]]+commit' || exit 0

# operate in the dir the commit will run in
[ -n "$hook_cwd" ] && cd "$hook_cwd"

# --- checks ---
errors=()

git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || errors+=("当前目录不是 git 工作树")

if [ ${#errors[@]} -eq 0 ] && ! git remote | grep -q . ; then
    errors+=("repo 没有 GitHub 远端 — 先建：gh repo create exprick/<name> --private --source . --push")
fi

if [ ${#errors[@]} -eq 0 ]; then
    secret_pat='(sk-[a-zA-Z0-9_-]{20,}|sk-ant-[a-zA-Z0-9_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|AIza[0-9A-Za-z_-]{35})'
    if git diff --cached -U0 2>/dev/null | grep -E '^\+[^+]' | grep -qE "$secret_pat"; then
        errors+=("staged 改动里疑似有 API key — unstage 并把 key 挪到 .env / shell 环境变量")
    fi
fi

# --- output ---
if [ ${#errors[@]} -gt 0 ]; then
    {
        echo "[harness/git-commit-gate] BLOCKED:"
        for e in "${errors[@]}"; do echo "  ✗ $e"; done
        echo ""
        echo "修好上面再重新 commit。"
    } >&2
    exit 2
fi

exit 0
