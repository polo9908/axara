/**
 * Notification de mise à jour — façon update-notifier, zéro dépendance,
 * jamais bloquante : le run courant lit le cache écrit par un run précédent ;
 * si le cache est périmé (> 24 h), un processus Node détaché interroge le
 * registre npm et réécrit le cache pour la prochaine fois. La notice
 * s'affiche au plus une fois par jour, jamais en CI ni hors TTY.
 * Désactivable : AXARA_NO_UPDATE_CHECK=1 ou `axaraaudit settings` (updateCheck).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { paintFg, stderrLevel } from './ansi.js';
import { BRAND } from './theme.js';
import { tr } from '../i18n.js';
import { readSettings } from '../config/settings.js';
import { CLI_VERSION } from '../version.js';

const CACHE_DIR = join(homedir(), '.axaraaudit');
const CACHE_FILE = join(CACHE_DIR, 'update-check.json');
const DAY_MS = 24 * 60 * 60 * 1000;
const REGISTRY_URL = 'https://registry.npmjs.org/@axaraaudit%2Fcli/latest';

interface UpdateCache {
  readonly latest: string;
  readonly checkedAt: string;
  readonly notifiedAt?: string;
}

/** `b` est-elle strictement plus récente que `a` ? (semver numérique simple). Exporté pour les tests. */
export function isNewer(a: string, b: string): boolean {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (db > da) return true;
    if (db < da) return false;
  }
  return false;
}

function readCache(): UpdateCache | null {
  try {
    const parsed = JSON.parse(readFileSync(CACHE_FILE, 'utf8')) as Partial<UpdateCache>;
    if (typeof parsed.latest !== 'string' || typeof parsed.checkedAt !== 'string') return null;
    return parsed as UpdateCache;
  } catch {
    return null;
  }
}

function olderThanADay(iso: string | undefined): boolean {
  if (iso === undefined) return true;
  const t = Date.parse(iso);
  return Number.isNaN(t) || Date.now() - t > DAY_MS;
}

/** Rafraîchit le cache dans un processus détaché — le CLI rend la main immédiatement. */
function refreshInBackground(): void {
  const script =
    `const dir=${JSON.stringify(CACHE_DIR)},file=${JSON.stringify(CACHE_FILE)};` +
    `fetch(${JSON.stringify(REGISTRY_URL)},{headers:{accept:'application/json'}})` +
    `.then(r=>r.ok?r.json():null)` +
    `.then(pkg=>{if(!pkg||typeof pkg.version!=='string')return;` +
    `const fs=require('node:fs');let prev={};try{prev=JSON.parse(fs.readFileSync(file,'utf8'))}catch{}` +
    `fs.mkdirSync(dir,{recursive:true});` +
    `fs.writeFileSync(file,JSON.stringify({...prev,latest:pkg.version,checkedAt:new Date().toISOString()}))})` +
    `.catch(()=>{});setTimeout(()=>process.exit(0),5000).unref();`;
  try {
    spawn(process.execPath, ['-e', script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    }).unref();
  } catch {
    // best effort — jamais d'échec visible pour l'utilisateur
  }
}

/**
 * À appeler en fin de run. Affiche (stderr) une notice d'une ligne si une
 * version plus récente est connue, puis programme le refresh du cache.
 */
export function maybeNotifyUpdate(): void {
  if (process.stdout.isTTY !== true || process.stderr.isTTY !== true) return;
  if (process.env['CI'] !== undefined || process.env['AXARA_NO_UPDATE_CHECK'] !== undefined) return;
  // Préférence persistée (`axaraaudit settings`) — même effet que la variable d'env.
  if (readSettings().updateCheck === false) return;

  const cache = readCache();
  if (cache !== null && isNewer(CLI_VERSION, cache.latest) && olderThanADay(cache.notifiedAt)) {
    process.stderr.write(
      `\n  ${paintFg('✦', BRAND.violet, stderrLevel)} ${paintFg(
        tr(
          `axaraaudit ${cache.latest} disponible (installé : ${CLI_VERSION})`,
          `axaraaudit ${cache.latest} available (installed: ${CLI_VERSION})`,
        ),
        BRAND.slate,
        stderrLevel,
      )} ${paintFg('→ npm i -g axaraaudit', BRAND.cyan, stderrLevel)}\n`,
    );
    try {
      mkdirSync(CACHE_DIR, { recursive: true });
      writeFileSync(
        CACHE_FILE,
        JSON.stringify({ ...cache, notifiedAt: new Date().toISOString() }),
      );
    } catch {
      // best effort
    }
  }

  if (cache === null || olderThanADay(cache.checkedAt)) refreshInBackground();
}
