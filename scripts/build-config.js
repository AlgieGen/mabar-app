// Dijalankan saat build di Vercel: menulis alamat server Render ke public/config.js
const fs = require('fs');
const path = require('path');

const url = (process.env.MABAR_SERVER_URL || '').trim().replace(/\/+$/, '');
if (!url) console.warn('⚠️  MABAR_SERVER_URL belum diisi. Tampilan akan mencoba konek ke domain yang sama.');

fs.writeFileSync(
  path.join(__dirname, '..', 'public', 'config.js'),
  `window.MABAR_SERVER_URL = ${JSON.stringify(url)};\n`,
);
console.log(`config.js: MABAR_SERVER_URL = "${url}"`);
