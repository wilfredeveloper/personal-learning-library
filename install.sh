#!/usr/bin/env bash
# Personal Learning Library installer.
#   ./install.sh                     library in ~/learning-library
#   LIBRARY_DIR=/path ./install.sh   library somewhere else
# Safe to re-run: an existing library is never overwritten, and an existing teach skill is backed up first.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$REPO/app"
LIBRARY_DIR="${LIBRARY_DIR:-$HOME/learning-library}"
SKILL_DIR="$HOME/.claude/skills/teach"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33mwarning:\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. Tools
say "Checking tools"
command -v node >/dev/null || die "Node.js 20 or newer is needed: https://nodejs.org"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20 or newer is needed (found $(node -v))"
command -v python3 >/dev/null || die "python3 is needed (it rebuilds the library front page)"
command -v git >/dev/null || die "git is needed (the Control room keeps the teach skill's history in git)"
if ! command -v pnpm >/dev/null; then
  if command -v corepack >/dev/null; then say "Enabling pnpm through corepack"; corepack enable pnpm || die "corepack could not enable pnpm; install it: npm i -g pnpm"
  else die "pnpm is needed: npm i -g pnpm"; fi
fi
if command -v claude >/dev/null; then
  say "Found Claude Code: $(claude --version 2>/dev/null | head -1)"
else
  warn "Claude Code (the 'claude' command) is not on PATH. Lessons and the tutor need it: https://claude.com/claude-code"
fi

render() { # replace the path placeholders in a file
  sed -i.tmp -e "s#{{LIBRARY_DIR}}#$LIBRARY_DIR#g" -e "s#{{APP_DIR}}#$APP_DIR#g" "$1" && rm -f "$1.tmp"
}

# 2. Starter library
if [ -e "$LIBRARY_DIR" ]; then
  say "Library already at $LIBRARY_DIR: leaving it as it is"
else
  say "Creating your library at $LIBRARY_DIR (with the how-llms-work demo course)"
  mkdir -p "$(dirname "$LIBRARY_DIR")"
  cp -R "$REPO/library" "$LIBRARY_DIR"
  render "$LIBRARY_DIR/CLAUDE.md"
  python3 "$LIBRARY_DIR/_shared/build_library.py" >/dev/null
fi

# 3. The teach skill
if [ -e "$SKILL_DIR" ] || [ -L "$SKILL_DIR" ]; then
  BACKUP="$SKILL_DIR.backup-$(date +%Y%m%d-%H%M%S)"
  say "Backing up your existing teach skill to $BACKUP"
  mv "$SKILL_DIR" "$BACKUP"
fi
say "Installing the teach skill to $SKILL_DIR"
mkdir -p "$(dirname "$SKILL_DIR")"
cp -R "$REPO/skill/teach" "$SKILL_DIR"
render "$SKILL_DIR/SKILL.md"
# The Control room edits the skill and keeps every save as a git commit in this folder.
git -C "$SKILL_DIR" init -q
git -C "$SKILL_DIR" add -A
git -C "$SKILL_DIR" -c user.name="Personal Learning Library" -c user.email="install@localhost" commit -q -m "Teach skill as installed"

# 4. The app
say "Installing the app's packages"
printf 'LEARNING_DIR=%s\n' "$LIBRARY_DIR" > "$APP_DIR/.env.local"
(cd "$APP_DIR" && pnpm install --silent)
say "Publishing your courses into the app (checks each lesson's links once; takes a minute)"
(cd "$APP_DIR" && pnpm -s sync)

cat <<DONE

Done.
  Your library:  $LIBRARY_DIR
  The skill:     $SKILL_DIR  (use it as /teach in Claude Code)
  The app:       cd "$APP_DIR" && pnpm dev   then open http://localhost:3000

Start learning: open Claude Code anywhere and type  /teach <what you want to learn>
DONE
