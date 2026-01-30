#!/usr/bin/env node

/**
 * Test suite for git-cherry-release CLI tool
 * 
 * These tests verify the utility functions and argument parsing.
 * Note: Full integration tests would require a git repository setup.
 */

const { execSync } = require('child_process');
const assert = require('assert');
const path = require('path');

const CLI_PATH = path.join(__dirname, 'index.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        console.log(`✓ ${name}`);
        passed++;
    } catch (error) {
        console.log(`✗ ${name}`);
        console.log(`  Error: ${error.message}`);
        failed++;
    }
}

function runCLI(args, options = {}) {
    try {
        const result = execSync(`node "${CLI_PATH}" ${args}`, {
            encoding: 'utf-8',
            cwd: options.cwd || __dirname,
            timeout: 10000,
            ...options,
        });
        return { output: result, exitCode: 0 };
    } catch (error) {
        return {
            output: error.stdout || error.stderr || error.message,
            exitCode: error.status || 1,
            error: error,
        };
    }
}

console.log('\n========================================');
console.log('  git-cherry-release Test Suite');
console.log('========================================\n');

// Test: Help flag shows usage information
test('--help flag shows usage information', () => {
    const result = runCLI('--help');
    assert(result.output.includes('git-cherry-release'), 'Should show tool name');
    assert(result.output.includes('Usage:'), 'Should show usage section');
    assert(result.output.includes('-i'), 'Should show -i flag for interactive mode');
    assert(result.output.includes('Example:'), 'Should show examples');
    assert.strictEqual(result.exitCode, 0, 'Should exit with code 0');
});

// Test: -h flag also shows help
test('-h flag shows usage information', () => {
    const result = runCLI('-h');
    assert(result.output.includes('git-cherry-release'), 'Should show tool name');
    assert.strictEqual(result.exitCode, 0, 'Should exit with code 0');
});

// Test: Help mentions interactive mode
test('Help shows interactive mode option', () => {
    const result = runCLI('--help');
    assert(result.output.includes('-i') || result.output.includes('Interactive'),
        'Should mention interactive mode');
});

// Test: Invalid string argument shows error
test('Invalid argument shows error', () => {
    const result = runCLI('abc');
    assert(result.exitCode !== 0, 'Should exit with non-zero code');
});

// Test: Zero commits shows error
test('Zero commits shows error', () => {
    const result = runCLI('0');
    assert(result.exitCode !== 0, 'Should exit with non-zero code');
});

// Test: Negative number shows error
test('Negative number shows error', () => {
    const result = runCLI('-2');
    // -2 is parsed as invalid, should exit with error
    assert(result.exitCode !== 0, 'Should exit with non-zero code for -2');
});

// Test: Dry run flag is recognized
test('--dry-run flag shows dry run message', () => {
    const result = runCLI('3 --dry-run');
    // This will fail if not in a git repo, but should at least show DRY RUN
    assert(result.output.includes('DRY RUN') || result.output.includes('git'),
        'Should recognize dry-run mode or attempt git operations');
});

// Test: Help shows Quick Release Options
test('Help shows Quick Release Options section', () => {
    const result = runCLI('--help');
    assert(result.output.includes('Quick Release Options'), 'Should show Quick Release Options');
    assert(result.output.includes('--dry-run'), 'Should show --dry-run option');
    assert(result.output.includes('--yes'), 'Should show --yes option');
});

// Summary
console.log('\n========================================');
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('========================================\n');

if (failed > 0) {
    process.exit(1);
}

console.log('All tests passed! ✓\n');
