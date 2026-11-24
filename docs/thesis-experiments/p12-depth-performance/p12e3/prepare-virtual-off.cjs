// Apply to a disposable checkout only; no GraphPayload or shipped source changes.
const fs = require('node:fs'), path = require('node:path');
const checkout = path.resolve(process.argv[2] || '');
const file = path.join(checkout, 'webview-ui/src/components/CanvasPane.tsx');
const source = fs.readFileSync(file, 'utf8');
const from = 'onlyRenderVisibleElements={!renderAllForExport}';
if (source.split(from).length !== 2) throw Error('expected one virtualization switch');
fs.writeFileSync(file, source.replace(from, 'onlyRenderVisibleElements={false && !renderAllForExport}'));
