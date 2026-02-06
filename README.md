# git-ui

A CLI tool that automates cherry-picking commits and pushing to remotes with both quick release and interactive modes, plus a developer utilities toolbox.

## Installation

### Option 1: Run locally (no global install)

```bash
npm install
./node_modules/.bin/git-ui
```

Or run via `npx`:

```bash
npx git-ui
```

### Option 2: Install globally via npm

```bash
npm install -g .
```

After global installation, you can run from anywhere:

```bash
git-ui
```

## Usage

### Main Menu (no arguments)

```bash
git-ui
```

Shows a mode selection menu:
- **Quick Release** - Cherry-pick last N commits from develop to release
- **Interactive Mode** - Full control over commits, remotes, and branches
- **Utilities** - Useful git commands (revert, go to commit, git tree, status, logs, branch compare, stash manager, branch cleanup, conflict helper)
- **Remote Sync** - Sync two remotes with merge safety and multiple confirmations

### Quick Release Mode

```bash
git-ui <k>          # Cherry-pick last k commits
git-ui 5 --dry-run  # Preview changes without applying
git-ui 3 -y         # Skip confirmation prompts
```

### Interactive Mode

```bash
git-ui -i
```

Features:
- **Switch branch** - View and checkout any local/remote branch
- **Select commits** - Pick specific commits from git log (e.g., "1-5, 8, 10")
- **Select remotes** - Choose which remotes to push to
- **Set target branch** - Change target branch name (default: release)
- **Add remote** - Add new remotes on-the-fly

## Options

| Flag | Description |
|------|-------------|
| `-h, --help` | Show help message |
| `-i, --interactive` | Launch interactive mode directly |
| `-u, --utilities` | Launch utilities menu directly |
| `-y, --yes` | Skip confirmation prompts |
| `--dry-run` | Preview changes without applying |
| `--tree [n]` | Show git tree (default 50 commits) |
| `--status` | Show git status (short) |
| `--log [n]` | Show recent commits (default 20) |
| `--revert <k>` | Revert last k commits on current branch |
| `--goto <ref>` | Go to commit (detached by default) |
| `--sync` | Sync two remotes (interactive) |
| `--soft` | Use soft reset with `--goto` |
| `--mixed` | Use mixed reset with `--goto` |
| `--hard` | Use hard reset with `--goto` |

## What Quick Release Does

1. **Fetches** the latest changes from all remotes
2. **Syncs** with origin/develop
3. **Gets** the latest k commit hashes from origin/develop
4. **Shows** a summary for review
5. **Checks** for uncommitted changes in your working directory
6. **Checks out** origin/release
7. **Cherry-picks** each commit in chronological order
8. **Pushes** to origin/release
9. **Pushes** to live/release (if configured)
10. **Restores** your original branch

## Examples

```bash
# Show main menu
git-ui

# Cherry-pick last 3 commits to release branches
git-ui 3

# Preview what would happen without making changes
git-ui 5 --dry-run

# Cherry-pick without confirmation prompt
git-ui 2 -y

# Launch interactive mode
git-ui -i

# Launch utilities menu
git-ui -u

# Show git tree (last 40 commits)
git-ui --tree 40

# Revert last 2 commits
git-ui --revert 2

# Go to a specific commit (detached HEAD)
git-ui --goto HEAD~3

# Reset current branch to a commit (hard)
git-ui --goto abc1234 --hard

# Sync two remotes (interactive)
git-ui --sync
```

## Interactive Mode Example

```
═══════════════════════════════════════════════════════════
  git-ui - Interactive Mode
═══════════════════════════════════════════════════════════

  Current branch: develop
  Selected commits: 3
  Selected remotes: origin, live
  Target branch: release

  Options:
    [1] Switch branch
    [2] Select commits to cherry-pick
    [3] Select target remotes
    [4] Set target branch name
    [5] Add new remote
    [6] Execute cherry-pick and push
    [0] Exit
```

## Utilities Menu Example

```
═══════════════════════════════════════════════════════════
  git-ui - Developer Utilities
═══════════════════════════════════════════════════════════

  Options:
    [1] Sync two remotes
    [2] Revert last N commits
    [3] Go to a specific commit
    [4] View git tree
    [5] Show git status
    [6] Show recent commits
    [7] Compare branches
    [8] Stash manager
    [9] Branch cleanup
    [10] Conflict helper
    [0] Exit
```

## Requirements

- Node.js >= 14.0.0
- Git installed and configured
- Remote named `origin` (required)
- Remote named `live` (optional, for production deployment)

## Error Handling

The tool will stop and provide helpful messages if:
- You have uncommitted changes (stash or commit first)
- A cherry-pick fails due to conflicts
- A remote doesn't exist or is unreachable

For cherry-pick conflicts, you can:
- Resolve the conflict manually, then run `git cherry-pick --continue`
- Abort the operation with `git cherry-pick --abort`

## Running Tests

```bash
npm test
```
