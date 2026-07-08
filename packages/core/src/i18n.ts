/**
 * Bilingual (FR/EN) user-facing messages for the engine's errors.
 *
 * Unlike the CLI (which resolves the language once at import, from `--lang`
 * or `AXARA_LANG`), the engine is a library: it resolves lazily, per call,
 * from `AXARA_LANG` — which the CLI sets after its own resolution — falling
 * back to the system locale. The RGAA criterion wordings are NOT translated:
 * they are the official French referential.
 */

export function tr(fr: string, en: string): string {
  let lang = process.env['AXARA_LANG'];
  if (lang === undefined) {
    // Intl reflects the real OS locale; LANG/LC_ALL are only a fallback
    // (on Windows a leftover LANG=en_US from Git Bash is common noise).
    try {
      lang = Intl.DateTimeFormat().resolvedOptions().locale;
    } catch {
      lang = process.env['LC_ALL'] ?? process.env['LANG'] ?? 'en';
    }
  }
  return lang.toLowerCase().startsWith('fr') ? fr : en;
}
