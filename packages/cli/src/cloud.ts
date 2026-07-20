/**
 * Feature flag Axara Cloud — désactivé pour le moment.
 *
 * Tant que le cloud n'est pas ouvert au public, les commandes de compte
 * (push, login, logout, whoami) et les flags Pro (--remote, --upload)
 * sont masqués du catalogue (aide, palette, complétions) et refusés au
 * dispatch. `AXARA_CLOUD=1` réactive le tout (dev/test interne).
 *
 * Cloud feature flag — disabled for now. While the cloud is not publicly
 * open, account commands (push, login, logout, whoami) and Pro flags
 * (--remote, --upload) are hidden from the catalog (help, palette,
 * completions) and rejected at dispatch. `AXARA_CLOUD=1` re-enables
 * everything (internal dev/test).
 */

export const CLOUD_ENABLED: boolean = process.env['AXARA_CLOUD'] === '1';

/** Commandes entièrement cloud — masquées et refusées quand le flag est off. */
export const CLOUD_COMMANDS: ReadonlySet<string> = new Set(['push', 'login', 'logout', 'whoami']);
