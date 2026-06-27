// End-to-end RGAA demo (run after building core): axe-core in JSDOM → RGAA → Ara.
import { auditHtmlRgaa, toAraDeclaration } from '../packages/core/dist/index.js';

const html = `
  <img src="logo.png">
  <a href="/contact"></a>
  <form><input type="text" name="email"></form>
  <h3>Sous-titre sans h1/h2</h3>
`;

const report = await auditHtmlRgaa(html);

console.log('RGAA summary:', report.summary);
console.log('Findings:');
for (const f of report.findings) {
  console.log(
    `  [${f.criterion}] ${f.themeLabel} — ${f.axeRuleId} (${f.status}, ${f.impact ?? 'n/a'}) × ${f.occurrences.length}`,
  );
}
if (report.unmappedRules.length) console.log('Unmapped axe rules:', report.unmappedRules);

console.log('\nAra declaration (NC criteria):');
console.log(JSON.stringify(toAraDeclaration(report, { generatedAt: '2026-06-27T00:00:00.000Z' }), null, 2));
