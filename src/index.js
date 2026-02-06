#!/usr/bin/env node

/**
 * git-ui CLI Tool
 * 
 * This tool automates the process of cherry-picking commits and pushing to remotes.
 * 
 * Usage:
 *   git-ui           # Interactive mode selector
 *   git-ui <k>       # Quick release: cherry-pick last k commits
 *   git-ui -i        # Direct to interactive mode
 */

const { execSync } = require('child_process');
const readline = require('readline');

// ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
};

let skipAllConfirm = false;

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function logStep(step, message) {
    log(`\n[${step}] ${message}`, colors.cyan);
}

function logSuccess(message) {
    log(`✓ ${message}`, colors.green);
}

function logError(message) {
    log(`✗ ${message}`, colors.red);
}

function logWarning(message) {
    log(`⚠ ${message}`, colors.yellow);
}

function clearScreen() {
    console.clear();
}

function printHeader(title) {
    log(`\n${'═'.repeat(60)}`, colors.cyan);
    log(`  ${title}`, colors.bright);
    log(`${'═'.repeat(60)}`, colors.cyan);
}

function printSubHeader(title) {
    log(`\n${'─'.repeat(50)}`, colors.dim);
    log(`  ${title}`, colors.bright);
    log(`${'─'.repeat(50)}`, colors.dim);
}

/**
 * Spinner class for showing loading animation
 */
class Spinner {
    constructor(message) {
        this.message = message;
        this.frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
        this.frameIndex = 0;
        this.interval = null;
    }

    start() {
        process.stdout.write(`${colors.cyan}${this.frames[0]}${colors.reset} ${this.message}`);
        this.interval = setInterval(() => {
            this.frameIndex = (this.frameIndex + 1) % this.frames.length;
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(`${colors.cyan}${this.frames[this.frameIndex]}${colors.reset} ${this.message}`);
        }, 80);
    }

    stop(success = true) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        if (success) {
            console.log(`${colors.green}✓${colors.reset} ${this.message}`);
        } else {
            console.log(`${colors.yellow}⚠${colors.reset} ${this.message}`);
        }
    }
}

/**
 * Execute a git command with spinner for long operations
 */
function execGitWithSpinner(command, message) {
    const spinner = new Spinner(message);
    spinner.start();
    try {
        const output = execSync(`git ${command}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
        spinner.stop(true);
        return output.trim();
    } catch (error) {
        spinner.stop(false);
        throw new Error(`Git command failed: git ${command}\n${error.message}`);
    }
}

/**
 * Execute a git command and return the output
 */
function execGit(command, silent = false) {
    try {
        if (!silent) {
            log(`  > git ${command}`, colors.blue);
        }
        const output = execSync(`git ${command}`, {
            encoding: 'utf-8',
            stdio: silent ? 'pipe' : ['pipe', 'pipe', 'pipe'],
        });
        return output.trim();
    } catch (error) {
        throw new Error(`Git command failed: git ${command}\n${error.message}`);
    }
}

/**
 * Prompt user for input
 */
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise((resolve) => {
        rl.question(`${colors.yellow}${question}${colors.reset}`, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Prompt for confirmation
 */
async function confirm(question) {
    if (skipAllConfirm) {
        return true;
    }
    const answer = await prompt(`${question} (y/N): `);
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
}

/**
 * Get commit info for display
 */
function getCommitInfo(hash) {
    const shortHash = hash.substring(0, 7);
    const message = execGit(`log -1 --format=%s ${hash}`, true);
    const date = execGit(`log -1 --format=%cs ${hash}`, true);
    return { shortHash, message, date, fullHash: hash };
}

/**
 * Get commits from a branch
 */
function getCommitsFromBranch(branch, count = 20) {
    try {
        const output = execGit(`log ${branch} -${count} --format=%H`, true);
        const hashes = output.split('\n').filter(h => h.length > 0);
        return hashes.map(hash => getCommitInfo(hash));
    } catch {
        return [];
    }
}

/**
 * Get all remotes
 */
function getRemotes() {
    try {
        const output = execGit('remote -v', true);
        const remotes = {};
        output.split('\n').forEach(line => {
            const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
            if (match) {
                const [, name, url, type] = match;
                if (!remotes[name]) remotes[name] = {};
                remotes[name][type] = url;
            }
        });
        return remotes;
    } catch {
        return {};
    }
}

/**
 * Get all branches (local and remote)
 */
function getBranches() {
    try {
        const localOutput = execGit('branch --format=%(refname:short)', true);
        const remoteOutput = execGit('branch -r --format=%(refname:short)', true);

        const local = localOutput.split('\n').filter(b => b.length > 0);
        const remote = remoteOutput.split('\n').filter(b => b.length > 0 && !b.includes('HEAD'));

        return { local, remote };
    } catch {
        return { local: [], remote: [] };
    }
}

/**
 * Get current branch
 */
function getCurrentBranch() {
    try {
        return execGit('rev-parse --abbrev-ref HEAD', true);
    } catch {
        return 'unknown';
    }
}

/**
 * Check for uncommitted changes
 */
function hasUncommittedChanges() {
    try {
        const status = execGit('status --porcelain -uno', true);
        return status.length > 0;
    } catch {
        return false;
    }
}

/**
 * Check if remote exists
 */
function remoteExists(name) {
    const remotes = getRemotes();
    return name in remotes;
}

/**
 * Parse range selection (e.g., "1-5, 8, 10-12")
 */
function parseSelection(input, max) {
    const selected = new Set();
    const parts = input.split(',').map(p => p.trim());

    for (const part of parts) {
        if (part.includes('-')) {
            const [start, end] = part.split('-').map(n => parseInt(n.trim()));
            if (!isNaN(start) && !isNaN(end)) {
                for (let i = Math.min(start, end); i <= Math.max(start, end); i++) {
                    if (i >= 1 && i <= max) selected.add(i);
                }
            }
        } else {
            const num = parseInt(part);
            if (!isNaN(num) && num >= 1 && num <= max) {
                selected.add(num);
            }
        }
    }

    return Array.from(selected).sort((a, b) => a - b);
}

/**
 * Resolve a commit-ish to a full commit hash
 */
function resolveCommit(ref) {
    try {
        return execGit(`rev-parse --verify ${ref}^{commit}`, true);
    } catch {
        return null;
    }
}

function formatTimestamp() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizeBranchName(name) {
    return name.replace(/[^a-zA-Z0-9._/-]+/g, '-');
}

function createSafetyBranchName(currentBranch, shortHash) {
    const base = sanitizeBranchName(currentBranch || 'detached');
    return `backup/${base}-${shortHash}-${formatTimestamp()}`;
}

/**
 * Check for invalid directory/file names
 */
function hasInvalidNames(files) {
    const issues = [];
    const invalidPatterns = [
        { pattern: /\s{2,}/, desc: 'multiple consecutive spaces' },
        { pattern: /^\s|\s$/, desc: 'leading/trailing spaces' },
        { pattern: /[<>:"|?*\\]/, desc: 'invalid characters (<>:"|?*\\)' },
        { pattern: /\.$/, desc: 'trailing period' },
        { pattern: /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i, desc: 'reserved Windows name' },
    ];

    for (const file of files) {
        const parts = file.split('/');
        for (const part of parts) {
            for (const { pattern, desc } of invalidPatterns) {
                if (pattern.test(part)) {
                    issues.push({ file, issue: desc, part });
                }
            }
            // Check for very long names
            if (part.length > 255) {
                issues.push({ file, issue: 'name exceeds 255 characters', part });
            }
        }
        // Check total path length
        if (file.length > 260) {
            issues.push({ file, issue: 'total path exceeds 260 characters', part: file });
        }
    }
    return issues;
}

/**
 * Check merge safety for selected commits against a target branch
 */
async function checkMergeSafety(commits, targetRemote, targetBranch) {
    clearScreen();
    printHeader('Merge Safety Check');

    if (commits.length === 0) {
        logError('No commits selected to check!');
        await prompt('Press Enter to continue...');
        return;
    }

    log(`\n  Checking ${commits.length} commit(s) against ${colors.magenta}${targetRemote}/${targetBranch}${colors.reset}...\n`);

    let hasIssues = false;

    // 1. Check for merge conflicts (dry-run)
    log('  [1/4] Checking for merge conflicts...', colors.cyan);
    try {
        // Get list of files that would be modified
        const allFiles = new Set();
        for (const commit of commits) {
            const files = execGit(`diff-tree --no-commit-id --name-only -r ${commit.fullHash}`, true);
            files.split('\n').filter(f => f.length > 0).forEach(f => allFiles.add(f));
        }

        // Check if target branch has modifications to same files
        const currentBranch = getCurrentBranch();
        let conflictFiles = [];
        try {
            const targetFiles = execGit(`diff --name-only ${currentBranch}...${targetRemote}/${targetBranch}`, true);
            const targetFileSet = new Set(targetFiles.split('\n').filter(f => f.length > 0));
            conflictFiles = [...allFiles].filter(f => targetFileSet.has(f));
        } catch {
            // May fail if branches don't share history
        }

        if (conflictFiles.length > 0) {
            logWarning(`  Potential conflicts in ${conflictFiles.length} file(s):`);
            conflictFiles.slice(0, 10).forEach(f => log(`      • ${f}`, colors.yellow));
            if (conflictFiles.length > 10) {
                log(`      ... and ${conflictFiles.length - 10} more`, colors.dim);
            }
            hasIssues = true;
        } else {
            logSuccess('  No obvious file conflicts detected');
        }
    } catch (e) {
        logWarning(`  Could not check for conflicts: ${e.message}`);
    }

    // 2. Check for invalid directory/file names
    log('\n  [2/4] Checking for invalid directory/file names...', colors.cyan);
    try {
        const allFiles = [];
        for (const commit of commits) {
            const files = execGit(`diff-tree --no-commit-id --name-only -r ${commit.fullHash}`, true);
            files.split('\n').filter(f => f.length > 0).forEach(f => allFiles.push(f));
        }

        const nameIssues = hasInvalidNames(allFiles);
        if (nameIssues.length > 0) {
            logWarning(`  Found ${nameIssues.length} naming issue(s):`);
            nameIssues.slice(0, 10).forEach(({ file, issue }) => {
                log(`      • ${file}: ${issue}`, colors.yellow);
            });
            if (nameIssues.length > 10) {
                log(`      ... and ${nameIssues.length - 10} more`, colors.dim);
            }
            hasIssues = true;
        } else {
            logSuccess('  All file/directory names are valid');
        }
    } catch (e) {
        logWarning(`  Could not check file names: ${e.message}`);
    }

    // 3. Check for large files
    log('\n  [3/4] Checking for large files...', colors.cyan);
    try {
        const largeFiles = [];
        for (const commit of commits) {
            const output = execGit(`diff-tree --no-commit-id -r --numstat ${commit.fullHash}`, true);
            output.split('\n').filter(l => l.length > 0).forEach(line => {
                const [added] = line.split('\t');
                if (added !== '-' && parseInt(added) > 10000) {
                    const file = line.split('\t')[2];
                    largeFiles.push({ file, lines: parseInt(added) });
                }
            });
        }

        if (largeFiles.length > 0) {
            logWarning(`  Found ${largeFiles.length} large file(s) (>10k lines added):`);
            largeFiles.forEach(({ file, lines }) => {
                log(`      • ${file}: +${lines.toLocaleString()} lines`, colors.yellow);
            });
            hasIssues = true;
        } else {
            logSuccess('  No unusually large files detected');
        }
    } catch (e) {
        logWarning(`  Could not check file sizes: ${e.message}`);
    }

    // 4. Check for binary files
    log('\n  [4/4] Checking for binary files...', colors.cyan);
    try {
        const binaryFiles = [];
        for (const commit of commits) {
            const output = execGit(`diff-tree --no-commit-id -r --numstat ${commit.fullHash}`, true);
            output.split('\n').filter(l => l.length > 0).forEach(line => {
                if (line.startsWith('-\t-\t')) {
                    const file = line.split('\t')[2];
                    binaryFiles.push(file);
                }
            });
        }

        if (binaryFiles.length > 0) {
            logWarning(`  Found ${binaryFiles.length} binary file(s):`);
            binaryFiles.slice(0, 10).forEach(f => log(`      • ${f}`, colors.yellow));
            if (binaryFiles.length > 10) {
                log(`      ... and ${binaryFiles.length - 10} more`, colors.dim);
            }
        } else {
            logSuccess('  No binary files detected');
        }
    } catch (e) {
        logWarning(`  Could not check for binary files: ${e.message}`);
    }

    // Summary
    log('');
    if (hasIssues) {
        log('─'.repeat(50), colors.yellow);
        logWarning('Some potential issues detected. Review before proceeding.');
        log('─'.repeat(50), colors.yellow);
    } else {
        log('─'.repeat(50), colors.green);
        logSuccess('All checks passed! Safe to proceed with cherry-pick.');
        log('─'.repeat(50), colors.green);
    }

    await prompt('\nPress Enter to continue...');
}

// ============================================================
// UTILITIES
// ============================================================

async function showGitTree(limit = 50, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Git Tree');

    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 50;
    try {
        const output = execGit(`log --graph --decorate --oneline --all --color=always -n ${safeLimit}`, true);
        console.log(output);
    } catch (error) {
        logError(`Failed to load git tree: ${error.message}`);
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function showStatus(pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Git Status');

    try {
        const output = execGit('status -sb', true);
        console.log(output);
    } catch (error) {
        logError(`Failed to load status: ${error.message}`);
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function showRecentLog(limit = 20, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Recent Commits');

    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
    try {
        const output = execGit(`log -n ${safeLimit} --oneline --decorate --color=always`, true);
        console.log(output);
    } catch (error) {
        logError(`Failed to load commits: ${error.message}`);
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function selectBranchPrompt(title, allowRemote = true) {
    const { local, remote } = getBranches();
    const branches = allowRemote ? [...local, ...remote] : local;
    const current = getCurrentBranch();

    if (branches.length === 0) {
        logError('No branches found');
        await prompt('Press Enter to continue...');
        return null;
    }

    let filter = '';

    while (true) {
        clearScreen();
        printSubHeader(title);

        const filtered = filter
            ? branches.filter(b => b.toLowerCase().includes(filter.toLowerCase()))
            : branches;

        if (filter) {
            log(`\n  Search: ${colors.cyan}${filter}${colors.reset} (${filtered.length} matches)`);
        } else {
            log(`\n  Type to search or enter a number:`);
        }

        const displayBranches = filtered.slice(0, 20);
        log('');
        displayBranches.forEach((branch, i) => {
            const isLocal = local.includes(branch);
            const marker = branch === current ? ` ${colors.green}(current)${colors.reset}` : '';
            const prefix = isLocal ? '' : `${colors.dim}`;
            const suffix = isLocal ? '' : `${colors.reset}`;
            log(`    [${i + 1}] ${prefix}${branch}${suffix}${marker}`);
        });

        if (filtered.length > 20) {
            log(`\n    ... and ${filtered.length - 20} more (refine search)`, colors.dim);
        }

        log('\n  Commands:', colors.dim);
        log('    [/text] Search for branches containing "text"');
        log('    [name] Enter branch name directly');
        log('    [number] Select branch by number');
        log('    [0 or Enter] Cancel');

        const input = await prompt('\n  > ');

        if (input === '0' || input === '') {
            return null;
        }

        if (input.startsWith('/')) {
            filter = input.substring(1);
            continue;
        }

        if (input.toLowerCase() === 'clear' || input === '!') {
            filter = '';
            continue;
        }

        if (branches.includes(input)) {
            return input;
        }

        const idx = parseInt(input) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < displayBranches.length) {
            return displayBranches[idx];
        }

        if (input.length > 0 && isNaN(parseInt(input, 10))) {
            filter = input;
        }
    }
}

async function compareBranches(baseBranch, compareBranch, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Compare Branches');

    log(`\n  Base: ${colors.cyan}${baseBranch}${colors.reset}`);
    log(`  Compare: ${colors.cyan}${compareBranch}${colors.reset}`);

    try {
        const counts = execGit(`rev-list --left-right --count ${baseBranch}...${compareBranch}`, true);
        const [left, right] = counts.trim().split(/\s+/).map(v => parseInt(v, 10));
        if (!isNaN(left) && !isNaN(right)) {
            log(`\n  Ahead/Behind: ${colors.green}${compareBranch}${colors.reset} is ${right} ahead, ${left} behind ${colors.green}${baseBranch}${colors.reset}`);
        }

        const diffStat = execGit(`diff --stat ${baseBranch}...${compareBranch}`, true);
        if (diffStat.trim().length > 0) {
            log('\n  Diff Summary:\n');
            console.log(diffStat);
        } else {
            log('\n  No file differences detected.');
        }
    } catch (error) {
        logError(`Failed to compare branches: ${error.message}`);
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function compareBranchesMenu() {
    const baseBranch = await selectBranchPrompt('Select Base Branch');
    if (!baseBranch) return;

    const compareBranch = await selectBranchPrompt('Select Compare Branch');
    if (!compareBranch) return;

    await compareBranches(baseBranch, compareBranch, true);
}

async function revertLastCommits(count, dryRun = false, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Revert Last Commits');

    const k = parseInt(count, 10);
    if (isNaN(k) || k < 1) {
        logError('Please provide a valid number of commits to revert.');
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, k);

    if (commits.length === 0) {
        logError('No commits found to revert.');
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    if (commits.length < k) {
        logWarning(`Only found ${commits.length} commit(s) on ${currentBranch}.`);
    }

    log(`\n  Current branch: ${colors.green}${currentBranch}${colors.reset}`);
    log('  Commits to revert (newest → oldest):\n');
    commits.forEach((commit, i) => {
        log(`    [${i + 1}] ${colors.yellow}${commit.shortHash}${colors.reset} - ${commit.message.substring(0, 60)}`);
    });

    if (hasUncommittedChanges()) {
        logWarning('Uncommitted changes detected. Revert may fail or require conflict resolution.');
        const proceedDirty = await confirm('Continue with uncommitted changes?');
        if (!proceedDirty) return;
    }

    const proceed = await confirm(`Revert the last ${commits.length} commit(s)?`);
    if (!proceed) {
        log('\nOperation cancelled.', colors.yellow);
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    if (dryRun) {
        logWarning('\nDRY RUN - No changes will be made.');
        commits.forEach(commit => {
            log(`  Would revert: ${commit.shortHash} - ${commit.message.substring(0, 60)}`);
        });
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    try {
        for (const commit of commits) {
            log(`  Reverting: ${commit.shortHash} - ${commit.message.substring(0, 60)}`);
            execGit(`revert --no-edit ${commit.fullHash}`);
            logSuccess(`Reverted ${commit.shortHash}`);
        }
        logSuccess('\nRevert complete.');
    } catch (error) {
        logError(`\nRevert failed: ${error.message}`);
        logWarning('Resolve conflicts, then run: git revert --continue');
        logWarning('Or to abort: git revert --abort');
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function revertCommitsMenu() {
    clearScreen();
    printSubHeader('Revert Last Commits');

    log('\n  Enter how many commits to revert (e.g., 3):');
    const input = await prompt('\n  Count: ');
    if (input === '' || input === '0') return;

    await revertLastCommits(input, false, true);
}

async function goToCommit(ref, mode = 'detach', dryRun = false, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Go To Commit');

    if (!ref) {
        logError('Please provide a commit reference.');
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    const resolved = resolveCommit(ref);
    if (!resolved) {
        logError(`Unable to resolve commit: ${ref}`);
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    const info = getCommitInfo(resolved);
    const currentBranch = getCurrentBranch();

    log(`\n  Target commit: ${colors.yellow}${info.shortHash}${colors.reset} - ${info.message.substring(0, 60)}`);
    log(`  Date: ${colors.dim}${info.date}${colors.reset}`);
    log(`  Current branch: ${colors.green}${currentBranch}${colors.reset}`);

    if (mode === 'detach') {
        const proceed = await confirm(`Checkout ${info.shortHash} in detached HEAD mode?`);
        if (!proceed) return;

        if (dryRun) {
            logWarning(`\nDRY RUN - Would run: git checkout --detach ${resolved}`);
            if (pauseAfter) await prompt('\nPress Enter to continue...');
            return;
        }

        execGit(`checkout --detach ${resolved}`);
        logSuccess(`Now at ${info.shortHash} (detached HEAD)`);
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    if (!['soft', 'mixed', 'hard'].includes(mode)) {
        logError(`Invalid mode: ${mode}. Use detach, soft, mixed, or hard.`);
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    if (hasUncommittedChanges()) {
        logWarning('Uncommitted changes detected.');
        if (mode === 'hard') {
            const confirmHard = await confirm('Uncommitted changes will be lost. Continue?');
            if (!confirmHard) return;
        }
    }

    const createBackup = await confirm('Create safety branch before reset?');
    const shortHash = info.shortHash;
    let backupBranch = null;

    if (createBackup) {
        backupBranch = createSafetyBranchName(currentBranch, shortHash);
        if (dryRun) {
            logWarning(`\nDRY RUN - Would create safety branch: ${backupBranch}`);
        } else {
            try {
                execGit(`branch ${backupBranch}`);
                logSuccess(`Created safety branch: ${backupBranch}`);
            } catch (error) {
                logWarning(`Could not create safety branch: ${error.message}`);
            }
        }
    }

    const proceed = await confirm(`Reset ${currentBranch} to ${info.shortHash} with --${mode}?`);
    if (!proceed) return;

    if (dryRun) {
        logWarning(`\nDRY RUN - Would run: git reset --${mode} ${resolved}`);
        if (pauseAfter) await prompt('\nPress Enter to continue...');
        return;
    }

    execGit(`reset --${mode} ${resolved}`);
    logSuccess(`Reset complete (${mode}).`);

    if (backupBranch) {
        log(`  Safety branch: ${backupBranch}`, colors.dim);
    }

    if (pauseAfter) {
        await prompt('\nPress Enter to continue...');
    }
}

async function goToCommitMenu() {
    clearScreen();
    printSubHeader('Go To Commit');

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, 30);

    if (commits.length === 0) {
        logError('No commits found on current branch');
        await prompt('Press Enter to continue...');
        return;
    }

    log(`\n  Commits on ${colors.green}${currentBranch}${colors.reset}:\n`);
    commits.forEach((commit, i) => {
        const num = String(i + 1).padStart(2, ' ');
        log(`    [${num}] ${colors.yellow}${commit.shortHash}${colors.reset} - ${colors.dim}${commit.date}${colors.reset} - ${commit.message.substring(0, 50)}`);
    });

    log(`\n  Enter commit number, hash, or ref (e.g., HEAD~2) or [0] to cancel:`);
    const input = await prompt('\n  Selection: ');
    if (input === '0' || input === '') return;

    let ref = input;
    const idx = parseInt(input, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < commits.length) {
        ref = commits[idx].fullHash;
    }

    clearScreen();
    printSubHeader('Choose Action');
    log('\n  [1] Checkout commit (detached HEAD)');
    log('  [2] Reset --soft (keep changes staged)');
    log('  [3] Reset --mixed (keep changes unstaged)');
    log('  [4] Reset --hard (discard changes)');
    log('  [0] Cancel');

    const choice = await prompt('\n  Enter choice: ');
    switch (choice) {
        case '1':
            await goToCommit(ref, 'detach', false, true);
            break;
        case '2':
            await goToCommit(ref, 'soft', false, true);
            break;
        case '3':
            await goToCommit(ref, 'mixed', false, true);
            break;
        case '4':
            await goToCommit(ref, 'hard', false, true);
            break;
        default:
            return;
    }
}

async function showUtilitiesMenu() {
    while (true) {
        clearScreen();
    printHeader('git-ui - Developer Utilities');

        log('\n  Options:', colors.bright);
        log('    [1] Revert last N commits');
        log('    [2] Go to a specific commit');
        log('    [3] View git tree');
        log('    [4] Show git status');
        log('    [5] Show recent commits');
        log('    [6] Compare branches');
        log('    [0] Exit');

        const choice = await prompt('\n  Enter choice: ');

        switch (choice) {
            case '1':
                await revertCommitsMenu();
                break;
            case '2':
                await goToCommitMenu();
                break;
            case '3':
                await showGitTree(50, true);
                break;
            case '4':
                await showStatus(true);
                break;
            case '5':
                await showRecentLog(20, true);
                break;
            case '6':
                await compareBranchesMenu();
                break;
            case '0':
            case 'q':
            case '':
                return;
            default:
                logWarning('Invalid choice');
        }
    }
}

// ============================================================
// INTERACTIVE MODE
// ============================================================

async function runInteractiveMode() {
    clearScreen();
    printHeader('git-ui - Interactive Mode');

    let selectedCommits = [];
    let selectedRemotes = [];
    let targetBranch = 'release';

    // Fetch latest with spinner
    log('');
    try {
        execGitWithSpinner('fetch --all', 'Fetching latest from all remotes...');
    } catch {
        logWarning('Could not fetch from some remotes');
    }

    while (true) {
        printSubHeader('Main Menu');
        const currentBranch = getCurrentBranch();
        log(`\n  Current branch: ${colors.green}${currentBranch}${colors.reset}`);
        log(`  Selected commits: ${colors.cyan}${selectedCommits.length}${colors.reset}`);
        log(`  Selected remotes: ${colors.cyan}${selectedRemotes.length > 0 ? selectedRemotes.join(', ') : 'none'}${colors.reset}`);
        log(`  Target branch: ${colors.magenta}${targetBranch}${colors.reset}`);

        log('\n  Options:', colors.bright);
        log('    [1] Switch branch');
        log('    [2] Select commits to cherry-pick');
        log('    [3] Select target remotes');
        log('    [4] Set target branch name');
        log('    [5] Add new remote');
        log('    [6] Execute cherry-pick and push');
        log('    [7] Reset selections');
        log('    [8] Check merge safety');
        log('    [0] Exit');

        const choice = await prompt('\n  Enter choice: ');

        switch (choice) {
            case '1':
                await switchBranchMenu();
                break;
            case '2':
                selectedCommits = await selectCommitsMenu();
                break;
            case '3':
                selectedRemotes = await selectRemotesMenu();
                break;
            case '4':
                targetBranch = await setTargetBranchMenu(targetBranch);
                break;
            case '5':
                await addRemoteMenu();
                break;
            case '6':
                if (selectedCommits.length === 0) {
                    logError('No commits selected!');
                    await prompt('Press Enter to continue...');
                } else if (selectedRemotes.length === 0) {
                    logError('No remotes selected!');
                    await prompt('Press Enter to continue...');
                } else {
                    await executeInteractiveCherryPick(selectedCommits, selectedRemotes, targetBranch);
                    return;
                }
                break;
            case '7':
                selectedCommits = [];
                selectedRemotes = [];
                targetBranch = 'release';
                logSuccess('All selections reset');
                await prompt('Press Enter to continue...');
                break;
            case '8':
                if (selectedCommits.length === 0) {
                    logError('No commits selected!');
                    await prompt('Press Enter to continue...');
                } else {
                    const checkRemote = selectedRemotes.length > 0 ? selectedRemotes[0] : 'origin';
                    await checkMergeSafety(selectedCommits, checkRemote, targetBranch);
                }
                break;
            case '0':
            case 'q':
            case 'exit':
                log('\nGoodbye!', colors.cyan);
                return;
            default:
                logWarning('Invalid choice');
        }
    }
}

async function switchBranchMenu() {
    const { local, remote } = getBranches();
    const current = getCurrentBranch();
    const allBranches = [...local, ...remote];
    let filter = '';

    while (true) {
        clearScreen();
        printSubHeader('Switch Branch');

        // Filter branches based on search input
        const filtered = filter
            ? allBranches.filter(b => b.toLowerCase().includes(filter.toLowerCase()))
            : allBranches;

        if (filter) {
            log(`\n  Search: ${colors.cyan}${filter}${colors.reset} (${filtered.length} matches)`);
        } else {
            log(`\n  Type to search or enter a number:`);
        }

        // Show filtered branches (limit to 20)
        const displayBranches = filtered.slice(0, 20);
        log('');
        displayBranches.forEach((branch, i) => {
            const isLocal = local.includes(branch);
            const marker = branch === current ? ` ${colors.green}(current)${colors.reset}` : '';
            const prefix = isLocal ? '' : `${colors.dim}`;
            const suffix = isLocal ? '' : `${colors.reset}`;
            log(`    [${i + 1}] ${prefix}${branch}${suffix}${marker}`);
        });

        if (filtered.length > 20) {
            log(`\n    ... and ${filtered.length - 20} more (refine search)`, colors.dim);
        }

        log('\n  Commands:', colors.dim);
        log('    [/text] Search for branches containing "text"');
        log('    [number] Select branch by number');
        log('    [0 or Enter] Cancel');

        const input = await prompt('\n  > ');

        // Cancel
        if (input === '0' || input === '') {
            return;
        }

        // Search command
        if (input.startsWith('/')) {
            filter = input.substring(1);
            continue;
        }

        // Clear filter
        if (input.toLowerCase() === 'clear' || input === '!') {
            filter = '';
            continue;
        }

        // Select by number
        const idx = parseInt(input) - 1;
        if (!isNaN(idx) && idx >= 0 && idx < displayBranches.length) {
            const branch = displayBranches[idx];
            try {
                execGit(`checkout ${branch}`);
                logSuccess(`Switched to ${branch}`);
            } catch (e) {
                logError(`Failed to switch: ${e.message}`);
            }
            await prompt('Press Enter to continue...');
            return;
        }

        // Treat input as search filter
        if (input.length > 0 && isNaN(parseInt(input))) {
            filter = input;
        }
    }
}

async function selectCommitsMenu() {
    clearScreen();
    printSubHeader('Select Commits');

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, 30);

    if (commits.length === 0) {
        logError('No commits found on current branch');
        await prompt('Press Enter to continue...');
        return [];
    }

    log(`\n  Commits on ${colors.green}${currentBranch}${colors.reset}:\n`);

    commits.forEach((commit, i) => {
        const num = String(i + 1).padStart(2, ' ');
        log(`    [${num}] ${colors.yellow}${commit.shortHash}${colors.reset} - ${colors.dim}${commit.date}${colors.reset} - ${commit.message.substring(0, 50)}`);
    });

    log(`\n  Enter commit numbers (e.g., "1-5, 8, 10") or [0] to cancel:`);
    const input = await prompt('\n  Selection: ');

    if (input === '0' || input === '') return [];

    const indices = parseSelection(input, commits.length);
    const selected = indices.map(i => commits[i - 1]);

    if (selected.length > 0) {
        logSuccess(`Selected ${selected.length} commit(s)`);
        selected.forEach(c => log(`    • ${c.shortHash} - ${c.message.substring(0, 40)}`));
        await prompt('Press Enter to continue...');
    }

    return selected;
}

async function selectRemotesMenu() {
    clearScreen();
    printSubHeader('Select Target Remotes');

    const remotes = getRemotes();
    const remoteNames = Object.keys(remotes);

    if (remoteNames.length === 0) {
        logError('No remotes configured');
        await prompt('Press Enter to continue...');
        return [];
    }

    log('\n  Available remotes:\n');

    remoteNames.forEach((name, i) => {
        const url = remotes[name].push || remotes[name].fetch || 'unknown';
        log(`    [${i + 1}] ${colors.cyan}${name}${colors.reset} → ${colors.dim}${url}${colors.reset}`);
    });

    log(`\n  Enter remote numbers (e.g., "1, 2") or [0] to cancel:`);
    const input = await prompt('\n  Selection: ');

    if (input === '0' || input === '') return [];

    const indices = parseSelection(input, remoteNames.length);
    const selected = indices.map(i => remoteNames[i - 1]);

    if (selected.length > 0) {
        logSuccess(`Selected remotes: ${selected.join(', ')}`);
        await prompt('Press Enter to continue...');
    }

    return selected;
}

async function setTargetBranchMenu(current) {
    clearScreen();
    printSubHeader('Set Target Branch');

    log(`\n  Current target: ${colors.magenta}${current}${colors.reset}`);
    log('\n  Enter new target branch name (or press Enter to keep current):');

    const input = await prompt('\n  Target branch: ');

    if (input === '') return current;

    logSuccess(`Target branch set to: ${input}`);
    await prompt('Press Enter to continue...');
    return input;
}

async function addRemoteMenu() {
    clearScreen();
    printSubHeader('Add New Remote');

    const name = await prompt('\n  Remote name: ');
    if (!name) return;

    const url = await prompt('  Remote URL: ');
    if (!url) return;

    try {
        execGit(`remote add ${name} ${url}`);
        logSuccess(`Added remote: ${name} → ${url}`);
    } catch (e) {
        logError(`Failed to add remote: ${e.message}`);
    }

    await prompt('Press Enter to continue...');
}

async function executeInteractiveCherryPick(commits, remotes, targetBranch) {
    clearScreen();
    printHeader('Execute Cherry-Pick');

    log('\n  Summary:', colors.bright);
    log(`  • Commits: ${commits.length}`);
    commits.forEach(c => log(`      ${c.shortHash} - ${c.message.substring(0, 40)}`));
    log(`  • Target branch: ${targetBranch}`);
    log(`  • Push to: ${remotes.join(', ')}`);

    const proceed = await confirm('\n  Proceed with cherry-pick and push?');
    if (!proceed) {
        log('\nOperation cancelled.', colors.yellow);
        return;
    }

    try {
        // Check for uncommitted changes
        if (hasUncommittedChanges()) {
            logError('You have uncommitted changes. Please commit or stash them first.');
            return;
        }

        // Checkout target branch from first remote
        logStep('1/3', `Checking out ${remotes[0]}/${targetBranch}...`);
        execGit(`checkout ${remotes[0]}/${targetBranch}`);
        logSuccess(`Checked out ${remotes[0]}/${targetBranch}`);

        // Cherry-pick commits (in order - oldest first, so reverse)
        logStep('2/3', 'Cherry-picking commits...');
        const orderedCommits = [...commits].reverse();

        for (const commit of orderedCommits) {
            log(`  Cherry-picking: ${commit.shortHash} - ${commit.message.substring(0, 40)}`);
            execGit(`cherry-pick ${commit.fullHash}`);
            logSuccess(`Cherry-picked ${commit.shortHash}`);
        }

        // Push to all selected remotes
        logStep('3/3', 'Pushing to remotes...');
        for (const remote of remotes) {
            execGitWithSpinner(`push ${remote} HEAD:${targetBranch}`, `Pushing to ${remote}/${targetBranch}...`);
        }

        log(`\n${'═'.repeat(60)}`, colors.green);
        log('  SUCCESS! Cherry-pick release complete.', colors.bright + colors.green);
        log(`${'═'.repeat(60)}`, colors.green);

    } catch (error) {
        logError(`\nError: ${error.message}`);
        logWarning('You may need to resolve conflicts manually.');
        logWarning('Run: git cherry-pick --continue  OR  git cherry-pick --abort');
    }
}

// ============================================================
// QUICK RELEASE MODE (Enhanced with menu)
// ============================================================

async function runQuickRelease(initialK = null, skipConfirm = false, dryRun = false) {
    skipAllConfirm = skipAllConfirm || skipConfirm;
    printHeader('git-ui - Quick Release');

    if (dryRun) {
        logWarning('DRY RUN MODE - No changes will be made\n');
    }

    try {
        // Step 1: Fetch and sync
        logStep('1/2', 'Fetching latest changes...');
        execGitWithSpinner('fetch --all', 'Fetching from all remotes...');

        log('  Switching to develop branch...', colors.blue);
        execGit('checkout develop');

        try {
            execGit('pull --rebase origin develop');
            logSuccess('Synced with origin/develop');
        } catch {
            logWarning('Pull had issues. Using origin/develop as reference.');
        }

        // Step 2: Get available commits
        logStep('2/2', 'Loading commits from origin/develop...');
        const allCommits = getCommitsFromBranch('origin/develop', 30);

        if (allCommits.length === 0) {
            logError('No commits found on origin/develop');
            process.exit(1);
        }
        logSuccess(`Found ${allCommits.length} commits`);

        // Track selected commits
        let selectedCommits = [];

        // If initial k provided, pre-select those commits
        if (initialK && initialK > 0) {
            selectedCommits = allCommits.slice(0, Math.min(initialK, allCommits.length));
        }

        // Menu loop
        while (true) {
            clearScreen();
            printSubHeader('Quick Release Menu');

            const hasLiveRemote = remoteExists('live');

            log(`\n  Selected commits: ${colors.cyan}${selectedCommits.length}${colors.reset}`);
            if (selectedCommits.length > 0) {
                selectedCommits.slice(0, 5).forEach(c => {
                    log(`    • ${colors.yellow}${c.shortHash}${colors.reset} - ${c.date} - ${c.message.substring(0, 40)}`);
                });
                if (selectedCommits.length > 5) {
                    log(`    ... and ${selectedCommits.length - 5} more`, colors.dim);
                }
            }

            log(`\n  Target: ${colors.magenta}origin/release${colors.reset}${hasLiveRemote ? ` + ${colors.magenta}live/release${colors.reset}` : ''}`);

            log('\n  Options:', colors.bright);
            log('    [1] Select commits');
            log('    [2] Check merge safety');
            log('    [3] Reset selection');
            log('    [4] Execute cherry-pick');
            log('    [0] Exit');

            const choice = await prompt('\n  Enter choice: ');

            switch (choice) {
                case '1':
                    selectedCommits = await quickSelectCommits(allCommits);
                    break;
                case '2':
                    if (selectedCommits.length === 0) {
                        logError('No commits selected!');
                        await prompt('Press Enter to continue...');
                    } else {
                        await checkMergeSafety(selectedCommits, 'origin', 'release');
                    }
                    break;
                case '3':
                    selectedCommits = [];
                    logSuccess('Selection cleared');
                    await prompt('Press Enter to continue...');
                    break;
                case '4':
                    if (selectedCommits.length === 0) {
                        logError('No commits selected!');
                        await prompt('Press Enter to continue...');
                    } else {
                        await executeQuickRelease(selectedCommits, dryRun);
                        return;
                    }
                    break;
                case '0':
                case 'q':
                case '':
                    log('\nGoodbye!', colors.cyan);
                    return;
                default:
                    logWarning('Invalid choice');
            }
        }

    } catch (error) {
        logError(`\nError: ${error.message}`);
        process.exit(1);
    }
}

async function quickSelectCommits(allCommits) {
    clearScreen();
    printSubHeader('Select Commits');

    log(`\n  Commits on ${colors.green}origin/develop${colors.reset}:\n`);

    allCommits.forEach((commit, i) => {
        const num = String(i + 1).padStart(2, ' ');
        log(`    [${num}] ${colors.yellow}${commit.shortHash}${colors.reset} - ${colors.dim}${commit.date}${colors.reset} - ${commit.message.substring(0, 45)}`);
    });

    log(`\n  Enter commit numbers (e.g., "1-5" or "1, 3, 5") or [0] to cancel:`);
    const input = await prompt('\n  Selection: ');

    if (input === '0' || input === '') return [];

    const indices = parseSelection(input, allCommits.length);
    const selected = indices.map(i => allCommits[i - 1]);

    if (selected.length > 0) {
        logSuccess(`Selected ${selected.length} commit(s)`);
        await prompt('Press Enter to continue...');
    }

    return selected;
}

async function executeQuickRelease(commits, dryRun = false) {
    clearScreen();
    printHeader('Execute Quick Release');

    const hasLiveRemote = remoteExists('live');

    log('\n  Summary:', colors.bright);
    log(`  • Commits: ${commits.length}`);
    commits.forEach(c => log(`      ${c.shortHash} - ${c.message.substring(0, 40)}`));
    log(`  • Push to: origin/release${hasLiveRemote ? ', live/release' : ''}`);

    const proceed = await confirm('\n  Proceed with cherry-pick and push?');
    if (!proceed) {
        log('\nOperation cancelled.', colors.yellow);
        return;
    }

    try {
        // Pre-flight checks
        logStep('1/5', 'Running pre-flight checks...');

        if (hasUncommittedChanges()) {
            logError('You have uncommitted changes. Please commit or stash them first.');
            return;
        }
        logSuccess('Working directory is clean');

        // Save original branch
        let originalBranch;
        try {
            originalBranch = getCurrentBranch();
        } catch {
            originalBranch = null;
        }

        // Checkout origin/release
        logStep('2/5', 'Checking out origin/release...');
        if (!dryRun) {
            execGit('checkout origin/release');
        }
        logSuccess('Checked out origin/release');

        // Cherry-pick (oldest first)
        logStep('3/5', 'Cherry-picking commits...');
        const orderedCommits = [...commits].reverse();

        if (!dryRun) {
            for (const commit of orderedCommits) {
                log(`  Cherry-picking: ${commit.shortHash} - ${commit.message.substring(0, 40)}`);
                try {
                    execGit(`cherry-pick ${commit.fullHash}`);
                    logSuccess(`Cherry-picked ${commit.shortHash}`);
                } catch (error) {
                    logError(`Failed to cherry-pick ${commit.shortHash}`);
                    logWarning('Resolve conflicts, then run: git cherry-pick --continue');
                    logWarning('Or to abort: git cherry-pick --abort');
                    throw error;
                }
            }
        } else {
            orderedCommits.forEach(c => log(`  Would cherry-pick: ${c.shortHash} - ${c.message.substring(0, 40)}`));
        }
        logSuccess('All commits cherry-picked');

        // Push to origin
        logStep('4/5', 'Pushing to origin/release...');
        if (!dryRun) {
            execGitWithSpinner('push origin HEAD:release', 'Pushing to origin/release...');
        } else {
            logSuccess('Would push to origin/release');
        }

        // Push to live
        if (hasLiveRemote) {
            logStep('5/5', 'Pushing to live/release...');
            if (!dryRun) {
                execGitWithSpinner('push live origin/release:release', 'Pushing to live/release...');
            } else {
                logSuccess('Would push to live/release');
            }
        } else {
            logStep('5/5', 'Skipping live push (not configured)');
        }

        // Restore branch
        if (originalBranch && !dryRun) {
            log('\n  Restoring original branch...', colors.blue);
            execGit(`checkout ${originalBranch}`);
            logSuccess(`Restored to ${originalBranch}`);
        }

        // Success
        log(`\n${'═'.repeat(60)}`, colors.green);
        log('  SUCCESS! Quick release complete.', colors.bright + colors.green);
        log(`${'═'.repeat(60)}`, colors.green);
        log(`\n  Summary:`);
        log(`    • Cherry-picked ${commits.length} commit(s)`);
        log(`    • Pushed to origin/release`);
        if (hasLiveRemote) {
            log(`    • Pushed to live/release`);
        }
        log('');

    } catch (error) {
        logError(`\nError: ${error.message}`);
    }
}

// ============================================================
// MAIN MENU
// ============================================================

async function showMainMenu() {
    printHeader('git-ui');

    log('\n  Select mode:', colors.bright);
    log('    [1] Quick Release - Cherry-pick from develop to release');
    log('    [2] Interactive Mode - Full control over branches, commits, and remotes');
    log('    [3] Utilities - Useful git commands for developers');
    log('    [0] Exit');

    const choice = await prompt('\n  Enter choice: ');

    switch (choice) {
        case '1':
            await runQuickRelease();
            break;
        case '2':
            await runInteractiveMode();
            break;
        case '3':
            await showUtilitiesMenu();
            break;
        case '0':
        case 'q':
        case '':
            log('\nGoodbye!', colors.cyan);
            break;
        default:
            logWarning('Invalid choice');
    }
}

// ============================================================
// ENTRY POINT
// ============================================================

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    skipAllConfirm = args.includes('-y') || args.includes('--yes');

    const getFlagValue = (flags) => {
        for (const flag of flags) {
            const idx = args.indexOf(flag);
            if (idx !== -1 && idx + 1 < args.length && !args[idx + 1].startsWith('-')) {
                return args[idx + 1];
            }
        }
        return null;
    };

    // Show help
    if (args.includes('--help') || args.includes('-h')) {
        console.log(`
${colors.bright}git-ui${colors.reset} - Cherry-pick commits from develop to release

${colors.cyan}Usage:${colors.reset}
  git-ui               Show mode selection menu
  git-ui <k>           Quick release: cherry-pick last k commits
  git-ui -i            Launch interactive mode directly
  git-ui -u            Launch utilities menu
  git-ui --tree [n]    Show git tree (default 50 commits)
  git-ui --status      Show git status (short)
  git-ui --log [n]     Show recent commits (default 20)
  git-ui --revert <k>  Revert last k commits on current branch
  git-ui --goto <ref>  Go to commit (default: detached HEAD)
                                   Optional: --soft, --mixed, --hard

${colors.cyan}Quick Release Options:${colors.reset}
  -h, --help        Show this help message
  -y, --yes         Skip confirmation prompts
  --dry-run         Show what would be done without making changes

${colors.cyan}Example:${colors.reset}
  git-ui               # Show menu
  git-ui 3             # Cherry-pick last 3 commits
  git-ui 5 --dry-run   # Preview what 5 commits would be picked
  git-ui -i            # Interactive mode
  git-ui --tree 40     # Show git tree (40 commits)
  git-ui --revert 2    # Revert last 2 commits
  git-ui --goto HEAD~3 # Go to commit
`);
        process.exit(0);
    }

    // Direct utility commands (non-interactive)
    if (args.includes('--tree') || args.includes('-t')) {
        const value = getFlagValue(['--tree', '-t']);
        const limit = value ? parseInt(value, 10) : 50;
        await showGitTree(limit, false);
        return;
    }

    if (args.includes('--status')) {
        await showStatus(false);
        return;
    }

    if (args.includes('--log')) {
        const value = getFlagValue(['--log']);
        const limit = value ? parseInt(value, 10) : 20;
        await showRecentLog(limit, false);
        return;
    }

    if (args.includes('--revert')) {
        const value = getFlagValue(['--revert']);
        if (!value) {
            logError('Missing value for --revert. Example: --revert 3');
            process.exit(1);
        }
        await revertLastCommits(value, dryRun, false);
        return;
    }

    if (args.includes('--goto')) {
        const value = getFlagValue(['--goto']);
        if (!value) {
            logError('Missing value for --goto. Example: --goto HEAD~2');
            process.exit(1);
        }
        const mode = args.includes('--soft') ? 'soft'
            : args.includes('--mixed') ? 'mixed'
                : args.includes('--hard') ? 'hard'
                    : 'detach';
        await goToCommit(value, mode, dryRun, false);
        return;
    }

    if (args.includes('-u') || args.includes('--utilities')) {
        await showUtilitiesMenu();
        return;
    }

    // Interactive mode direct
    if (args.includes('-i') || args.includes('--interactive')) {
        await runInteractiveMode();
        return;
    }

    // Quick release with number
    const k = parseInt(args[0], 10);
    if (!isNaN(k) && k >= 1) {
        await runQuickRelease(k, skipAllConfirm, dryRun);
        return;
    }

    // No args or invalid - show menu
    if (args.length === 0) {
        await showMainMenu();
        return;
    }

    // Invalid args
    logError('Invalid arguments. Use --help for usage information.');
    process.exit(1);
}

main();
