# Changelog

All notable changes to git-ui will be documented in this file.

## [2.1.0] - 2026-02-06

### Added
- **Developer Utilities Menu** - A new toolbox of git commands
  - Revert the last N commits (with confirmation and conflict guidance)
  - Go to a specific commit (detached checkout or reset modes)
  - View git tree, status, recent commits, and branch compare
- **Direct utility commands** for scripting:
  - `--tree`, `--status`, `--log`, `--revert`, `--goto`, `--soft`, `--mixed`, `--hard`

## [2.0.0] - 2026-01-29

### Added
- **Interactive Mode** (`-i` flag) - Full control over branches, commits, and remotes
  - Branch switcher with search/filter (type to filter branches)
  - Commit picker with range selection (e.g., "1-5, 8, 10")
  - Remote manager - select targets, add new remotes on-the-fly
  - Configurable target branch name
- **Enhanced Quick Release Mode** - Now with menu-based workflow
  - Select specific commits instead of just "last N"
  - Check merge safety before executing
  - Reset selection option
- **Merge Safety Check** - Pre-flight validation including:
  - Potential merge conflicts detection
  - Invalid directory/file name detection (Windows reserved names, special characters)
  - Large file detection (>10k lines)
  - Binary file detection
- **Loading Spinner** - Animated progress indicator during fetch/push operations
- **Main Menu** - Choose between Quick Release and Interactive Mode

### Changed
- Quick Release no longer requires number of commits upfront
- Improved terminal output formatting with colors and sections
- Updated help text to document new features

### Fixed
- False positive "uncommitted changes" error (now ignores untracked files)
- Added commit dates to display output

## [1.0.0] - Initial Release

### Features
- Cherry-pick last k commits from origin/develop to origin/release
- Push to both origin and live remotes
- Dry-run mode
- Skip confirmation with -y flag
