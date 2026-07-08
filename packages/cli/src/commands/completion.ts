/**
 * `axaraaudit completion <bash|zsh|pwsh>` — scripts de complétion shell.
 *
 * Les scripts sont générés depuis le CATALOG de help.ts (source de vérité
 * unique) : sous-commandes au premier mot, flags de la commande ensuite.
 * Enregistrés pour les deux binaires (`axaraaudit` et `axa`).
 */

import { tr } from '../i18n.js';
import { GROUPS, type CommandSpec } from './help.js';

const ALL: readonly CommandSpec[] = GROUPS.flatMap((g) => g.commands);
const COMMAND_NAMES: readonly string[] = ALL.map((c) => c.name);
const BINARIES = 'axaraaudit axa';

/**
 * Extrait les flags complétables d'une spec :
 * `--format pretty|json` → `--format` ; `--remote / --upload` → les deux.
 * Exporté pour les tests.
 */
export function flagsOf(spec: CommandSpec): readonly string[] {
  return (spec.options ?? []).flatMap(([flag]) =>
    flag
      .split('/')
      .map((part) => part.trim().split(/[ =]/)[0] ?? '')
      .filter((f) => f.startsWith('--')),
  );
}

/** `brief` nettoyé pour un format `nom:description` (zsh _describe). */
function briefForZsh(spec: CommandSpec): string {
  return spec.brief.replace(/:/g, ' —').replace(/'/g, '’');
}

function bashScript(): string {
  const cases = ALL.map(
    (c) => `    ${c.name}) COMPREPLY=( $(compgen -W "${flagsOf(c).join(' ')}" -- "$cur") );;`,
  ).join('\n');
  return `# ${tr('complétion bash pour axaraaudit / axa', 'bash completion for axaraaudit / axa')} — eval "$(axaraaudit completion bash)"
_axaraaudit_completions() {
  local cur cmd
  cur="\${COMP_WORDS[COMP_CWORD]}"
  cmd="\${COMP_WORDS[1]}"
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${COMMAND_NAMES.join(' ')}" -- "$cur") )
    return
  fi
  case "$cmd" in
${cases}
    *) COMPREPLY=();;
  esac
}
complete -F _axaraaudit_completions ${BINARIES}
`;
}

function zshScript(): string {
  const entries = ALL.map((c) => `    '${c.name}:${briefForZsh(c)}'`).join('\n');
  const cases = ALL.map((c) => `      ${c.name}) compadd -- ${flagsOf(c).join(' ')};;`).join('\n');
  return `# ${tr('complétion zsh pour axaraaudit / axa', 'zsh completion for axaraaudit / axa')} — eval "$(axaraaudit completion zsh)"
_axaraaudit() {
  local -a _axara_commands
  _axara_commands=(
${entries}
  )
  if (( CURRENT == 2 )); then
    _describe 'commande' _axara_commands
  else
    case "\${words[2]}" in
${cases}
      *) ;;
    esac
  fi
}
compdef _axaraaudit ${BINARIES}
`;
}

function pwshScript(): string {
  const table = ALL.map((c) => `    '${c.name}' = @(${flagsOf(c)
    .map((f) => `'${f}'`)
    .join(', ')})`).join('\n');
  return `# ${tr('complétion PowerShell pour axaraaudit / axa', 'PowerShell completion for axaraaudit / axa')}
# ${tr('à ajouter dans $PROFILE :', 'add to $PROFILE:')} axaraaudit completion pwsh | Out-String | Invoke-Expression
Register-ArgumentCompleter -Native -CommandName axaraaudit, axa -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $flags = @{
${table}
  }
  $tokens = @($commandAst.CommandElements | ForEach-Object { $_.ToString() })
  $completions = if ($tokens.Count -le 1 -or ($tokens.Count -eq 2 -and "$wordToComplete" -ne '')) {
    $flags.Keys | Sort-Object
  } else {
    $flags[$tokens[1]]
  }
  $completions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {
    [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)
  }
}
`;
}

const SHELLS: Record<string, () => string> = {
  bash: bashScript,
  zsh: zshScript,
  pwsh: pwshScript,
  powershell: pwshScript,
};

/** Exporté pour les tests : script brut d'un shell donné. */
export function renderCompletion(shell: string): string | undefined {
  return SHELLS[shell]?.();
}

export function runCompletion(argv: readonly string[]): number {
  const shell = argv[0];
  const script = shell !== undefined ? renderCompletion(shell) : undefined;
  if (script === undefined) {
    process.stderr.write(
      `${tr('Usage :', 'Usage:')} axaraaudit completion <bash|zsh|pwsh>\n` +
        `  bash : eval "$(axaraaudit completion bash)"        (~/.bashrc)\n` +
        `  zsh  : eval "$(axaraaudit completion zsh)"         ${tr('(~/.zshrc, après compinit)', '(~/.zshrc, after compinit)')}\n` +
        `  pwsh : axaraaudit completion pwsh | Out-String | Invoke-Expression   ($PROFILE)\n`,
    );
    return 2;
  }
  process.stdout.write(script);
  return 0;
}
