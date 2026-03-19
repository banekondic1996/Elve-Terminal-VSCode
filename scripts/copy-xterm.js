// Copies xterm browser bundles from node_modules into media/
// Run automatically via `npm run compile` or manually with `node scripts/copy-xterm.js`
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const media = path.join(root, 'media');

const files = [
  ['node_modules/xterm/css/xterm.css',                              'xterm.css'],
  ['node_modules/xterm/lib/xterm.js',                               'xterm.js'],
  ['node_modules/xterm-addon-fit/lib/xterm-addon-fit.js',           'xterm-addon-fit.js'],
  ['node_modules/xterm-addon-web-links/lib/xterm-addon-web-links.js','xterm-addon-web-links.js'],
];

let ok = 0, fail = 0;
files.forEach(([src, dst]) => {
  const from = path.join(root, src);
  const to   = path.join(media, dst);
  if (!fs.existsSync(from)) {
    console.error(`MISSING: ${from} — run npm install first`);
    fail++;
    return;
  }
  fs.copyFileSync(from, to);
  console.log(`Copied ${src} → media/${dst}`);
  ok++;
});

console.log(`\n${ok} files copied, ${fail} missing.`);
if (fail > 0) process.exit(1);
