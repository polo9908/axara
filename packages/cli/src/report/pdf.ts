/**
 * Rapport PDF autonome (`axaraaudit export`) — zéro dépendance.
 *
 * On écrit le format PDF 1.4 à la main : polices standard Helvetica + Courier
 * (aucune incorporation nécessaire), encodage WinAnsi (couvre le français :
 * é è à ç œ…), flux de contenu texte + rectangles, xref exacte.
 *
 * Direction visuelle : dossier technique épuré — grille à 4 colonnes pour les
 * indicateurs clés, un seul repère de couleur violet (le petit carré devant
 * chaque section), du gris neutre pour le texte secondaire, du Courier pour
 * les données de code (chemins, propriétés CSS). Pas de dégradé ni de blocs
 * colorés : la couleur ne sert qu'à porter un sens (statut, sévérité).
 *
 * Les teintes de statut (vert/rouge/ambre) sont volontairement plus sombres
 * que celles du terminal (`ui/theme.ts`) : calibrées pour un contraste ≥ 4.5:1
 * sur papier blanc — cohérent avec un outil d'audit d'accessibilité.
 */

import type { AuditPayload } from './payload.js';
import type { DriftIssue } from '@axaraaudit/core';
import type { Rgb } from '../ui/ansi.js';
import { tr } from '../i18n.js';

// ── Encodage WinAnsi ───────────────────────────────────────────────────────

/** Caractères hors latin-1 présents dans WinAnsi (cp1252). */
const WINANSI_EXTRA: Readonly<Record<string, number>> = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e,
  '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

/** Remplacements lisibles pour les glyphes absents de WinAnsi. */
const FALLBACKS: Readonly<Record<string, string>> = {
  '→': '->', '←': '<-', '✓': 'OK', '✗': 'X', '✦': '*', '▸': '>', '↑': '^', '↓': 'v',
};

/**
 * Convertit une chaîne JS en octets WinAnsi, avec échappement PDF de ( ) \.
 * Les glyphes inconnus deviennent `?`. Exporté pour les tests.
 */
export function toPdfString(text: string): Buffer {
  const bytes: number[] = [];
  const push = (code: number): void => {
    if (code === 0x28 || code === 0x29 || code === 0x5c) bytes.push(0x5c); // \( \) \\
    bytes.push(code);
  };
  for (const ch of text) {
    const fallback = FALLBACKS[ch];
    if (fallback !== undefined) {
      for (const f of fallback) push(f.codePointAt(0) as number);
      continue;
    }
    const code = ch.codePointAt(0) as number;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) push(code);
    else if (WINANSI_EXTRA[ch] !== undefined) push(WINANSI_EXTRA[ch]);
    else push(0x3f); // ?
  }
  return Buffer.from(bytes);
}

// ── Largeurs approchées pour la césure ──────────────────────────────────────

const NARROW = new Set([...".,:;!|'`i l j t f r ( ) [ ] { } / \\ \" -".split(' ').join(''), ' ']);
const WIDE = new Set([...'MWm@%']);

/** Largeur estimée en « em » (Helvetica proportionnelle, ou Courier fixe). */
function charWidth(ch: string, mono: boolean): number {
  if (mono) return 0.6; // Courier : chasse fixe
  if (NARROW.has(ch)) return 0.32;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.53;
}

export function textWidth(text: string, size: number, mono = false): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch, mono);
  return em * size;
}

/** Coupe `text` en lignes tenant dans `maxWidth` points. Exporté pour les tests. */
export function wrapText(text: string, size: number, maxWidth: number, mono = false): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (textWidth(candidate, size, mono) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function truncate(text: string, size: number, maxWidth: number, mono = false): string {
  if (textWidth(text, size, mono) <= maxWidth) return text;
  let out = '';
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, size, mono) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

// ── Palette imprimée — contraste ≥ 4.5:1 sur papier blanc ──────────────────
//
// Volontairement distincte de BRAND (ui/theme.ts, calibrée pour un terminal
// sombre) : le vert/rouge/ambre du CLI sont trop clairs pour du texte noir
// sur blanc. Un auditeur d'accessibilité ne peut pas livrer un rapport
// illisible.

const INK: Rgb = { r: 20, g: 20, b: 24 };
const MUTED: Rgb = { r: 100, g: 100, b: 110 };
const HAIRLINE: Rgb = { r: 224, g: 224, b: 229 };
const ACCENT: Rgb = { r: 110, g: 70, b: 200 }; // violet de marque, assombri pour le texte
const GOOD: Rgb = { r: 20, g: 120, b: 70 };
const BAD: Rgb = { r: 196, g: 40, b: 40 };
const WARN: Rgb = { r: 150, g: 95, b: 0 };

// ── Écrivain PDF ───────────────────────────────────────────────────────────

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 60;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64;

type Font = 'F1' | 'F2' | 'F3' | 'F4'; // regular | bold | oblique | mono (Courier)

function col(c: Rgb): string {
  const f = (v: number): string => (v / 255).toFixed(3);
  return `${f(c.r)} ${f(c.g)} ${f(c.b)}`;
}

/** Assembleur de pages : flux de contenu + curseur vertical, saut de page auto. */
class PdfBuilder {
  private readonly pages: Buffer[][] = [];
  private chunks: Buffer[] = [];
  y = PAGE_H - MARGIN;

  constructor() {
    this.pages.push(this.chunks);
  }

  private op(source: string): void {
    this.chunks.push(Buffer.from(source, 'latin1'));
  }

  newPage(): void {
    this.chunks = [];
    this.pages.push(this.chunks);
    this.y = PAGE_H - MARGIN;
  }

  /** Garantit `height` points disponibles, sinon nouvelle page. */
  ensure(height: number): void {
    if (this.y - height < BOTTOM) this.newPage();
  }

  text(x: number, y: number, value: string, font: Font, size: number, color: Rgb): void {
    this.op(`BT /${font} ${size} Tf ${col(color)} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (`);
    this.chunks.push(toPdfString(value));
    this.op(`) Tj ET\n`);
  }

  rect(x: number, y: number, w: number, h: number, color: Rgb): void {
    this.op(`${col(color)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`);
  }

  /** Ligne de texte au curseur, avec avancée verticale. */
  line(value: string, font: Font, size: number, color: Rgb, indent = 0, lead = 1.5): void {
    this.ensure(size * lead);
    this.y -= size * lead;
    this.text(MARGIN + indent, this.y, value, font, size, color);
  }

  /** Paragraphe avec césure automatique. */
  paragraph(value: string, font: Font, size: number, color: Rgb, indent = 0): void {
    for (const l of wrapText(value, size, CONTENT_W - indent)) this.line(l, font, size, color, indent);
  }

  gap(points: number): void {
    this.y -= points;
  }

  /** Filet fin pleine largeur à la position courante — jamais épais, jamais coloré fort. */
  hairline(): void {
    this.rect(MARGIN, this.y, CONTENT_W, 0.75, HAIRLINE);
  }

  /** Sérialise le document complet (pages, polices, xref). */
  build(footer: (page: number, total: number) => string): Buffer {
    // Pied de page uniforme, maintenant que le nombre total est connu.
    const total = this.pages.length;
    this.pages.forEach((chunks, i) => {
      const saved = this.chunks;
      this.chunks = chunks;
      this.rect(MARGIN, BOTTOM - 20, CONTENT_W, 0.75, HAIRLINE);
      this.text(MARGIN, BOTTOM - 34, footer(i + 1, total), 'F1', 8, MUTED);
      this.chunks = saved;
    });

    const objects: Buffer[] = [];
    const push = (body: Buffer | string): number => {
      objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
      return objects.length; // numéros d'objets 1-based
    };

    const fontIds = (['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Courier'] as const).map((base) =>
      push(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`),
    );
    const fontRes = `<< /F1 ${fontIds[0]} 0 R /F2 ${fontIds[1]} 0 R /F3 ${fontIds[2]} 0 R /F4 ${fontIds[3]} 0 R >>`;

    const pagesId = objects.length + this.pages.length * 2 + 1; // réservé après pages+contenus
    const pageIds: number[] = [];
    for (const chunks of this.pages) {
      const content = Buffer.concat(chunks);
      const contentId = push(
        Buffer.concat([
          Buffer.from(`<< /Length ${content.length} >>\nstream\n`, 'latin1'),
          content,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
      pageIds.push(
        push(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
            `/Resources << /Font ${fontRes} >> /Contents ${contentId} 0 R >>`,
        ),
      );
    }
    push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`);
    const catalogId = push(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

    // Assemblage : en-tête, objets numérotés, table xref, trailer.
    const head = Buffer.from('%PDF-1.4\n%âãÏÓ\n', 'latin1');
    const parts: Buffer[] = [head];
    const offsets: number[] = [];
    let position = head.length;
    objects.forEach((body, i) => {
      offsets.push(position);
      const wrapped = Buffer.concat([
        Buffer.from(`${i + 1} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      parts.push(wrapped);
      position += wrapped.length;
    });
    const xref =
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
      offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
    parts.push(
      Buffer.from(
        `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${position}\n%%EOF\n`,
        'latin1',
      ),
    );
    return Buffer.concat(parts);
  }
}

// ── Contenu du rapport ─────────────────────────────────────────────────────

const IMPACT_LABEL: Readonly<Record<string, string>> = {
  critical: tr('critique', 'critical'),
  serious: tr('sérieux', 'serious'),
  moderate: tr('modéré', 'moderate'),
  minor: tr('mineur', 'minor'),
  unknown: tr('à qualifier', 'to assess'),
};

function impactColor(impact: string | null | undefined): Rgb {
  if (impact === 'critical' || impact === 'serious') return BAD;
  if (impact === 'moderate') return WARN;
  return MUTED;
}

/** En-tête de section : un seul repère de couleur (le carré), le reste en encre neutre. */
function heading(pdf: PdfBuilder, label: string): void {
  pdf.ensure(52);
  pdf.gap(32);
  pdf.rect(MARGIN, pdf.y - 8, 3.5, 9, ACCENT);
  pdf.text(MARGIN + 11, pdf.y, label, 'F2', 10.5, INK);
  pdf.gap(10);
  pdf.hairline();
  pdf.gap(16);
}

/** Une colonne de la grille d'indicateurs — même gabarit pour les 4 stats. */
function stat(pdf: PdfBuilder, x: number, value: string, valueColor: Rgb, label: string): void {
  pdf.text(x, pdf.y, value, 'F2', 23, valueColor);
  pdf.text(x, pdf.y - 16, label, 'F1', 8, MUTED);
}

/** Rend le rapport PDF complet. Exporté pour `export` et les tests. */
export function renderPdf(payload: AuditPayload): Buffer {
  const pdf = new PdfBuilder();
  const s = payload.drift.summary;
  const agg = payload.rgaa.aggregate;
  const date = new Date(payload.generatedAt);
  const dateLabel = date.toLocaleDateString(tr('fr-FR', 'en-GB'), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // — En-tête —
  pdf.line(tr("RAPPORT D'AUDIT", 'AUDIT REPORT'), 'F2', 9, ACCENT, 0, 1);
  pdf.gap(8);
  pdf.line(truncate(payload.project, 26, CONTENT_W), 'F2', 26, INK, 0, 1.15);
  pdf.gap(4);
  pdf.line(`${dateLabel} · ${payload.tool} v${payload.toolVersion}`, 'F1', 10, MUTED);
  pdf.gap(18);
  pdf.hairline();
  pdf.gap(30);

  // — Grille d'indicateurs clés (4 colonnes égales) —
  const colW = CONTENT_W / 4;
  const gateTone = !payload.gate.evaluated ? MUTED : payload.gate.passed ? GOOD : BAD;
  const gateValue = !payload.gate.evaluated
    ? '—'
    : payload.gate.passed
      ? tr('RÉUSSI', 'PASSED')
      : tr('ÉCHOUÉ', 'FAILED');
  pdf.ensure(40);
  stat(pdf, MARGIN, `${payload.score}/100`, INK, tr('SCORE', 'SCORE'));
  stat(pdf, MARGIN + colW, gateValue, gateTone, tr(`GATE · seuil ${payload.gate.failUnder}`, `GATE · threshold ${payload.gate.failUnder}`));
  stat(pdf, MARGIN + colW * 2, String(payload.drift.issues.length), INK, tr('DÉRIVES DESIGN', 'DESIGN DRIFT'));
  stat(
    pdf,
    MARGIN + colW * 3,
    payload.rgaa.enabled ? String(agg.totalFindings) : '—',
    INK,
    tr('CONSTATS RGAA', 'RGAA FINDINGS'),
  );
  pdf.gap(30);

  if (payload.gate.reasons.length > 0) {
    for (const reason of payload.gate.reasons) pdf.paragraph(`•  ${reason}`, 'F1', 9, MUTED);
    pdf.gap(4);
  }

  // — Synthèse —
  heading(pdf, tr('SYNTHÈSE', 'SUMMARY'));
  const summaryRows: readonly (readonly [string, string])[] = [
    [tr('Fichiers analysés', 'Files scanned'), String(s.filesScanned)],
    [
      tr('Répartition des dérives', 'Drift breakdown'),
      tr(`${s.errors} erreur(s) · ${s.warnings} avertissement(s)`, `${s.errors} error(s) · ${s.warnings} warning(s)`),
    ],
    [
      tr('Corrections automatiques', 'Automatic fixes'),
      tr(`${s.autoFixable} disponible(s) via fix --write`, `${s.autoFixable} available via fix --write`),
    ],
    payload.rgaa.enabled
      ? [
          tr('Critères RGAA', 'RGAA criteria'),
          tr(
            `${agg.criteriaFailed} non conforme(s) · ${agg.criteriaToReview} à vérifier`,
            `${agg.criteriaFailed} failed · ${agg.criteriaToReview} to review`,
          ),
        ]
      : [tr('RGAA 4.1', 'RGAA 4.1'), tr('non évalué (--skip-rgaa)', 'not evaluated (--skip-rgaa)')],
  ];
  for (const [label, value] of summaryRows) {
    pdf.ensure(20);
    pdf.y -= 19;
    pdf.text(MARGIN, pdf.y, label, 'F1', 10, MUTED);
    pdf.text(MARGIN + 190, pdf.y, value, 'F2', 10, INK);
  }

  // — Dérives par fichier —
  heading(pdf, tr('DÉRIVES DESIGN-TOKENS', 'DESIGN-TOKEN DRIFT'));
  if (payload.drift.issues.length === 0) {
    pdf.line(tr('Aucune dérive : toutes les valeurs passent par les tokens.', 'No drift: every value goes through the tokens.'), 'F1', 10, GOOD);
  } else {
    const byFile = new Map<string, DriftIssue[]>();
    for (const issue of payload.drift.issues) {
      const list = byFile.get(issue.file) ?? [];
      list.push(issue);
      byFile.set(issue.file, list);
    }
    for (const [file, issues] of byFile) {
      pdf.ensure(30);
      pdf.gap(14);
      pdf.line(truncate(file, 9.5, CONTENT_W, true), 'F4', 9.5, INK);
      pdf.gap(2);
      for (const issue of issues) {
        const target =
          issue.suggestion !== undefined
            ? `-> ${issue.suggestion.replacement}`
            : tr('(aucun token proche)', '(no nearby token)');
        pdf.ensure(15);
        pdf.y -= 14;
        pdf.rect(MARGIN + 12, pdf.y + 1.5, 3, 3, issue.severity === 'error' ? BAD : WARN);
        pdf.text(MARGIN + 24, pdf.y, `L${issue.line}`, 'F4', 8.5, MUTED);
        pdf.text(MARGIN + 56, pdf.y, truncate(`${issue.property}: ${issue.value}`, 8.5, 186, true), 'F4', 8.5, INK);
        pdf.text(
          MARGIN + 250,
          pdf.y,
          truncate(target, 8.5, CONTENT_W - 250, true),
          'F4',
          8.5,
          issue.autoFixable ? GOOD : MUTED,
        );
      }
    }
  }

  // — RGAA —
  if (payload.rgaa.enabled) {
    heading(pdf, tr('CONSTATS RGAA 4.1', 'RGAA 4.1 FINDINGS'));
    if (payload.rgaa.findings.length === 0) {
      pdf.line(tr('Aucun constat : rien à signaler sur les critères vérifiables statiquement.', 'No findings on statically checkable criteria.'), 'F1', 10, GOOD);
    } else {
      for (const finding of payload.rgaa.findings) {
        const impact = IMPACT_LABEL[finding.impact ?? 'unknown'] ?? String(finding.impact);
        pdf.ensure(44);
        pdf.gap(16);
        pdf.line(truncate(`${finding.criterion} — ${finding.criterionTitle}`, 10, CONTENT_W - 80), 'F2', 10, INK);
        pdf.text(PAGE_W - MARGIN - 66, pdf.y, impact, 'F2', 8.5, impactColor(finding.impact));
        pdf.gap(3);
        pdf.paragraph(
          `${finding.file} · ${tr(`${finding.occurrences.length} occurrence(s)`, `${finding.occurrences.length} occurrence(s)`)} · ${finding.description}`,
          'F1',
          8.5,
          MUTED,
          10,
        );
      }
    }
  }

  // — Corrections —
  heading(pdf, tr('CORRECTIONS', 'FIXES'));
  const fixable = payload.drift.issues.filter((i) => i.autoFixable);
  if (fixable.length === 0) {
    pdf.paragraph(
      tr(
        'Aucune correction automatique disponible. Les constats RGAA et les valeurs sans token équivalent se corrigent avec `axaraaudit fix --ai`.',
        'No automatic fix available. RGAA findings and tokenless values can be fixed with `axaraaudit fix --ai`.',
      ),
      'F1',
      10,
      INK,
    );
  } else {
    pdf.paragraph(
      tr(
        `${fixable.length} dérive(s) sont corrigées automatiquement et sans risque par \`axaraaudit fix --write\` (remplacement exact par le token du design system). Le reste (RGAA, valeurs sans token) se traite avec \`fix --ai\`.`,
        `${fixable.length} drift(s) are fixed automatically and safely by \`axaraaudit fix --write\` (exact replacement with the design-system token). The rest (RGAA, tokenless values) is handled by \`fix --ai\`.`,
      ),
      'F1',
      10,
      INK,
    );
  }

  return pdf.build((page, total) =>
    tr(
      `${payload.tool} v${payload.toolVersion} — ${dateLabel}     ${page} / ${total}`,
      `${payload.tool} v${payload.toolVersion} — ${dateLabel}     ${page} / ${total}`,
    ),
  );
}
