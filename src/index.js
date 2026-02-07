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
const inquirer = require('inquirer');
const chalk = require('chalk');
const ora = require('ora');
const boxen = require('boxen');

let skipAllConfirm = false;

async function input(options) {
    const { message, default: defaultValue } = options;
    const { value } = await inquirer.prompt([
        {
            type: 'input',
            name: 'value',
            message,
            default: defaultValue,
        },
    ]);
    return value;
}

async function select(options) {
    const { message, choices, pageSize } = options;
    const { value } = await inquirer.prompt([
        {
            type: 'list',
            name: 'value',
            message,
            choices,
            pageSize,
        },
    ]);
    return value;
}

async function checkbox(options) {
    const { message, choices, pageSize } = options;
    const { value } = await inquirer.prompt([
        {
            type: 'checkbox',
            name: 'value',
            message,
            choices,
            pageSize,
        },
    ]);
    return value;
}

async function confirmPrompt(options) {
    const { message, default: defaultValue } = options;
    const { value } = await inquirer.prompt([
        {
            type: 'confirm',
            name: 'value',
            message,
            default: defaultValue,
        },
    ]);
    return value;
}

function log(message, color) {
    if (color) {
        console.log(color(message));
        return;
    }
    console.log(message);
}

function logStep(step, message) {
    log(`\n[${step}] ${message}`, chalk.cyan);
}

function logSuccess(message) {
    log(`✓ ${message}`, chalk.green);
}

function logError(message) {
    log(`✗ ${message}`, chalk.red);
}

function logWarning(message) {
    log(`⚠ ${message}`, chalk.yellow);
}

function clearScreen() {
    console.clear();
}

function isInteractiveSession() {
    return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function printHeader(title) {
    const content = chalk.bold(title);
    const box = boxen(content, {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 1, bottom: 0, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: 'cyan',
    });
    console.log(box);
}

function printSubHeader(title) {
    const content = chalk.bold(title);
    const box = boxen(content, {
        padding: { top: 0, bottom: 0, left: 2, right: 2 },
        margin: { top: 1, bottom: 0, left: 0, right: 0 },
        borderStyle: 'round',
        borderColor: 'gray',
    });
    console.log(box);
}

/**
 * Execute a git command with spinner for long operations
 */
function execGitWithSpinner(command, message) {
    const spinner = ora({ text: message, color: 'cyan' }).start();
    try {
        const output = execSync(`git ${command}`, {
            encoding: 'utf-8',
            stdio: 'pipe',
        });
        spinner.succeed(message);
        return output.trim();
    } catch (error) {
        spinner.fail(message);
        throw new Error(`Git command failed: git ${command}\n${error.message}`);
    }
}

/**
 * Execute a git command and return the output
 */
function execGit(command, silent = false) {
    try {
        if (!silent) {
            log(`  > git ${command}`, chalk.blue);
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
async function prompt(question, options = {}) {
    if (!isInteractiveSession()) {
        return '';
    }
    const result = await input({
        message: chalk.yellow(question),
        ...options,
    });
    return typeof result === 'string' ? result.trim() : result;
}

/**
 * Prompt for confirmation
 */
async function confirm(question, defaultValue = false) {
    if (skipAllConfirm) {
        return true;
    }
    if (!isInteractiveSession()) {
        return defaultValue;
    }
    return confirmPrompt({
        message: chalk.yellow(question),
        default: defaultValue,
    });
}

async function pause(message = 'Press Enter to continue...') {
    if (!isInteractiveSession()) {
        return;
    }
    await input({
        message: chalk.dim(message),
        default: '',
    });
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

function getRemoteBranches(remote) {
    try {
        const output = execGit('branch -r --format=%(refname:short)', true);
        return output
            .split('\n')
            .filter(b => b.startsWith(`${remote}/`) && !b.includes('HEAD'))
            .map(b => b.replace(`${remote}/`, ''))
            .filter(Boolean);
    } catch {
        return [];
    }
}

function getRemoteHeadSha(remote, branch) {
    try {
        const output = execGit(`ls-remote --heads ${remote} ${branch}`, true);
        if (!output.trim()) return null;
        return output.trim().split(/\s+/)[0] || null;
    } catch {
        return null;
    }
}

function ensureRemoteBranchFetched(remote, branch) {
    const ref = `${remote}/${branch}`;
    if (resolveCommit(ref)) return true;
    try {
        execGit(`fetch ${remote} ${branch}`);
    } catch {
        // ignore and retry with explicit refspec
    }
    if (resolveCommit(ref)) return true;
    try {
        execGit(`fetch ${remote} ${branch}:refs/remotes/${remote}/${branch}`);
    } catch {
        // ignore and retry
    }
    return Boolean(resolveCommit(ref));
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

function shellQuote(value) {
    return JSON.stringify(value);
}

function getConflictedFiles() {
    try {
        const output = execGit('diff --name-only --diff-filter=U', true);
        return output.split('\n').filter(f => f.length > 0);
    } catch {
        return [];
    }
}

function isAncestor(ancestorRef, descendantRef) {
    try {
        execGit(`merge-base --is-ancestor ${ancestorRef} ${descendantRef}`, true);
        return true;
    } catch {
        return false;
    }
}

function getAheadBehind(leftRef, rightRef) {
    try {
        const output = execGit(`rev-list --left-right --count ${leftRef}...${rightRef}`, true);
        const [left, right] = output.trim().split(/\s+/).map(v => parseInt(v, 10));
        return {
            left: Number.isNaN(left) ? 0 : left,
            right: Number.isNaN(right) ? 0 : right,
        };
    } catch {
        return { left: 0, right: 0 };
    }
}

function getCommitHashesBetween(baseRef, compareRef) {
    try {
        const output = execGit(`log --format=%H ${baseRef}..${compareRef}`, true);
        return output.split('\n').filter(Boolean);
    } catch {
        return [];
    }
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
        await pause();
        return;
    }

    log(`\n  Checking ${commits.length} commit(s) against ${chalk.magenta(`${targetRemote}/${targetBranch}`)}...\n`);

    let hasIssues = false;

    // 1. Check for merge conflicts (dry-run)
    log('  [1/4] Checking for merge conflicts...', chalk.cyan);
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
            conflictFiles.slice(0, 10).forEach(f => log(`      • ${f}`, chalk.yellow));
            if (conflictFiles.length > 10) {
                log(`      ... and ${conflictFiles.length - 10} more`, chalk.dim);
            }
            hasIssues = true;
        } else {
            logSuccess('  No obvious file conflicts detected');
        }
    } catch (e) {
        logWarning(`  Could not check for conflicts: ${e.message}`);
    }

    // 2. Check for invalid directory/file names
    log('\n  [2/4] Checking for invalid directory/file names...', chalk.cyan);
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
                log(`      • ${file}: ${issue}`, chalk.yellow);
            });
            if (nameIssues.length > 10) {
                log(`      ... and ${nameIssues.length - 10} more`, chalk.dim);
            }
            hasIssues = true;
        } else {
            logSuccess('  All file/directory names are valid');
        }
    } catch (e) {
        logWarning(`  Could not check file names: ${e.message}`);
    }

    // 3. Check for large files
    log('\n  [3/4] Checking for large files...', chalk.cyan);
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
                log(`      • ${file}: +${lines.toLocaleString()} lines`, chalk.yellow);
            });
            hasIssues = true;
        } else {
            logSuccess('  No unusually large files detected');
        }
    } catch (e) {
        logWarning(`  Could not check file sizes: ${e.message}`);
    }

    // 4. Check for binary files
    log('\n  [4/4] Checking for binary files...', chalk.cyan);
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
            binaryFiles.slice(0, 10).forEach(f => log(`      • ${f}`, chalk.yellow));
            if (binaryFiles.length > 10) {
                log(`      ... and ${binaryFiles.length - 10} more`, chalk.dim);
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
        log('─'.repeat(50), chalk.yellow);
        logWarning('Some potential issues detected. Review before proceeding.');
        log('─'.repeat(50), chalk.yellow);
    } else {
        log('─'.repeat(50), chalk.green);
        logSuccess('All checks passed! Safe to proceed with cherry-pick.');
        log('─'.repeat(50), chalk.green);
    }

    await pause();
}

async function checkMergeSafetyForSync(commits, targetRef, sourceRef, canFastForward) {
    clearScreen();
    printHeader('Sync Merge Safety');

    if (commits.length === 0) {
        logError('No commits selected to check!');
        await pause();
        return;
    }

    log(`\n  Checking ${commits.length} commit(s) from ${chalk.cyan(sourceRef)} against ${chalk.magenta(targetRef)}...\n`);

    let hasIssues = false;

    // 1. Check for potential conflicts (diverged history)
    log('  [1/4] Checking for potential conflicts...', chalk.cyan);
    try {
        if (!canFastForward) {
            const allFiles = new Set();
            for (const commit of commits) {
                const files = execGit(`diff-tree --no-commit-id --name-only -r ${commit.fullHash}`, true);
                files.split('\n').filter(f => f.length > 0).forEach(f => allFiles.add(f));
            }

            const diffFiles = execGit(`diff --name-only ${targetRef}...${sourceRef}`, true);
            const diffSet = new Set(diffFiles.split('\n').filter(f => f.length > 0));
            const conflictFiles = [...allFiles].filter(f => diffSet.has(f));

            if (conflictFiles.length > 0) {
                logWarning(`  Potential conflicts in ${conflictFiles.length} file(s):`);
                conflictFiles.slice(0, 10).forEach(f => log(`      • ${f}`, chalk.yellow));
                if (conflictFiles.length > 10) {
                    log(`      ... and ${conflictFiles.length - 10} more`, chalk.dim);
                }
                hasIssues = true;
            } else {
                logSuccess('  No obvious file conflicts detected');
            }
        } else {
            logSuccess('  Fast-forward possible (no divergent history)');
        }
    } catch (e) {
        logWarning(`  Could not check for conflicts: ${e.message}`);
    }

    // 2. Check for invalid directory/file names
    log('\n  [2/4] Checking for invalid directory/file names...', chalk.cyan);
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
                log(`      • ${file}: ${issue}`, chalk.yellow);
            });
            if (nameIssues.length > 10) {
                log(`      ... and ${nameIssues.length - 10} more`, chalk.dim);
            }
            hasIssues = true;
        } else {
            logSuccess('  All file/directory names are valid');
        }
    } catch (e) {
        logWarning(`  Could not check file names: ${e.message}`);
    }

    // 3. Check for large files
    log('\n  [3/4] Checking for large files...', chalk.cyan);
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
                log(`      • ${file}: +${lines.toLocaleString()} lines`, chalk.yellow);
            });
            hasIssues = true;
        } else {
            logSuccess('  No unusually large files detected');
        }
    } catch (e) {
        logWarning(`  Could not check file sizes: ${e.message}`);
    }

    // 4. Check for binary files
    log('\n  [4/4] Checking for binary files...', chalk.cyan);
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
            binaryFiles.slice(0, 10).forEach(f => log(`      • ${f}`, chalk.yellow));
            if (binaryFiles.length > 10) {
                log(`      ... and ${binaryFiles.length - 10} more`, chalk.dim);
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
        log('─'.repeat(50), chalk.yellow);
        logWarning('Some potential issues detected. Review before proceeding.');
        log('─'.repeat(50), chalk.yellow);
    } else {
        log('─'.repeat(50), chalk.green);
        logSuccess('All checks passed! Safe to proceed with sync.');
        log('─'.repeat(50), chalk.green);
    }

    await pause();
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
        await pause();
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
        await pause();
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
        await pause();
    }
}

async function selectBranchPrompt(title, allowRemote = true) {
    const { local, remote } = getBranches();
    const branches = allowRemote ? [...local, ...remote] : local;
    const current = getCurrentBranch();

    if (branches.length === 0) {
        logError('No branches found');
        await pause();
        return null;
    }

    let filter = '';

    while (true) {
        clearScreen();
        printSubHeader(title);

        const filtered = filter
            ? branches.filter(b => b.toLowerCase().includes(filter.toLowerCase()))
            : branches;

        if (filtered.length === 0) {
            logWarning(`No branches match "${filter}".`);
            filter = await prompt('Filter branches (leave blank to show all):', { default: '' });
            continue;
        }

        const displayBranches = filtered.slice(0, 50);
        const messageSuffix = filter ? chalk.dim(` (filter: ${filter}, ${filtered.length} match${filtered.length === 1 ? '' : 'es'})`) : '';

        const choices = [
            { name: chalk.dim('Refine search'), value: '__filter__' },
            ...displayBranches.map(branch => {
                const isLocal = local.includes(branch);
                const marker = branch === current ? chalk.green(' (current)') : '';
                const scope = isLocal ? chalk.dim('local') : chalk.dim('remote');
                return {
                    name: `${scope} ${branch}${marker}`,
                    value: branch,
                };
            }),
            { name: 'Cancel', value: null },
        ];

        if (filtered.length > displayBranches.length) {
            choices.splice(1, 0, {
                name: chalk.dim(`Showing first ${displayBranches.length} of ${filtered.length}`),
                value: '__info__',
                disabled: true,
            });
        }

        const selection = await select({
            message: `Select branch${messageSuffix}`,
            choices,
            pageSize: 12,
        });

        if (selection === '__filter__') {
            filter = await prompt('Filter branches (leave blank to show all):', { default: filter });
            continue;
        }

        return selection;
    }
}

async function selectCommitsFromList(commits, title, preselected = []) {
    if (!commits || commits.length === 0) {
        logError('No commits found.');
        await pause();
        return [];
    }

    const preselectedSet = new Set(preselected.map(item => (item && item.fullHash ? item.fullHash : item)));
    const choices = [
        { name: chalk.dim('Select all'), value: '__all__' },
        ...commits.map((commit, i) => ({
            name: `${String(i + 1).padStart(2, ' ')} ${chalk.yellow(commit.shortHash)} ${chalk.dim(commit.date)} ${commit.message.substring(0, 60)}`,
            value: commit.fullHash,
            checked: preselectedSet.has(commit.fullHash),
        })),
        { name: 'Cancel', value: '__cancel__' },
    ];

    const selected = await checkbox({
        message: title,
        choices,
        pageSize: 12,
    });

    if (!selected || selected.length === 0 || selected.includes('__cancel__')) {
        return [];
    }

    if (selected.includes('__all__')) {
        return commits;
    }

    return commits.filter(commit => selected.includes(commit.fullHash));
}

async function compareBranches(baseBranch, compareBranch, pauseAfter = true) {
    if (pauseAfter) {
        clearScreen();
    }
    printHeader('Compare Branches');

    log(`\n  Base: ${chalk.cyan(baseBranch)}`);
    log(`  Compare: ${chalk.cyan(compareBranch)}`);

    try {
        const counts = execGit(`rev-list --left-right --count ${baseBranch}...${compareBranch}`, true);
        const [left, right] = counts.trim().split(/\s+/).map(v => parseInt(v, 10));
        if (!isNaN(left) && !isNaN(right)) {
            log(`\n  Ahead/Behind: ${chalk.green(compareBranch)} is ${right} ahead, ${left} behind ${chalk.green(baseBranch)}`);
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
        await pause();
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
        if (pauseAfter) await pause();
        return;
    }

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, k);

    if (commits.length === 0) {
        logError('No commits found to revert.');
        if (pauseAfter) await pause();
        return;
    }

    if (commits.length < k) {
        logWarning(`Only found ${commits.length} commit(s) on ${currentBranch}.`);
    }

    log(`\n  Current branch: ${chalk.green(currentBranch)}`);
    log('  Commits to revert (newest → oldest):\n');
    commits.forEach((commit, i) => {
        log(`    [${i + 1}] ${chalk.yellow(commit.shortHash)} - ${commit.message.substring(0, 60)}`);
    });

    if (hasUncommittedChanges()) {
        logWarning('Uncommitted changes detected. Revert may fail or require conflict resolution.');
        const proceedDirty = await confirm('Continue with uncommitted changes?');
        if (!proceedDirty) return;
    }

    const proceed = await confirm(`Revert the last ${commits.length} commit(s)?`);
    if (!proceed) {
        log('\nOperation cancelled.', chalk.yellow);
        if (pauseAfter) await pause();
        return;
    }

    if (dryRun) {
        logWarning('\nDRY RUN - No changes will be made.');
        commits.forEach(commit => {
            log(`  Would revert: ${commit.shortHash} - ${commit.message.substring(0, 60)}`);
        });
        if (pauseAfter) await pause();
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
        await pause();
    }
}

async function revertCommitsMenu() {
    clearScreen();
    printSubHeader('Revert Last Commits');

    const input = await prompt('Enter how many commits to revert (e.g., 3):');
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
        if (pauseAfter) await pause();
        return;
    }

    const resolved = resolveCommit(ref);
    if (!resolved) {
        logError(`Unable to resolve commit: ${ref}`);
        if (pauseAfter) await pause();
        return;
    }

    const info = getCommitInfo(resolved);
    const currentBranch = getCurrentBranch();

    log(`\n  Target commit: ${chalk.yellow(info.shortHash)} - ${info.message.substring(0, 60)}`);
    log(`  Date: ${chalk.dim(info.date)}`);
    log(`  Current branch: ${chalk.green(currentBranch)}`);

    if (mode === 'detach') {
        const proceed = await confirm(`Checkout ${info.shortHash} in detached HEAD mode?`);
        if (!proceed) return;

        if (dryRun) {
            logWarning(`\nDRY RUN - Would run: git checkout --detach ${resolved}`);
            if (pauseAfter) await pause();
            return;
        }

        execGit(`checkout --detach ${resolved}`);
        logSuccess(`Now at ${info.shortHash} (detached HEAD)`);
        if (pauseAfter) await pause();
        return;
    }

    if (!['soft', 'mixed', 'hard'].includes(mode)) {
        logError(`Invalid mode: ${mode}. Use detach, soft, mixed, or hard.`);
        if (pauseAfter) await pause();
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
        if (pauseAfter) await pause();
        return;
    }

    execGit(`reset --${mode} ${resolved}`);
    logSuccess(`Reset complete (${mode}).`);

    if (backupBranch) {
        log(`  Safety branch: ${backupBranch}`, chalk.dim);
    }

    if (pauseAfter) {
        await pause();
    }
}

async function goToCommitMenu() {
    clearScreen();
    printSubHeader('Go To Commit');

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, 30);

    if (commits.length === 0) {
        logError('No commits found on current branch');
        await pause();
        return;
    }

    const commitChoices = [
        { name: chalk.dim('Enter a ref manually'), value: '__manual__' },
        ...commits.map((commit, i) => ({
            name: `${String(i + 1).padStart(2, ' ')} ${chalk.yellow(commit.shortHash)} ${chalk.dim(commit.date)} ${commit.message.substring(0, 50)}`,
            value: commit.fullHash,
        })),
        { name: 'Cancel', value: null },
    ];

    const selected = await select({
        message: `Select commit from ${chalk.green(currentBranch)}`,
        choices: commitChoices,
        pageSize: 12,
    });

    if (!selected) return;

    let ref = selected;
    if (selected === '__manual__') {
        const manual = await prompt('Enter commit hash or ref (e.g., HEAD~2):');
        if (!manual) return;
        ref = manual;
    }

    const action = await select({
        message: 'Choose action',
        choices: [
            { name: 'Checkout commit (detached HEAD)', value: 'detach' },
            { name: 'Reset --soft (keep changes staged)', value: 'soft' },
            { name: 'Reset --mixed (keep changes unstaged)', value: 'mixed' },
            { name: 'Reset --hard (discard changes)', value: 'hard' },
            { name: 'Cancel', value: 'cancel' },
        ],
    });

    if (action === 'cancel') return;

    await goToCommit(ref, action, false, true);
}

function getStashes() {
    try {
        const output = execGit('stash list', true);
        return output
            .split('\n')
            .filter(line => line.length > 0)
            .map(line => {
                const match = line.match(/^(stash@\{\d+\}):\s*(.*)$/);
                return {
                    ref: match ? match[1] : line.split(':')[0],
                    description: match ? match[2] : line,
                };
            });
    } catch {
        return [];
    }
}

async function showStashMenu() {
    while (true) {
        clearScreen();
        printHeader('Stash Manager');

        const choice = await select({
            message: 'Choose an action',
            choices: [
                { name: 'List stashes', value: 'list' },
                { name: 'Apply a stash', value: 'apply' },
                { name: 'Pop a stash', value: 'pop' },
                { name: 'Drop a stash', value: 'drop' },
                { name: 'Create new stash', value: 'create' },
                { name: 'Back', value: 'back' },
            ],
        });

        if (choice === 'back') {
            return;
        }

        const stashes = getStashes();

        if (choice === 'list') {
            if (stashes.length === 0) {
                logWarning('No stashes found.');
            } else {
                log('\n  Stashes:\n');
                stashes.forEach(stash => {
                    log(`    ${chalk.yellow(stash.ref)} - ${stash.description}`);
                });
            }
            await pause();
            continue;
        }

        if (choice === 'create') {
            const message = await prompt('Stash message (optional):', { default: '' });
            const includeUntracked = await confirm('Include untracked files?');
            let cmd = 'stash push';
            if (message) {
                cmd += ` -m ${shellQuote(message)}`;
            }
            if (includeUntracked) {
                cmd += ' -u';
            }

            try {
                execGit(cmd);
                logSuccess('Stash created.');
            } catch (error) {
                logError(`Failed to create stash: ${error.message}`);
            }
            await pause();
            continue;
        }

        if (stashes.length === 0) {
            logWarning('No stashes available.');
            await pause();
            continue;
        }

        const stashChoices = [
            ...stashes.map(stash => ({
                name: `${chalk.yellow(stash.ref)} - ${stash.description}`,
                value: stash.ref,
            })),
            { name: 'Cancel', value: null },
        ];

        const selected = await select({
            message: 'Select a stash',
            choices: stashChoices,
            pageSize: 10,
        });

        if (!selected) {
            continue;
        }

        const confirmAction = await confirm(`Proceed with ${choice} on ${selected}?`);
        if (!confirmAction) {
            continue;
        }

        try {
            if (choice === 'apply') {
                execGit(`stash apply ${selected}`);
                logSuccess(`Applied ${selected}.`);
            } else if (choice === 'pop') {
                execGit(`stash pop ${selected}`);
                logSuccess(`Popped ${selected}.`);
            } else if (choice === 'drop') {
                execGit(`stash drop ${selected}`);
                logSuccess(`Dropped ${selected}.`);
            }
        } catch (error) {
            logError(`Failed to ${choice} stash: ${error.message}`);
        }

        await pause();
    }
}

function getLocalBranchesByMergeState(merged = true) {
    const flag = merged ? '--merged' : '--no-merged';
    try {
        const output = execGit(`branch ${flag}`, true);
        return output
            .split('\n')
            .map(line => line.replace('*', '').trim())
            .filter(line => line.length > 0);
    } catch {
        return [];
    }
}

async function showRemoteSyncMenu() {
    if (!isInteractiveSession()) {
        logError('Remote sync requires an interactive TTY.');
        return;
    }

    clearScreen();
    printHeader('Sync Remote Repos');

    const remotes = Object.keys(getRemotes());
    if (remotes.length < 2) {
        logError('At least two remotes are required to sync.');
        await pause();
        return;
    }

    const sourceRemote = await select({
        message: 'Select source remote',
        choices: [...remotes.map(name => ({ name, value: name })), { name: 'Cancel', value: null }],
    });
    if (!sourceRemote) return;

    const targetRemote = await select({
        message: 'Select target remote',
        choices: [
            ...remotes.filter(r => r !== sourceRemote).map(name => ({ name, value: name })),
            { name: 'Cancel', value: null },
        ],
    });
    if (!targetRemote) return;

    // Fetch latest
    try {
        execGitWithSpinner(`fetch ${sourceRemote}`, `Fetching ${sourceRemote}...`);
        execGitWithSpinner(`fetch ${targetRemote}`, `Fetching ${targetRemote}...`);
    } catch (error) {
        logWarning(`Fetch warning: ${error.message}`);
    }

    const branches = getRemoteBranches(sourceRemote);
    if (branches.length === 0) {
        logError(`No branches found on ${sourceRemote}.`);
        await pause();
        return;
    }

    const branch = await select({
        message: `Select branch to sync from ${sourceRemote}`,
        choices: [...branches.map(name => ({ name, value: name })), { name: 'Cancel', value: null }],
        pageSize: 12,
    });
    if (!branch) return;

    const sourceRef = `${sourceRemote}/${branch}`;
    const targetRef = `${targetRemote}/${branch}`;

    const remoteSourceSha = getRemoteHeadSha(sourceRemote, branch);
    if (!remoteSourceSha) {
        logError(`Source branch not found on ${sourceRemote}: ${branch}`);
        await pause();
        return;
    }

    const remoteTargetSha = getRemoteHeadSha(targetRemote, branch);
    if (!remoteTargetSha) {
        logWarning(`Target branch ${targetRef} does not exist. It will be created.`);
    }

    const sourceFetched = ensureRemoteBranchFetched(sourceRemote, branch);
    if (!sourceFetched) {
        logError(`Unable to resolve source ref: ${sourceRef}`);
        logWarning(`Try: git fetch ${sourceRemote} ${branch}`);
        await pause();
        return;
    }

    const targetFetched = remoteTargetSha ? ensureRemoteBranchFetched(targetRemote, branch) : true;
    if (remoteTargetSha && !targetFetched) {
        logWarning(`Unable to resolve target ref: ${targetRef}. Proceeding with remote SHA only.`);
    }

    const sourceSha = resolveCommit(sourceRef);
    const targetSha = resolveCommit(targetRef);

    const canFastForward = targetSha ? isAncestor(targetRef, sourceRef) : true;
    const counts = targetSha ? getAheadBehind(targetRef, sourceRef) : { left: 0, right: 0 };
    const ahead = counts.right;
    const behind = counts.left;

    const commitHashes = targetSha
        ? getCommitHashesBetween(targetRef, sourceRef)
        : execGit(`log --format=%H ${sourceRef}`, true).split('\n').filter(Boolean);
    const commits = commitHashes.map(hash => getCommitInfo(hash));

    await checkMergeSafetyForSync(commits, targetRef, sourceRef, canFastForward);

    // Review 1/3: Summary
    log('\n  Sync Summary:', chalk.bold);
    log(`  Source: ${chalk.cyan(sourceRef)} (${(sourceSha || remoteSourceSha).substring(0, 7)})`);
    log(`  Target: ${chalk.magenta(targetRef)} (${targetSha ? targetSha.substring(0, 7) : (remoteTargetSha ? remoteTargetSha.substring(0, 7) : 'new')})`);
    if (targetSha) {
        log(`  Ahead/Behind: ${chalk.green(sourceRemote)} is ${ahead} ahead, ${behind} behind ${chalk.green(targetRemote)}`);
    }
    if (!canFastForward) {
        logWarning('  Histories have diverged; fast-forward is not possible.');
    }

    const review1 = await confirm('Review 1/3: Continue to commit list?');
    if (!review1) {
        logWarning('Sync cancelled.');
        return;
    }

    // Review 2/3: Commit list
    if (commits.length === 0) {
        logWarning('No commits to sync.');
        return;
    }

    log('\n  Commits to sync:\n');
    commits.slice(0, 20).forEach(commit => {
        log(`    • ${chalk.yellow(commit.shortHash)} ${commit.message.substring(0, 70)}`);
    });
    if (commits.length > 20) {
        log(`    ... and ${commits.length - 20} more`, chalk.dim);
    }

    const review2 = await confirm('Review 2/3: Continue to diff summary?');
    if (!review2) {
        logWarning('Sync cancelled.');
        return;
    }

    // Review 3/3: Diff summary
    try {
        const diffRange = targetSha ? `${targetRef}..${sourceRef}` : sourceRef;
        const diffStat = execGit(`diff --stat ${diffRange}`, true);
        if (diffStat.trim().length > 0) {
            log('\n  Diff Summary:\n');
            console.log(diffStat);
        } else {
            log('\n  No file differences detected.');
        }
    } catch (error) {
        logWarning(`Could not load diff summary: ${error.message}`);
    }

    const review3 = await confirm('Review 3/3: Perform sync now?');
    if (!review3) {
        logWarning('Sync cancelled.');
        return;
    }

    let force = false;
    if (!canFastForward) {
        force = await confirm('Non-fast-forward sync detected. Force push with --force-with-lease?');
        if (!force) {
            logWarning('Sync cancelled.');
            return;
        }
    }

    const pushArgs = force ? '--force-with-lease ' : '';
    try {
        execGitWithSpinner(
            `push ${pushArgs}${targetRemote} ${sourceRef}:refs/heads/${branch}`,
            `Syncing ${sourceRemote}/${branch} → ${targetRemote}/${branch}...`
        );
    } catch (error) {
        logError(`Sync failed: ${error.message}`);
        return;
    }

    // Verify history matches
    try {
        const newTargetSha = getRemoteHeadSha(targetRemote, branch);
        const newSourceSha = getRemoteHeadSha(sourceRemote, branch);
        if (newTargetSha && newSourceSha && newTargetSha === newSourceSha) {
            logSuccess('Sync complete. Commit history matches.');
        } else {
            logWarning('Sync completed, but commit history does not match.');
        }
    } catch (error) {
        logWarning(`Could not verify history: ${error.message}`);
    }

    await pause();
}

async function showBranchCleanupMenu() {
    const protectedBranches = new Set(['main', 'master', 'develop', 'release', 'trunk']);
    const currentBranch = getCurrentBranch();

    while (true) {
        clearScreen();
        printHeader('Branch Cleanup');

        const choice = await select({
            message: 'Choose cleanup action',
            choices: [
                { name: 'Delete merged branches (safe)', value: 'merged' },
                { name: 'Force delete unmerged branches (danger)', value: 'force' },
                { name: 'Back', value: 'back' },
            ],
        });

        if (choice === 'back') {
            return;
        }

        const merged = choice === 'merged';
        const branches = getLocalBranchesByMergeState(merged).filter(branch => {
            if (branch === currentBranch) return false;
            if (protectedBranches.has(branch)) return false;
            return true;
        });

        if (branches.length === 0) {
            logWarning('No branches eligible for cleanup.');
            await pause();
            continue;
        }

        const selected = await checkbox({
            message: merged ? 'Select merged branches to delete' : 'Select unmerged branches to force delete',
            choices: branches.map(branch => ({
                name: branch,
                value: branch,
            })),
            pageSize: 12,
        });

        if (!selected || selected.length === 0) {
            continue;
        }

        const confirmDelete = await confirm(`Delete ${selected.length} branch(es)?`);
        if (!confirmDelete) {
            continue;
        }

        const deleteFlag = merged ? '-d' : '-D';
        for (const branch of selected) {
            try {
                execGit(`branch ${deleteFlag} ${branch}`);
                logSuccess(`Deleted ${branch}`);
            } catch (error) {
                logError(`Failed to delete ${branch}: ${error.message}`);
            }
        }

        await pause();
    }
}

function openInEditor(file) {
    const editor = process.env.EDITOR || process.env.VISUAL;
    if (!editor) {
        logError('No editor found. Set $EDITOR or $VISUAL.');
        return false;
    }
    try {
        execSync(`${editor} ${shellQuote(file)}`, {
            stdio: 'inherit',
            shell: true,
        });
        return true;
    } catch (error) {
        logError(`Failed to open editor: ${error.message}`);
        return false;
    }
}

async function showConflictMenu() {
    if (!isInteractiveSession()) {
        logWarning('Conflicts detected. Resolve manually and run git cherry-pick --continue or --abort.');
        return;
    }
    let conflictedFiles = getConflictedFiles();
    clearScreen();
    printHeader('Conflict Helper');

    if (conflictedFiles.length === 0) {
        logSuccess('No conflicted files detected.');
        await pause();
        return;
    }

    while (true) {
        const choice = await select({
            message: `Conflicted files: ${conflictedFiles.length}`,
            choices: [
                { name: 'Open conflicted file', value: 'open' },
                { name: 'Continue (after resolving)', value: 'continue' },
                { name: 'Abort cherry-pick', value: 'abort' },
                { name: 'Refresh list', value: 'refresh' },
                { name: 'Back', value: 'back' },
            ],
        });

        if (choice === 'back') {
            return;
        }

        if (choice === 'refresh') {
            conflictedFiles = getConflictedFiles();
            if (conflictedFiles.length === 0) {
                logSuccess('No conflicted files detected.');
                await pause();
                return;
            }
            continue;
        }

        if (choice === 'open') {
            const file = await select({
                message: 'Select a file to open',
                choices: [
                    ...conflictedFiles.map(name => ({ name, value: name })),
                    { name: 'Cancel', value: null },
                ],
                pageSize: 12,
            });
            if (!file) continue;
            openInEditor(file);
            continue;
        }

        if (choice === 'continue') {
            try {
                execGit('cherry-pick --continue');
                logSuccess('Cherry-pick continued.');
                await pause();
                return;
            } catch (error) {
                logError(`Could not continue: ${error.message}`);
                conflictedFiles = getConflictedFiles();
                if (conflictedFiles.length === 0) {
                    await pause();
                    return;
                }
            }
        }

        if (choice === 'abort') {
            try {
                execGit('cherry-pick --abort');
                logSuccess('Cherry-pick aborted.');
                await pause();
                return;
            } catch (error) {
                logError(`Could not abort: ${error.message}`);
                await pause();
            }
        }
    }
}

async function showUtilitiesMenu() {
    if (!isInteractiveSession()) {
        logError('Utilities menu requires an interactive TTY.');
        return;
    }
    while (true) {
        clearScreen();
        printHeader('git-ui - Developer Utilities');

        const choice = await select({
            message: 'Choose an option',
            choices: [
                { name: 'Sync two remotes', value: 'sync' },
                { name: 'Revert last N commits', value: 'revert' },
                { name: 'Go to a specific commit', value: 'goto' },
                { name: 'View git tree', value: 'tree' },
                { name: 'Show git status', value: 'status' },
                { name: 'Show recent commits', value: 'log' },
                { name: 'Compare branches', value: 'compare' },
                { name: 'Stash manager', value: 'stash' },
                { name: 'Branch cleanup', value: 'cleanup' },
                { name: 'Conflict helper', value: 'conflicts' },
                { name: 'Exit', value: 'exit' },
            ],
        });

        switch (choice) {
            case 'sync':
                await showRemoteSyncMenu();
                break;
            case 'revert':
                await revertCommitsMenu();
                break;
            case 'goto':
                await goToCommitMenu();
                break;
            case 'tree':
                await showGitTree(50, true);
                break;
            case 'status':
                await showStatus(true);
                break;
            case 'log':
                await showRecentLog(20, true);
                break;
            case 'compare':
                await compareBranchesMenu();
                break;
            case 'stash':
                await showStashMenu();
                break;
            case 'cleanup':
                await showBranchCleanupMenu();
                break;
            case 'conflicts':
                await showConflictMenu();
                break;
            case 'exit':
                return;
            default:
                return;
        }
    }
}

// ============================================================
// INTERACTIVE MODE
// ============================================================

async function runInteractiveMode() {
    if (!isInteractiveSession()) {
        logError('Interactive mode requires an interactive TTY.');
        return;
    }
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
        log(`\n  Current branch: ${chalk.green(currentBranch)}`);
        log(`  Selected commits: ${chalk.cyan(selectedCommits.length)}`);
        log(`  Selected remotes: ${chalk.cyan(selectedRemotes.length > 0 ? selectedRemotes.join(', ') : 'none')}`);
        log(`  Target branch: ${chalk.magenta(targetBranch)}`);

        const choice = await select({
            message: 'Choose an option',
            choices: [
                { name: 'Switch branch', value: 'switch' },
                { name: 'Select commits to cherry-pick', value: 'commits' },
                { name: 'Select target remotes', value: 'remotes' },
                { name: 'Set target branch name', value: 'target' },
                { name: 'Add new remote', value: 'add-remote' },
                { name: 'Execute cherry-pick and push', value: 'execute' },
                { name: 'Reset selections', value: 'reset' },
                { name: 'Check merge safety', value: 'safety' },
                { name: 'Exit', value: 'exit' },
            ],
        });

        switch (choice) {
            case 'switch':
                await switchBranchMenu();
                break;
            case 'commits':
                selectedCommits = await selectCommitsMenu(selectedCommits);
                break;
            case 'remotes':
                selectedRemotes = await selectRemotesMenu(selectedRemotes);
                break;
            case 'target':
                targetBranch = await setTargetBranchMenu(targetBranch);
                break;
            case 'add-remote':
                await addRemoteMenu();
                break;
            case 'execute':
                if (selectedCommits.length === 0) {
                    logError('No commits selected!');
                    await pause();
                } else if (selectedRemotes.length === 0) {
                    logError('No remotes selected!');
                    await pause();
                } else {
                    await executeInteractiveCherryPick(selectedCommits, selectedRemotes, targetBranch);
                    return;
                }
                break;
            case 'reset':
                selectedCommits = [];
                selectedRemotes = [];
                targetBranch = 'release';
                logSuccess('All selections reset');
                await pause();
                break;
            case 'safety':
                if (selectedCommits.length === 0) {
                    logError('No commits selected!');
                    await pause();
                } else {
                    const checkRemote = selectedRemotes.length > 0 ? selectedRemotes[0] : 'origin';
                    await checkMergeSafety(selectedCommits, checkRemote, targetBranch);
                }
                break;
            case 'exit':
            default:
                log('\nGoodbye!', chalk.cyan);
                return;
        }
    }
}

async function switchBranchMenu() {
    const branch = await selectBranchPrompt('Switch Branch');
    if (!branch) return;

    try {
        execGit(`checkout ${branch}`);
        logSuccess(`Switched to ${branch}`);
    } catch (e) {
        logError(`Failed to switch: ${e.message}`);
    }

    await pause();
}

async function selectCommitsMenu(preselected = []) {
    clearScreen();
    printSubHeader('Select Commits');

    const currentBranch = getCurrentBranch();
    const commits = getCommitsFromBranch(currentBranch, 30);
    return await selectCommitsFromList(
        commits,
        `Select commits from ${chalk.green(currentBranch)}`,
        preselected
    );
}

async function selectRemotesMenu(preselected = []) {
    clearScreen();
    printSubHeader('Select Target Remotes');

    const remotes = getRemotes();
    const remoteNames = Object.keys(remotes);

    if (remoteNames.length === 0) {
        logError('No remotes configured');
        await pause();
        return [];
    }

    const preselectedSet = new Set(preselected);
    const choices = remoteNames.map(name => {
        const url = remotes[name].push || remotes[name].fetch || 'unknown';
        return {
            name: `${chalk.cyan(name)} ${chalk.dim(url)}`,
            value: name,
            checked: preselectedSet.has(name),
        };
    });

    const selected = await checkbox({
        message: 'Select target remotes',
        choices,
        pageSize: 10,
    });

    return selected || [];
}

async function setTargetBranchMenu(current) {
    clearScreen();
    printSubHeader('Set Target Branch');

    log(`\n  Current target: ${chalk.magenta(current)}`);

    const input = await prompt('Target branch (leave blank to keep current):', { default: current });
    const next = input.trim() === '' ? current : input.trim();

    if (next !== current) {
        logSuccess(`Target branch set to: ${next}`);
        await pause();
    }
    return next;
}

async function addRemoteMenu() {
    clearScreen();
    printSubHeader('Add New Remote');

    const name = await prompt('Remote name:');
    if (!name) return;

    const url = await prompt('Remote URL:');
    if (!url) return;

    try {
        execGit(`remote add ${name} ${url}`);
        logSuccess(`Added remote: ${name} → ${url}`);
    } catch (e) {
        logError(`Failed to add remote: ${e.message}`);
    }

    await pause();
}

async function executeInteractiveCherryPick(commits, remotes, targetBranch) {
    clearScreen();
    printHeader('Execute Cherry-Pick');

    log('\n  Summary:', chalk.bold);
    log(`  • Commits: ${commits.length}`);
    commits.forEach(c => log(`      ${c.shortHash} - ${c.message.substring(0, 40)}`));
    log(`  • Target branch: ${targetBranch}`);
    log(`  • Push to: ${remotes.join(', ')}`);

    const proceed = await confirm('\n  Proceed with cherry-pick and push?');
    if (!proceed) {
        log('\nOperation cancelled.', chalk.yellow);
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

        log(`\n${'═'.repeat(60)}`, chalk.green);
        log('  SUCCESS! Cherry-pick release complete.', chalk.green.bold);
        log(`${'═'.repeat(60)}`, chalk.green);

    } catch (error) {
        logError(`\nError: ${error.message}`);
        const conflicts = getConflictedFiles();
        if (conflicts.length > 0) {
            await showConflictMenu();
        } else {
            logWarning('You may need to resolve conflicts manually.');
            logWarning('Run: git cherry-pick --continue  OR  git cherry-pick --abort');
        }
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

        log('  Switching to develop branch...', chalk.blue);
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

        if (!isInteractiveSession()) {
            if (!dryRun && !skipAllConfirm) {
                logError('Non-interactive session detected. Use --yes or --dry-run.');
                process.exit(1);
            }
            skipAllConfirm = true;
            if (selectedCommits.length === 0) {
                logError('No commits selected. Provide a commit count (e.g., git-ui 3).');
                process.exit(1);
            }
            await executeQuickRelease(selectedCommits, dryRun);
            return;
        }

        // Menu loop
        while (true) {
            clearScreen();
            printSubHeader('Quick Release Menu');

            const hasLiveRemote = remoteExists('live');

            log(`\n  Selected commits: ${chalk.cyan(selectedCommits.length)}`);
            if (selectedCommits.length > 0) {
                selectedCommits.slice(0, 5).forEach(c => {
                    log(`    • ${chalk.yellow(c.shortHash)} - ${c.date} - ${c.message.substring(0, 40)}`);
                });
                if (selectedCommits.length > 5) {
                    log(`    ... and ${selectedCommits.length - 5} more`, chalk.dim);
                }
            }

            log(`\n  Target: ${chalk.magenta('origin/release')}${hasLiveRemote ? ` + ${chalk.magenta('live/release')}` : ''}`);

            const choice = await select({
                message: 'Quick Release options',
                choices: [
                    { name: 'Select commits', value: 'select' },
                    { name: 'Check merge safety', value: 'safety' },
                    { name: 'Reset selection', value: 'reset' },
                    { name: 'Execute cherry-pick', value: 'execute' },
                    { name: 'Exit', value: 'exit' },
                ],
            });

            switch (choice) {
                case 'select':
                    selectedCommits = await selectCommitsFromList(
                        allCommits,
                        `Select commits from ${chalk.green('origin/develop')}`,
                        selectedCommits
                    );
                    break;
                case 'safety':
                    if (selectedCommits.length === 0) {
                        logError('No commits selected!');
                        await pause();
                    } else {
                        await checkMergeSafety(selectedCommits, 'origin', 'release');
                    }
                    break;
                case 'reset':
                    selectedCommits = [];
                    logSuccess('Selection cleared');
                    await pause();
                    break;
                case 'execute':
                    if (selectedCommits.length === 0) {
                        logError('No commits selected!');
                        await pause();
                    } else {
                        await executeQuickRelease(selectedCommits, dryRun);
                        return;
                    }
                    break;
                case 'exit':
                default:
                    log('\nGoodbye!', chalk.cyan);
                    return;
            }
        }

    } catch (error) {
        logError(`\nError: ${error.message}`);
        process.exit(1);
    }
}

async function executeQuickRelease(commits, dryRun = false) {
    clearScreen();
    printHeader('Execute Quick Release');

    const hasLiveRemote = remoteExists('live');

    log('\n  Summary:', chalk.bold);
    log(`  • Commits: ${commits.length}`);
    commits.forEach(c => log(`      ${c.shortHash} - ${c.message.substring(0, 40)}`));
    log(`  • Push to: origin/release${hasLiveRemote ? ', live/release' : ''}`);

    const proceed = await confirm('\n  Proceed with cherry-pick and push?');
    if (!proceed) {
        log('\nOperation cancelled.', chalk.yellow);
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
            log('\n  Restoring original branch...', chalk.blue);
            execGit(`checkout ${originalBranch}`);
            logSuccess(`Restored to ${originalBranch}`);
        }

        // Success
        log(`\n${'═'.repeat(60)}`, chalk.green);
        log('  SUCCESS! Quick release complete.', chalk.green.bold);
        log(`${'═'.repeat(60)}`, chalk.green);
        log(`\n  Summary:`);
        log(`    • Cherry-picked ${commits.length} commit(s)`);
        log(`    • Pushed to origin/release`);
        if (hasLiveRemote) {
            log(`    • Pushed to live/release`);
        }
        log('');

    } catch (error) {
        logError(`\nError: ${error.message}`);
        const conflicts = getConflictedFiles();
        if (conflicts.length > 0) {
            await showConflictMenu();
        }
    }
}

// ============================================================
// MAIN MENU
// ============================================================

async function showMainMenu() {
    if (!isInteractiveSession()) {
        logError('Main menu requires an interactive TTY.');
        return;
    }
    printHeader('git-ui');

    const choice = await select({
        message: 'Select mode',
        choices: [
            { name: 'Quick Release - Cherry-pick from develop to release', value: 'quick' },
            { name: 'Interactive Mode - Full control over branches, commits, and remotes', value: 'interactive' },
            { name: 'Utilities - Useful git commands for developers', value: 'utilities' },
            { name: 'Exit', value: 'exit' },
        ],
    });

    switch (choice) {
        case 'quick':
            await runQuickRelease();
            break;
        case 'interactive':
            await runInteractiveMode();
            break;
        case 'utilities':
            await showUtilitiesMenu();
            break;
        case 'exit':
        default:
            log('\nGoodbye!', chalk.cyan);
            break;
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
${chalk.bold('git-ui')} - Cherry-pick commits from develop to release

${chalk.cyan('Usage:')}
  git-ui               Show mode selection menu
  git-ui <k>           Quick release: cherry-pick last k commits
  git-ui -i            Launch interactive mode directly
  git-ui -u            Launch utilities menu
  git-ui --tree [n]    Show git tree (default 50 commits)
  git-ui --status      Show git status (short)
  git-ui --log [n]     Show recent commits (default 20)
  git-ui --revert <k>  Revert last k commits on current branch
  git-ui --goto <ref>  Go to commit (default: detached HEAD)
  git-ui --sync        Sync two remotes (interactive)
                                   Optional: --soft, --mixed, --hard

${chalk.cyan('Quick Release Options:')}
  -h, --help        Show this help message
  -y, --yes         Skip confirmation prompts
  --dry-run         Show what would be done without making changes

${chalk.cyan('Example:')}
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

    if (args.includes('--sync')) {
        await showRemoteSyncMenu();
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
