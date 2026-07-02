import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_RC, loadRc, mergeRc, resolveTokensPath } from './rc.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'axaraaudit-rc-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadRc', () => {
  it('falls back to defaults when no rc file exists', () => {
    const { rc, rcPath } = loadRc(dir);
    expect(rcPath).toBeNull();
    expect(rc.ci.failUnder).toBe(DEFAULT_RC.ci.failUnder);
    expect(rc.project).not.toBe(''); // derived from folder name
  });

  it('merges partial sections over defaults', () => {
    writeFileSync(
      join(dir, '.auditorrc.json'),
      JSON.stringify({ project: 'demo', ci: { failUnder: 95 } }),
    );
    const { rc } = loadRc(dir);
    expect(rc.project).toBe('demo');
    expect(rc.ci.failUnder).toBe(95);
    expect(rc.ci.blockOnCritical).toBe(true); // untouched default
    expect(rc.rgaa.enabled).toBe(true);
  });

  it('tolerates a UTF-8 BOM', () => {
    writeFileSync(join(dir, '.auditorrc.json'), `﻿${JSON.stringify({ project: 'bom' })}`);
    expect(loadRc(dir).rc.project).toBe('bom');
  });

  it('throws ConfigError on invalid JSON', () => {
    writeFileSync(join(dir, '.auditorrc.json'), '{ nope');
    expect(() => loadRc(dir)).toThrow(ConfigError);
  });

  it('throws ConfigError when an explicit path is missing', () => {
    expect(() => loadRc(dir, 'missing.json')).toThrow(ConfigError);
  });
});

describe('resolveTokensPath', () => {
  it('throws a helpful error when the tokens file is absent', () => {
    const loaded = loadRc(dir);
    expect(() => resolveTokensPath(loaded)).toThrow(/axaraaudit init/);
  });

  it('resolves relative to the root dir', () => {
    writeFileSync(join(dir, 'tokens.json'), '{}');
    writeFileSync(join(dir, '.auditorrc.json'), JSON.stringify({ tokens: './tokens.json' }));
    const loaded = loadRc(dir);
    expect(resolveTokensPath(loaded)).toBe(join(dir, 'tokens.json'));
  });
});

describe('mergeRc', () => {
  it('lets a remote partial override nested fields without erasing siblings', () => {
    const merged = mergeRc(DEFAULT_RC, { rgaa: { priority: ['1.1'] }, pro: { upload: true } });
    expect(merged.rgaa.priority).toEqual(['1.1']);
    expect(merged.rgaa.enabled).toBe(true);
    expect(merged.pro.upload).toBe(true);
    expect(merged.pro.apiUrl).toBe(DEFAULT_RC.pro.apiUrl);
  });
});
