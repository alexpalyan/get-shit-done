/**
 * Regression tests for Gemini namespacing (PR #2768)
 * 
 * Verifies that slash commands are correctly converted to colon format (/gsd:)
 * while preserving URLs, file paths, and agent names.
 */

'use strict';

process.env.GSD_TEST_MODE = '1';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTempDir, cleanup } = require('./helpers.cjs');

const {
  convertSlashCommandsToGeminiMentions,
  convertClaudeToGeminiMarkdown,
  _resetGsdCommandRoster,
  install
} = require('../bin/install.js');

describe('Gemini Slash Command Namespacing (Regex)', () => {
  test('converts simple slash commands', () => {
    const input = 'Run /gsd-plan-phase to start.';
    const expected = 'Run /gsd:plan-phase to start.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });

  test('preserves URLs with /gsd- in them', () => {
    const input = 'Documentation: https://example.com/gsd-tools/info';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  // The roster check is the safety property: a token like /gsd-plan-phase IS
  // a known command name, but when it appears inside a URL path it must NOT
  // be converted. This pins that the roster check actually fires — a regex-only
  // approach without a roster would convert this incorrectly.
  test('preserves URLs even when path contains a KNOWN command name', () => {
    const input = 'See https://example.com/gsd-plan-phase for context.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves sub-paths: bin/gsd-tools.cjs', () => {
    const input = 'See bin/gsd-tools.cjs for details.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves sub-paths even when leaf is a KNOWN command name', () => {
    // bin/gsd-plan-phase looks like a known command but is a file path.
    // The leading / on a sub-path follows a non-slash char so the regex
    // boundary is the safety net here, not the roster.
    const input = 'Reference bin/gsd-plan-phase for details.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves root-relative paths with extensions: /gsd-tools.cjs', () => {
    const input = 'Load /gsd-tools.cjs now.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('preserves agent names: gsd-planner', () => {
    const input = 'The gsd-planner agent will help you.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), input);
  });

  test('converts commands in backticks', () => {
    const input = 'Run `/gsd-new-project` in a terminal.';
    const expected = 'Run `/gsd:new-project` in a terminal.';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });

  test('converts commands ending with punctuation', () => {
    const input = 'Run /gsd-help. Or /gsd-scan!';
    const expected = 'Run /gsd:help. Or /gsd:scan!';
    assert.strictEqual(convertSlashCommandsToGeminiMentions(input), expected);
  });

  test('roster has loaded — non-empty (would otherwise silently no-op all conversions)', () => {
    _resetGsdCommandRoster();
    // First conversion call lazily populates the roster. If it returned an
    // empty Set (because commands/gsd/ was not found), every conversion
    // becomes a no-op — exactly the bug this code exists to prevent.
    const result = convertSlashCommandsToGeminiMentions('Run /gsd-plan-phase.');
    assert.strictEqual(result, 'Run /gsd:plan-phase.',
      'Roster failed to load — all /gsd- conversions would silently no-op');
  });
});

describe('Gemini Markdown Processor', () => {
  test('handles command to TOML conversion', () => {
    const input = '---\ndescription: Test\n---\nRun /gsd-help.';
    const result = convertClaudeToGeminiMarkdown(input, { isCommand: true });
    assert.ok(result.includes('description = "Test"'), 'Should contain TOML description');
    assert.ok(result.includes('/gsd:help'), 'Should contain namespaced command');
  });
});

describe('Gemini Install (Behavioral)', () => {
  let tmpDir;
  let previousCwd;

  beforeEach(() => {
    tmpDir = createTempDir('gsd-gemini-test-');
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(previousCwd);
    cleanup(tmpDir);
  });

  test('install creates correct directory structure for Gemini', () => {
    // Run install in silent mode
    const oldLog = console.log;
    console.log = () => {};
    try {
      install(false, 'gemini');
    } finally {
      console.log = oldLog;
    }
    
    // Check if commands are in gsd/ folder inside .gemini/
    const commandsDir = path.join(tmpDir, '.gemini', 'commands', 'gsd');
    assert.ok(fs.existsSync(commandsDir), `Commands should be in ${commandsDir}`);
    
    // Check if agents are installed
    const agentsDir = path.join(tmpDir, '.gemini', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'Agents should be installed');
  });
});
