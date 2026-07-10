/**
 * Rapport PDF autonome (`axaraaudit export`) — zéro dépendance.
 *
 * On écrit le format PDF 1.4 à la main : polices standard Helvetica (aucune
 * incorporation nécessaire), encodage WinAnsi (couvre le français : é è à ç œ…),
 * flux de contenu texte + rectangles. La DA AXARA est respectée : barre en
 * dégradé violet → cyan, statuts vert/ambre/rouge, texte secondaire ardoise.
 *
 * Le PDF reprend le contenu du rapport HTML : score, gate, synthèse, dérives
 * de tokens groupées par fichier, constats RGAA, et la section « corrections »
 * (ce que `fix --write` corrige automatiquement).
 */

import type { AuditPayload } from './payload.js';
import type { DriftIssue } from '@axaraaudit/core';
import { BRAND } from '../ui/theme.js';
import type { Rgb } from '../ui/ansi.js';
import { lerp } from '../ui/ansi.js';
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

// ── Largeurs approchées (Helvetica) pour la césure ─────────────────────────

const NARROW = new Set([...".,:;!|'`i l j t f r ( ) [ ] { } / \\ \" -".split(' ').join(''), ' ']);
const WIDE = new Set([...'MWm@%']);

/** Largeur estimée en « em » — assez précis pour couper les lignes. */
function charWidth(ch: string): number {
  if (NARROW.has(ch)) return 0.32;
  if (WIDE.has(ch)) return 0.86;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  return 0.53;
}

export function textWidth(text: string, size: number): number {
  let em = 0;
  for (const ch of text) em += charWidth(ch);
  return em * size;
}

/** Coupe `text` en lignes tenant dans `maxWidth` points. Exporté pour les tests. */
export function wrapText(text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter((w) => w !== '');
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (textWidth(candidate, size) <= maxWidth || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
}

function truncate(text: string, size: number, maxWidth: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  let out = '';
  for (const ch of text) {
    if (textWidth(`${out}${ch}…`, size) > maxWidth) break;
    out += ch;
  }
  return `${out}…`;
}

// ── Écrivain PDF ───────────────────────────────────────────────────────────

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64;

const INK: Rgb = { r: 30, g: 30, b: 46 }; // texte principal — encre sombre

type Font = 'F1' | 'F2' | 'F3'; // regular | bold | oblique

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
  line(value: string, font: Font, size: number, color: Rgb, indent = 0, lead = 1.45): void {
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

  /** Barre horizontale en dégradé violet → cyan — la signature AXARA. */
  gradientBar(y: number, height: number): void {
    const steps = 48;
    const w = CONTENT_W / steps;
    for (let i = 0; i < steps; i += 1) {
      this.rect(MARGIN + i * w, y, w + 0.5, height, lerp(BRAND.violet, BRAND.cyan, i / (steps - 1)));
    }
  }

  /** Sérialise le document complet (pages, polices, xref). */
  build(footer: (page: number, total: number) => string): Buffer {
    // Pied de page uniforme, maintenant que le nombre total est connu.
    const total = this.pages.length;
    this.pages.forEach((chunks, i) => {
      const saved = this.chunks;
      this.chunks = chunks;
      this.rect(MARGIN, BOTTOM - 18, CONTENT_W, 0.6, BRAND.slate);
      this.text(MARGIN, BOTTOM - 30, footer(i + 1, total), 'F1', 8, BRAND.slate);
      this.chunks = saved;
    });

    const objects: Buffer[] = [];
    const push = (body: Buffer | string): number => {
      objects.push(typeof body === 'string' ? Buffer.from(body, 'latin1') : body);
      return objects.length; // numéros d'objets 1-based
    };

    const fontIds = (['Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique'] as const).map((base) =>
      push(`<< /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`),
    );
    const fontRes = `<< /F1 ${fontIds[0]} 0 R /F2 ${fontIds[1]} 0 R /F3 ${fontIds[2]} 0 R >>`;

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

const IMPACT_FR: Readonly<Record<string, string>> = {
  critical: tr('critique', 'critical'),
  serious: tr('sérieux', 'serious'),
  moderate: tr('modéré', 'moderate'),
  minor: tr('mineur', 'minor'),
  unknown: tr('à qualifier', 'to assess'),
};

function severityColor(severity: string): Rgb {
  return severity === 'error' ? BRAND.red : BRAND.amber;
}

function heading(pdf: PdfBuilder, label: string): void {
  pdf.ensure(48);
  pdf.gap(18);
  pdf.line(label, 'F2', 13, BRAND.violet);
  pdf.rect(MARGIN, pdf.y - 5, CONTENT_W, 0.8, BRAND.violet);
  pdf.gap(8);
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

  // — En-tête de marque —
  pdf.gradientBar(pdf.y - 6, 5);
  pdf.gap(14);
  pdf.line(tr("Rapport d'audit — accessibilité & design system", 'Audit report — accessibility & design system'), 'F2', 20, INK, 0, 1.2);
  pdf.line(
    `${payload.project} · ${dateLabel} · ${payload.tool} v${payload.toolVersion}`,
    'F1',
    10,
    BRAND.slate,
  );

  // — Score & gate —
  pdf.gap(18);
  const tone = payload.score >= payload.gate.failUnder ? BRAND.green : payload.score >= payload.gate.failUnder - 20 ? BRAND.amber : BRAND.red;
  pdf.ensure(52);
  pdf.text(MARGIN, pdf.y - 34, `${payload.score}/100`, 'F2', 34, tone);
  const gateLabel = payload.gate.evaluated
    ? payload.gate.passed
      ? tr('GATE : RÉUSSI', 'GATE: PASSED')
      : tr('GATE : ÉCHOUÉ', 'GATE: FAILED')
    : tr('GATE : NON ÉVALUÉ', 'GATE: NOT EVALUATED');
  pdf.text(MARGIN + 150, pdf.y - 30, gateLabel, 'F2', 13, payload.gate.passed ? BRAND.green : BRAND.red);
  pdf.text(
    MARGIN + 150,
    pdf.y - 44,
    tr(`seuil : ${payload.gate.failUnder}/100`, `threshold: ${payload.gate.failUnder}/100`),
    'F1',
    9,
    BRAND.slate,
  );
  pdf.gap(56);
  for (const reason of payload.gate.reasons) {
    pdf.paragraph(`• ${reason}`, 'F1', 9, BRAND.slate);
  }

  // — Synthèse —
  heading(pdf, tr('SYNTHÈSE', 'SUMMARY'));
  const summaryRows: readonly (readonly [string, string])[] = [
    [tr('Fichiers analysés', 'Files scanned'), String(s.filesScanned)],
    [
      tr('Dérives design', 'Design drifts'),
      tr(
        `${s.totalIssues} (${s.errors} erreurs, ${s.warnings} avertissements)`,
        `${s.totalIssues} (${s.errors} errors, ${s.warnings} warnings)`,
      ),
    ],
    [
      tr('Corrections automatiques', 'Automatic fixes'),
      tr(`${s.autoFixable} disponibles via fix --write`, `${s.autoFixable} available via fix --write`),
    ],
    ...(payload.rgaa.enabled
      ? ([
          [
            tr('RGAA 4.1', 'RGAA 4.1'),
            tr(
              `${agg.totalFindings} constat(s) — ${agg.criteriaFailed} critère(s) non conforme(s), ${agg.criteriaToReview} à vérifier`,
              `${agg.totalFindings} finding(s) — ${agg.criteriaFailed} failed criteria, ${agg.criteriaToReview} to review`,
            ),
          ],
        ] as const)
      : ([[tr('RGAA 4.1', 'RGAA 4.1'), tr('non évalué (--skip-rgaa)', 'not evaluated (--skip-rgaa)')]] as const)),
  ];
  for (const [label, value] of summaryRows) {
    pdf.ensure(16);
    pdf.y -= 15;
    pdf.text(MARGIN, pdf.y, label, 'F2', 10, INK);
    pdf.text(MARGIN + 170, pdf.y, value, 'F1', 10, INK);
  }

  // — Dérives par fichier —
  heading(pdf, tr('DÉRIVES DESIGN-TOKENS', 'DESIGN-TOKEN DRIFT'));
  if (payload.drift.issues.length === 0) {
    pdf.line(tr('Aucune dérive : toutes les valeurs passent par les tokens.', 'No drift: every value goes through the tokens.'), 'F1', 10, BRAND.green);
  } else {
    const byFile = new Map<string, DriftIssue[]>();
    for (const issue of payload.drift.issues) {
      const list = byFile.get(issue.file) ?? [];
      list.push(issue);
      byFile.set(issue.file, list);
    }
    for (const [file, issues] of byFile) {
      pdf.ensure(34);
      pdf.gap(8);
      pdf.line(truncate(file, 10, CONTENT_W - 60), 'F2', 10, INK);
      for (const issue of issues) {
        const target =
          issue.suggestion !== undefined
            ? `-> ${issue.suggestion.replacement}`
            : tr('(aucun token proche)', '(no nearby token)');
        const flag = issue.autoFixable ? tr(' · auto-corrigeable', ' · auto-fixable') : '';
        pdf.ensure(13);
        pdf.y -= 12;
        pdf.text(MARGIN + 10, pdf.y, `L${issue.line}`, 'F1', 8.5, BRAND.slate);
        pdf.text(MARGIN + 44, pdf.y, truncate(`${issue.property}: ${issue.value}`, 8.5, 190), 'F1', 8.5, severityColor(issue.severity));
        pdf.text(MARGIN + 244, pdf.y, truncate(`${target}${flag}`, 8.5, CONTENT_W - 244), 'F1', 8.5, issue.autoFixable ? BRAND.green : BRAND.slate);
      }
    }
  }

  // — RGAA —
  if (payload.rgaa.enabled) {
    heading(pdf, tr('CONSTATS RGAA 4.1', 'RGAA 4.1 FINDINGS'));
    if (payload.rgaa.findings.length === 0) {
      pdf.line(tr('Aucun constat : rien à signaler sur les critères vérifiables statiquement.', 'No findings on statically checkable criteria.'), 'F1', 10, BRAND.green);
    } else {
      for (const finding of payload.rgaa.findings) {
        const impact = IMPACT_FR[finding.impact ?? 'unknown'] ?? String(finding.impact);
        pdf.ensure(40);
        pdf.gap(6);
        pdf.line(
          truncate(`${finding.criterion} — ${finding.criterionTitle}`, 10, CONTENT_W - 90),
          'F2',
          10,
          INK,
        );
        pdf.text(
          PAGE_W - MARGIN - 70,
          pdf.y,
          impact,
          'F2',
          9,
          finding.impact === 'critical' || finding.impact === 'serious' ? BRAND.red : BRAND.amber,
        );
        pdf.paragraph(
          tr(
            `${finding.file} · ${finding.occurrences.length} occurrence(s) · ${finding.description}`,
            `${finding.file} · ${finding.occurrences.length} occurrence(s) · ${finding.description}`,
          ),
          'F1',
          8.5,
          BRAND.slate,
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
      `Généré par ${payload.tool} v${payload.toolVersion} — ${dateLabel} · axara.dev · page ${page}/${total}`,
      `Generated by ${payload.tool} v${payload.toolVersion} — ${dateLabel} · axara.dev · page ${page}/${total}`,
    ),
  );
}
