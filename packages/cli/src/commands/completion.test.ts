import { describe, expect, it } from 'vitest';
import { flagsOf, renderCompletion } from './completion.js';
import { findCommand, GROUPS } from './help.js';

const NAMES = GROUPS.flatMap((g) => g.commands).map((c) => c.name);

describe('flagsOf', () => {
  it('extrait les flags simples et les valeurs énumérées', () => {
    const audit = findCommand('audit');
    expect(audit).toBeDefined();
    const flags = flagsOf(audit!);
    expect(flags).toContain('--format');
    expect(flags).toContain('--fail-under');
    expect(flags).not.toContain('pretty|json|html');
  });

  it('sépare les flags combinés « --remote / --upload »', () => {
    const flags = flagsOf(findCommand('audit')!);
    expect(flags).toContain('--remote');
    expect(flags).toContain('--upload');
  });

  it('retourne [] quand la commande n’a pas d’options', () => {
    expect(flagsOf(findCommand('blame')!)).toEqual([]);
  });
});

describe('renderCompletion', () => {
  it('bash : enregistre les deux binaires et toutes les commandes', () => {
    const script = renderCompletion('bash');
    expect(script).toContain('complete -F _axaraaudit_completions axaraaudit axa');
    for (const name of NAMES) expect(script).toContain(name);
  });

  it('zsh : compdef pour les deux binaires', () => {
    const script = renderCompletion('zsh');
    expect(script).toContain('compdef _axaraaudit axaraaudit axa');
    expect(script).toContain("'audit:");
  });

  it('pwsh : Register-ArgumentCompleter natif', () => {
    const script = renderCompletion('pwsh');
    expect(script).toContain('Register-ArgumentCompleter -Native -CommandName axaraaudit, axa');
    expect(script).toContain("'--format'");
  });

  it('powershell est un alias de pwsh, shell inconnu → undefined', () => {
    expect(renderCompletion('powershell')).toBe(renderCompletion('pwsh'));
    expect(renderCompletion('fish')).toBeUndefined();
  });
});
