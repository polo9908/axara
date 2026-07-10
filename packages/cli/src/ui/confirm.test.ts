import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { confirmYesNo } from './confirm.js';

/** Faux stdin : émetteur + API raw-mode minimale. */
function fakeStdin(): NodeJS.ReadStream {
  const emitter = new EventEmitter() as unknown as NodeJS.ReadStream & {
    setRawMode: (v: boolean) => void;
    resume: () => void;
    pause: () => void;
    setEncoding: (enc: string) => void;
  };
  emitter.setRawMode = vi.fn();
  emitter.resume = vi.fn();
  emitter.pause = vi.fn();
  emitter.setEncoding = vi.fn();
  return emitter;
}

describe('confirmYesNo', () => {
  let stdin: NodeJS.ReadStream;
  let stdinSpy: ReturnType<typeof vi.spyOn>;
  let writeSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdin = fakeStdin();
    stdinSpy = vi.spyOn(process, 'stdin', 'get').mockReturnValue(stdin);
    writeSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdinSpy.mockRestore();
    writeSpy.mockRestore();
  });

  it.each([
    ['o', true],
    ['O', true],
    ['y', true],
    ['Y', true],
  ])('accepte sur « %s »', async (key, expected) => {
    const answer = confirmYesNo('Appliquer ?');
    stdin.emit('data', key);
    await expect(answer).resolves.toBe(expected);
  });

  it.each([
    ['Entrée', '\r'],
    ['n', 'n'],
    ['Échap', ''],
    ['Ctrl-C', ''],
    ['autre touche', 'x'],
  ])('refuse par défaut sur %s', async (_label, key) => {
    const answer = confirmYesNo('Appliquer ?');
    stdin.emit('data', key);
    await expect(answer).resolves.toBe(false);
  });

  it('rend le mode raw et se détache après la réponse', async () => {
    const answer = confirmYesNo('Appliquer ?');
    stdin.emit('data', 'o');
    await answer;
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.setRawMode).toHaveBeenLastCalledWith(false);
    expect(stdin.pause).toHaveBeenCalled();
    // Une seconde touche après la réponse ne doit rien déclencher.
    expect(() => stdin.emit('data', 'o')).not.toThrow();
  });
});
