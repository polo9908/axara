// End-to-end smoke test for @axaraaudit/core (run after building core).
import { auditPaths } from '../packages/core/dist/index.js';

const report = auditPaths(
  new URL('./design-tokens.dtcg.json', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  [new URL('./Button.tsx', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')],
);

console.log('Tokens parsed:', report.tokens.length);
console.log('Token errors:', report.tokenErrors);
console.log('Summary:', report.summary);
for (const issue of report.issues) {
  const sug = issue.suggestion ? ` -> ${issue.suggestion.replacement} (conf ${issue.suggestion.confidence})` : '';
  console.log(
    `  ${issue.severity.toUpperCase().padEnd(7)} ${issue.property}: ${issue.value} [${issue.match}]${sug}`,
  );
}
