#!/bin/sh
# Rendra IDE · Claude Code statusline bridge
#
# Claude Code runs the configured statusline command on every refresh and sends it, on stdin,
# a JSON document with the session state — including `rate_limits` (five_hour / seven_day:
# used_percentage + resets_at) for subscription accounts. This script saves that JSON where
# Rendra IDE reads it, then hands the same input to the statusline the user had before (kept
# in statusline-chain.sh), so their status bar keeps working exactly as it did.
# Nothing here reads or sends credentials.

dir="$HOME/.rendra-ide"
mkdir -p "$dir" 2>/dev/null
input=$(cat)
printf '%s' "$input" > "$dir/claude-status.json.tmp" 2>/dev/null && mv -f "$dir/claude-status.json.tmp" "$dir/claude-status.json" 2>/dev/null

if [ -f "$dir/statusline-chain.sh" ]; then
  printf '%s' "$input" | sh "$dir/statusline-chain.sh"
fi
exit 0
