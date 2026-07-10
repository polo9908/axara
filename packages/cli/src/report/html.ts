/**
 * Self-contained HTML report (`--format html`).
 *
 * One file, zero network dependency (no webfonts, no CDN) so it can be
 * attached to a ticket, an email or a CI artifact. The report itself follows
 * RGAA/WCAG AA: semantic landmarks, AA contrast, keyboard-operable filters,
 * `prefers-reduced-motion` honoured. Aesthetic: technical dossier — paper
 * background, serif display, monospaced data, and a stamped CI verdict.
 */

import type { DriftIssue } from '@axaraaudit/core';
import type { AuditPayload } from './payload.js';
import { CLI_NAME } from '../version.js';
import { tr } from '../i18n.js';

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Only render a color swatch for values that are safe inside a style attr. */
function swatch(issue: DriftIssue): string {
  if (issue.category !== 'color') return '';
  if (!/^[#a-zA-Z0-9(),.%\s-]+$/.test(issue.value)) return '';
  return `<span class="swatch" style="background:${esc(issue.value)}" aria-hidden="true"></span>`;
}

const IMPACT_LABELS: Record<string, string> = {
  critical: tr('critique', 'critical'),
  serious: tr('sérieux', 'serious'),
  moderate: tr('modéré', 'moderate'),
  minor: tr('mineur', 'minor'),
  unknown: tr('à qualifier', 'to be assessed'),
};

function scoreTone(score: number, failUnder: number): 'ok' | 'warn' | 'ko' {
  if (score >= failUnder) return 'ok';
  if (score >= failUnder - 20) return 'warn';
  return 'ko';
}

export function renderHtml(payload: AuditPayload): string {
  const s = payload.drift.summary;
  const agg = payload.rgaa.aggregate;
  const tone = scoreTone(payload.score, payload.gate.failUnder);
  const gatePassed = payload.gate.passed;
  const date = new Date(payload.generatedAt);
  const dateLabel = date.toLocaleDateString(tr('fr-FR', 'en-GB'), {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // — Drift section, grouped by file —
  const byFile = new Map<string, DriftIssue[]>();
  for (const issue of payload.drift.issues) {
    const list = byFile.get(issue.file) ?? [];
    list.push(issue);
    byFile.set(issue.file, list);
  }
  const driftFiles = [...byFile.entries()]
    .map(([file, issues]) => {
      const rows = issues
        .map((issue) => {
          const suggestion = issue.suggestion;
          const search = esc(`${file} ${issue.property} ${issue.value} ${suggestion?.token ?? ''}`.toLowerCase());
          return `<tr class="drift-row" data-severity="${issue.severity}" data-autofix="${issue.autoFixable}" data-search="${search}">
  <td class="mono line">L${issue.line}</td>
  <td class="mono">${esc(issue.property)}</td>
  <td class="mono value">${swatch(issue)}${esc(issue.value)}</td>
  <td class="mono target">${
    suggestion !== undefined
      ? `→ ${esc(suggestion.replacement)}`
      : `<span class="none">${tr('aucun token proche', 'no nearby token')}</span>`
  }</td>
  <td>${
    issue.autoFixable
      ? '<span class="badge fix">auto-fix</span>'
      : issue.match === 'nearest-token'
        ? `<span class="badge near">${tr('proche', 'near')}</span>`
        : `<span class="badge manual">${tr('manuel', 'manual')}</span>`
  }</td>
</tr>`;
        })
        .join('\n');
      return `<details class="file" open>
<summary><span class="mono">${esc(file)}</span><span class="count">${issues.length}</span></summary>
<table>
<thead><tr><th scope="col">${tr('Ligne', 'Line')}</th><th scope="col">${tr('Propriété', 'Property')}</th><th scope="col">${tr('Valeur', 'Value')}</th><th scope="col">Suggestion</th><th scope="col">${tr('Statut', 'Status')}</th></tr></thead>
<tbody>${rows}</tbody>
</table>
</details>`;
    })
    .join('\n');

  // — RGAA section —
  const rgaaCards = payload.rgaa.findings
    .map((finding) => {
      const impact = finding.impact ?? 'unknown';
      const occ = finding.occurrences[0];
      return `<article class="rgaa-card" data-impact="${esc(impact)}">
  <header>
    <span class="criterion mono">RGAA ${esc(finding.criterion)}</span>
    <span class="impact impact-${esc(impact)}">${esc(IMPACT_LABELS[impact] ?? impact)}</span>
  </header>
  <h4>${esc(finding.criterionTitle)}</h4>
  <p class="meta mono">${esc(finding.file)} · ${finding.occurrences.length} occurrence(s) · ${tr(`règle axe « ${esc(finding.axeRuleId)} »`, `axe rule "${esc(finding.axeRuleId)}"`)}</p>
  ${occ !== undefined ? `<pre><code>${esc(occ.html)}</code></pre>` : ''}
  ${occ !== undefined && occ.failureSummary !== '' ? `<p class="why">${esc(occ.failureSummary)}</p>` : ''}
</article>`;
    })
    .join('\n');

  const circumference = 2 * Math.PI * 54;
  const dashOffset = circumference * (1 - payload.score / 100);

  return `<!DOCTYPE html>
<html lang="${tr('fr', 'en')}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${tr("Rapport d'audit", 'Audit report')} — ${esc(payload.project)} — ${payload.score}/100</title>
<style>
:root{
  --paper:#F4F2EC; --paper-2:#ECE9E0; --ink:#1D2430; --ink-2:#4C5563;
  --line:#C9C4B6; --ok:#0E6B45; --ko:#B03226; --warn:#8A5A00;
  --accent:#173A63; --fix:#0E6B45; --chip:#E4E0D4;
  --serif:Charter,'Bitstream Charter',Georgia,'Times New Roman',serif;
  --mono:'Cascadia Code',Consolas,'SF Mono',Menlo,monospace;
}
*{box-sizing:border-box}
body{
  margin:0;background:var(--paper);color:var(--ink);
  font:16px/1.6 var(--serif);
  background-image:repeating-linear-gradient(0deg,transparent,transparent 31px,rgba(29,36,48,.035) 32px);
}
main{max-width:960px;margin:0 auto;padding:0 24px 96px}
a{color:var(--accent)}
.mono{font-family:var(--mono);font-size:.86em}
/* ── Letterhead ─────────────────────────────── */
.letterhead{border-bottom:3px double var(--ink);padding:40px 0 20px;display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap}
.letterhead .brand{font-family:var(--mono);font-weight:700;letter-spacing:.35em;text-transform:uppercase;font-size:13px;color:var(--ink-2)}
.letterhead h1{font-size:40px;line-height:1.1;margin:6px 0 0;font-weight:400}
.letterhead h1 em{font-style:italic}
.meta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:0;border:1px solid var(--line);border-bottom:none;margin-top:28px}
.meta-grid>div{border-bottom:1px solid var(--line);border-right:1px solid var(--line);padding:10px 14px;background:rgba(255,255,255,.4)}
.meta-grid>div:last-child{border-right:none}
.meta-grid dt{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--ink-2);margin:0}
.meta-grid dd{margin:2px 0 0;font-size:15px}
/* ── Hero: gauge + stamp ────────────────────── */
.hero{display:flex;align-items:center;gap:48px;padding:44px 0 12px;flex-wrap:wrap}
.gauge{position:relative;width:180px;height:180px;flex:none}
.gauge svg{transform:rotate(-90deg)}
.gauge .track{fill:none;stroke:var(--paper-2);stroke-width:11}
.gauge .arc{fill:none;stroke-width:11;stroke-linecap:butt;stroke-dasharray:${circumference.toFixed(2)};stroke-dashoffset:${circumference.toFixed(2)};animation:draw 1.1s cubic-bezier(.25,.9,.3,1) .15s forwards}
.tone-ok .arc{stroke:var(--ok)} .tone-warn .arc{stroke:var(--warn)} .tone-ko .arc{stroke:var(--ko)}
@keyframes draw{to{stroke-dashoffset:${dashOffset.toFixed(2)}}}
.gauge .num{position:absolute;inset:0;display:grid;place-content:center;text-align:center;font-family:var(--mono)}
.gauge .num b{font-size:46px;font-weight:700;letter-spacing:-.03em}
.gauge .num span{font-size:12px;color:var(--ink-2);letter-spacing:.2em}
.verdict{flex:1;min-width:260px}
.verdict p{margin:.3em 0;max-width:52ch}
.verdict .subscores{color:var(--ink-2);font-size:.95em}
.stamp{display:inline-block;font-family:var(--mono);font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-size:15px;padding:10px 18px;border:3px solid;transform:rotate(-3.5deg);margin:10px 0 4px;
  -webkit-mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.7'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .92 0'/%3E%3C/filter%3E%3Crect width='120' height='60' filter='url(%23n)'/%3E%3C/svg%3E");mask-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='60'%3E%3Cfilter id='n'%3E%3CfeTurbulence baseFrequency='.7'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .92 0'/%3E%3C/filter%3E%3Crect width='120' height='60' filter='url(%23n)'/%3E%3C/svg%3E")}
.stamp.ok{color:var(--ok);border-color:var(--ok)}
.stamp.ko{color:var(--ko);border-color:var(--ko)}
.reasons{margin:8px 0 0;padding-left:20px;color:var(--ko);font-size:15px}
/* ── Cards ──────────────────────────────────── */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:26px 0 8px}
.card{border:1px solid var(--line);background:rgba(255,255,255,.5);padding:16px 18px;position:relative}
.card::after{content:"";position:absolute;inset:4px;border:1px solid var(--line);pointer-events:none;opacity:.5}
.card b{display:block;font-family:var(--mono);font-size:30px;font-weight:700;letter-spacing:-.02em}
.card span{font-size:13px;color:var(--ink-2)}
/* ── Sections ───────────────────────────────── */
section{margin-top:52px}
h2{font-size:24px;font-weight:400;border-bottom:1px solid var(--ink);padding-bottom:8px;display:flex;align-items:baseline;gap:12px}
h2 .mono{color:var(--ink-2);font-size:13px;letter-spacing:.1em}
.toolbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:16px 0}
.toolbar button{font-family:var(--mono);font-size:12.5px;letter-spacing:.05em;padding:6px 12px;border:1px solid var(--ink);background:transparent;color:var(--ink);cursor:pointer}
.toolbar button[aria-pressed="true"]{background:var(--ink);color:var(--paper)}
.toolbar button:focus-visible,.toolbar input:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
.toolbar input{font-family:var(--mono);font-size:13px;padding:6px 10px;border:1px solid var(--ink);background:rgba(255,255,255,.6);color:var(--ink);min-width:200px}
.toolbar .shown{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--ink-2)}
details.file{border:1px solid var(--line);margin:12px 0;background:rgba(255,255,255,.45)}
details.file summary{cursor:pointer;padding:10px 14px;display:flex;gap:12px;align-items:center;list-style:none}
details.file summary::before{content:"▸";font-family:var(--mono);transition:transform .15s}
details.file[open] summary::before{transform:rotate(90deg)}
details.file .count{margin-left:auto;font-family:var(--mono);font-size:12px;background:var(--chip);padding:2px 9px;border-radius:99px}
table{width:100%;border-collapse:collapse;font-size:14px}
th{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.12em;text-align:left;color:var(--ink-2);padding:8px 14px;border-top:1px solid var(--line)}
td{padding:7px 14px;border-top:1px solid var(--line);vertical-align:top}
td.line{color:var(--ink-2);white-space:nowrap}
td.value{white-space:nowrap}
td.target{color:var(--fix)}
td .none{color:var(--ko);font-style:italic;font-family:var(--serif)}
.swatch{display:inline-block;width:12px;height:12px;border:1px solid rgba(0,0,0,.35);margin-right:7px;vertical-align:-1px}
.badge{font-family:var(--mono);font-size:11px;letter-spacing:.06em;padding:2px 8px;border:1px solid}
.badge.fix{color:var(--ok);border-color:var(--ok)}
.badge.near{color:var(--warn);border-color:var(--warn)}
.badge.manual{color:var(--ko);border-color:var(--ko)}
/* ── RGAA ───────────────────────────────────── */
.rgaa-card{border:1px solid var(--line);border-left:4px solid var(--ink);background:rgba(255,255,255,.5);padding:16px 20px;margin:14px 0}
.rgaa-card header{display:flex;justify-content:space-between;gap:12px;align-items:center}
.rgaa-card .criterion{font-weight:700;letter-spacing:.08em}
.rgaa-card h4{margin:6px 0 2px;font-size:17px;font-weight:600}
.rgaa-card .meta{color:var(--ink-2);font-size:12px;margin:2px 0 10px}
.rgaa-card pre{background:var(--ink);color:#E8E4D8;padding:12px 14px;overflow-x:auto;font-size:13px;margin:8px 0}
.rgaa-card .why{font-size:14px;color:var(--ink-2);margin:6px 0 0}
.impact{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:3px 9px;border:1px solid}
.impact-critical{color:#fff;background:var(--ko);border-color:var(--ko)}
.impact-serious{color:var(--ko);border-color:var(--ko)}
.impact-moderate{color:var(--warn);border-color:var(--warn)}
.impact-minor,.impact-unknown{color:var(--ink-2);border-color:var(--line)}
.empty{border:1px dashed var(--line);padding:22px;text-align:center;color:var(--ok);font-style:italic}
/* ── Footer / hint ──────────────────────────── */
.hint{margin-top:20px;border:1px solid var(--line);background:var(--paper-2);padding:14px 18px;font-size:14.5px}
.hint code{font-family:var(--mono);background:rgba(255,255,255,.7);padding:1px 6px;border:1px solid var(--line)}
footer{margin-top:64px;border-top:3px double var(--ink);padding-top:14px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-family:var(--mono);font-size:12px;color:var(--ink-2)}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.gauge .arc{animation:none;stroke-dashoffset:${dashOffset.toFixed(2)}}}
@media print{body{background:#fff}.toolbar{display:none}}
</style>
</head>
<body>
<main>
  <header class="letterhead">
    <div>
      <div class="brand">AxaraAudit · ${tr("Rapport d'audit", 'Audit report')}</div>
      <h1>${esc(payload.project)} — <em>${tr('conformité design &amp; accessibilité', 'design &amp; accessibility compliance')}</em></h1>
    </div>
  </header>

  <dl class="meta-grid">
    <div><dt>Date</dt><dd>${esc(dateLabel)}</dd></div>
    <div><dt>${tr('Fichiers analysés', 'Files scanned')}</dt><dd class="mono">${s.filesScanned}</dd></div>
    <div><dt>${tr('Référentiel', 'Standard')}</dt><dd>RGAA 4.1 · WCAG 2.1</dd></div>
    <div><dt>${tr('Moteur', 'Engine')}</dt><dd class="mono">${esc(payload.tool)} v${esc(payload.toolVersion)}</dd></div>
  </dl>

  <section class="hero" aria-labelledby="score-title">
    <h2 id="score-title" class="visually-hidden">${tr('Score de conformité', 'Compliance score')}</h2>
    <div class="gauge tone-${tone}" role="img" aria-label="${tr(`Score de conformité : ${payload.score} sur 100`, `Compliance score: ${payload.score} out of 100`)}">
      <svg width="180" height="180" viewBox="0 0 180 180" aria-hidden="true">
        <circle class="track" cx="90" cy="90" r="54" pathLength="${circumference.toFixed(0)}"/>
        <circle class="arc" cx="90" cy="90" r="54"/>
      </svg>
      <div class="num" aria-hidden="true"><b>${payload.score}</b><span>/ 100</span></div>
    </div>
    <div class="verdict">
      <p class="subscores">${tr('Design system :', 'Design system:')} <strong class="mono">${payload.scores.design}/100</strong>${
        payload.rgaa.enabled
          ? `${tr(' · RGAA : ', ' · RGAA: ')}<strong class="mono">${payload.scores.rgaa}/100</strong>`
          : ''
      }</p>
      ${
        payload.gate.evaluated
          ? `<span class="stamp ${gatePassed ? 'ok' : 'ko'}">${gatePassed ? tr('Seuil atteint', 'Threshold met') : tr('Seuil non atteint', 'Threshold not met')}</span>
             <p>${tr('Seuil requis :', 'Required threshold:')} <strong class="mono">${payload.gate.failUnder}/100</strong>.</p>
             ${gatePassed ? '' : `<ul class="reasons">${payload.gate.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`}`
          : `<span class="stamp ${tone === 'ok' ? 'ok' : 'ko'}">${tone === 'ok' ? tr('Conforme au seuil', 'Meets the threshold') : tr('À corriger', 'Needs fixing')}</span>
             <p>${tr('Audit informatif (gate CI non évalué). Seuil de référence :', 'Informational audit (CI gate not evaluated). Reference threshold:')} <strong class="mono">${payload.gate.failUnder}/100</strong>.</p>`
      }
      <p>${tr(
        "Ce score automatique est un signal d'ingénierie — la conformité légale RGAA exige un audit manuel complémentaire.",
        'This automated score is an engineering signal — legal RGAA compliance requires a complementary manual audit.',
      )}</p>
    </div>
  </section>

  <div class="cards">
    <div class="card"><b>${s.totalIssues}</b><span>${tr('dérives design', 'design drifts')}</span></div>
    <div class="card"><b>${s.autoFixable}</b><span>${tr('corrigeables auto', 'auto-fixable')}</span></div>
    <div class="card"><b>${agg.criteriaFailed}</b><span>${tr('critères RGAA non conformes', 'non-conformant RGAA criteria')}</span></div>
    <div class="card"><b>${agg.totalFindings}</b><span>${tr("constats d'accessibilité", 'accessibility findings')}</span></div>
  </div>

  <section aria-labelledby="drift-title">
    <h2 id="drift-title">${tr('I. Système de design', 'I. Design system')} <span class="mono">${tr(`${s.totalIssues} dérive(s)`, `${s.totalIssues} drift(s)`)}</span></h2>
    ${
      payload.drift.issues.length === 0
        ? `<p class="empty">${tr('Aucune dérive détectée — toutes les valeurs utilisent les tokens.', 'No drift detected — every value uses the tokens.')}</p>`
        : `<div class="toolbar" role="group" aria-label="${tr('Filtres des dérives', 'Drift filters')}">
      <button type="button" data-filter="all" aria-pressed="true">${tr('Tout', 'All')}</button>
      <button type="button" data-filter="error" aria-pressed="false">${tr('Erreurs', 'Errors')}</button>
      <button type="button" data-filter="warning" aria-pressed="false">${tr('Avertissements', 'Warnings')}</button>
      <button type="button" data-filter="autofix" aria-pressed="false">${tr('Auto-fixables', 'Auto-fixable')}</button>
      <label><span class="visually-hidden">${tr('Rechercher dans les dérives', 'Search within drifts')}</span>
        <input type="search" id="drift-search" placeholder="${tr('Rechercher… (fichier, valeur, token)', 'Search… (file, value, token)')}">
      </label>
      <span class="shown" id="drift-shown" aria-live="polite"></span>
    </div>
    <div id="drift-list">${driftFiles}</div>
    <div class="hint">${tr('Réparer :', 'To fix:')} <code>npx axaraaudit fix --write</code> ${tr('(sûr)', '(safe)')} · <code>--all</code> ${tr('(valeurs proches)', '(nearby values)')} · <code>--ai</code> ${tr('(RGAA &amp; reste, via Claude)', '(RGAA &amp; the rest, via Claude)')}</div>`
    }
  </section>

  <section aria-labelledby="rgaa-title">
    <h2 id="rgaa-title">${tr('II. Accessibilité RGAA', 'II. RGAA accessibility')} <span class="mono">${tr(`${agg.criteriaFailed} critère(s) NC`, `${agg.criteriaFailed} failed criteria`)}</span></h2>
    ${
      !payload.rgaa.enabled
        ? `<p class="empty">${tr('Analyse RGAA désactivée pour cet audit.', 'RGAA analysis disabled for this audit.')}</p>`
        : payload.rgaa.findings.length === 0
          ? `<p class="empty">${tr('Aucune non-conformité détectée automatiquement.', 'No non-conformity detected automatically.')}</p>`
          : `<div class="toolbar" role="group" aria-label="${tr('Filtres RGAA', 'RGAA filters')}">
      <button type="button" data-impact="all" aria-pressed="true">${tr('Tous impacts', 'All impacts')}</button>
      <button type="button" data-impact="critical" aria-pressed="false">${tr('Critique', 'Critical')}</button>
      <button type="button" data-impact="serious" aria-pressed="false">${tr('Sérieux', 'Serious')}</button>
      <button type="button" data-impact="moderate" aria-pressed="false">${tr('Modéré', 'Moderate')}</button>
    </div>
    <div id="rgaa-list">${rgaaCards}</div>`
    }
  </section>

  <footer>
    <span>${tr(`Généré par ${esc(CLI_NAME)} — audit statique + axe-core`, `Generated by ${esc(CLI_NAME)} — static audit + axe-core`)}</span>
    <span>${esc(payload.generatedAt)}</span>
  </footer>
</main>
<script>
(function(){
  var state={filter:'all',search:''};
  var rows=[].slice.call(document.querySelectorAll('.drift-row'));
  var shown=document.getElementById('drift-shown');
  function apply(){
    var visible=0;
    rows.forEach(function(row){
      var okFilter=state.filter==='all'
        || (state.filter==='autofix' && row.dataset.autofix==='true')
        || row.dataset.severity===state.filter;
      var okSearch=state.search===''||row.dataset.search.indexOf(state.search)!==-1;
      var show=okFilter&&okSearch;
      row.hidden=!show; if(show)visible+=1;
    });
    document.querySelectorAll('details.file').forEach(function(d){
      var any=[].slice.call(d.querySelectorAll('.drift-row')).some(function(r){return !r.hidden});
      d.hidden=!any;
    });
    if(shown)shown.textContent=visible+' ${tr('visible(s)', 'shown')}';
  }
  document.querySelectorAll('[data-filter]').forEach(function(btn){
    btn.addEventListener('click',function(){
      state.filter=btn.dataset.filter;
      document.querySelectorAll('[data-filter]').forEach(function(b){b.setAttribute('aria-pressed',String(b===btn))});
      apply();
    });
  });
  var search=document.getElementById('drift-search');
  if(search)search.addEventListener('input',function(){state.search=search.value.toLowerCase();apply()});
  document.querySelectorAll('[data-impact]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var impact=btn.dataset.impact;
      document.querySelectorAll('[data-impact]').forEach(function(b){b.setAttribute('aria-pressed',String(b===btn))});
      document.querySelectorAll('.rgaa-card').forEach(function(card){
        card.hidden=impact!=='all'&&card.dataset.impact!==impact;
      });
    });
  });
  apply();
})();
</script>
</body>
</html>
`;
}
