// Demo for @a11yengine/runtime: real focus-trap audit (Playwright) + Figma compare.
// Run from the package: `node scripts/runtime-smoke.mjs` (needs `playwright install chromium`).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseDtcgString } from '@a11yengine/core';
import { auditFocusOrder, normalizeFigmaVariables, compareTokens } from '../dist/index.js';

// 1) Focus-trap audit on a real headless browser.
const clean = await auditFocusOrder('<button>One</button> <a href="#">Two</a>', { maxTabs: 8 });
console.log('Clean component  →', clean.message);

const trap = await auditFocusOrder(
  `<div id="dlg"><button id="t1">A</button><button id="t2">B</button></div>
   <script>
     const dlg=document.getElementById('dlg');
     const f=[].slice.call(dlg.querySelectorAll('button'));
     dlg.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();
       const i=f.indexOf(document.activeElement);
       f[e.shiftKey?(i-1+f.length)%f.length:(i+1)%f.length].focus();}});
   </script>`,
  { maxTabs: 8 },
);
console.log('Trapped modal    →', trap.message, `(isTrap=${trap.isTrap}, kind=${trap.trapKind})`);

// 2) Figma Variables → compare against the code's DTCG tokens.
const tokensPath = fileURLToPath(new URL('../../../examples/design-tokens.dtcg.json', import.meta.url));
const { tokens: codeTokens } = parseDtcgString(readFileSync(tokensPath, 'utf8'));

const figmaMeta = {
  variableCollections: { c: { id: 'c', name: 'Theme', defaultModeId: 'm', modes: [{ modeId: 'm', name: 'Light' }] } },
  variables: {
    a: { id: 'a', name: 'color/brand/primary', variableCollectionId: 'c', resolvedType: 'COLOR',
         valuesByMode: { m: { r: 0.231, g: 0.51, b: 0.965, a: 1 } } },        // #3b82f6 (matches code)
    b: { id: 'b', name: 'space/sm', variableCollectionId: 'c', resolvedType: 'FLOAT',
         valuesByMode: { m: 10 } },                                            // 10px vs code 8px → mismatch
  },
};
const { tokens: figmaTokens } = normalizeFigmaVariables(figmaMeta);
const cmp = compareTokens(figmaTokens, codeTokens);
console.log('\nFigma ↔ code compare →', JSON.stringify(cmp.summary));
for (const m of cmp.mismatches) console.log(`  mismatch ${m.path}: figma ${m.figmaValue} ≠ code ${m.codeValue}`);
for (const m of cmp.missingInCode) console.log(`  missing in code: ${m.path} (${m.value})`);

console.log('\nOK — runtime focus audit + Figma compare ran.');
