# git-cherry-release

A CLI tool that automates cherry-picking commits and pushing to remotes with both quick release and interactive modes.

## Installation

### Option 1: Run directly with Node.js

```bash
cd scripts/git-cherry-release
node index.js <k>
```

### Option 2: Install globally via npm

```bash
cd scripts/git-cherry-release
npm install -g .
```

After global installation, you can run from anywhere:

```bash
git-cherry-release
```

## Usage

### Main Menu (no arguments)

```bash
git-cherry-release
```

Shows a mode selection menu:
- **Quick Release** - Cherry-pick last N commits from develop to release
- **Interactive Mode** - Full control over commits, remotes, and branches

### Quick Release Mode

```bash
git-cherry-release <k>          # Cherry-pick last k commits
git-cherry-release 5 --dry-run  # Preview changes without applying
git-cherry-release 3 -y         # Skip confirmation prompts
```

### Interactive Mode

```bash
git-cherry-release -i
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
| `-y, --yes` | Skip confirmation prompts |
| `--dry-run` | Preview changes without applying |

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
git-cherry-release

# Cherry-pick last 3 commits to release branches
git-cherry-release 3

# Preview what would happen without making changes
git-cherry-release 5 --dry-run

# Cherry-pick without confirmation prompt
git-cherry-release 2 -y

# Launch interactive mode
git-cherry-release -i
```

## Interactive Mode Example

```
═══════════════════════════════════════════════════════════
  git-cherry-release - Interactive Mode
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
