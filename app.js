const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

let sock, isLoggedIn = false;

async function initSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();
  sock = makeWASocket({ version, auth: state, browser: ['RenderBot','Chrome','1.0'] });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', update => {
    if (update.connection === 'open') { isLoggedIn = true; console.log('✅ Logged in'); }
    if (update.connection === 'close') { isLoggedIn = false; console.log('❌ Disconnected'); }
  });
}
initSocket();

app.use(express.static(path.join(__dirname, '../public')));

app.get('/api/pair', async (req, res) => {
  const number = req.query.number;
  if (!number) return res.status(400).json({ error: 'Number required' });
  if (isLoggedIn) return res.json({ message: '✅ Already logged in' });
  try {
    const code = await sock.requestPairingCode(number);
    console.log('🔢 Pair code:', code);
    return res.json({ code });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/send', (req, res) => {
  const form = new formidable.IncomingForm();
  form.uploadDir = sessionFolder;
  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Parse error' });
    const { receiver, delay } = fields;
    if (!receiver || !files.file) return res.status(400).json({ error: 'Receiver + file required' });
    const lines = fs.readFileSync(files.file.filepath, 'utf-8').split('\n').filter(Boolean);
    if (!lines.length) return res.status(400).json({ error: 'Empty file' });
    (async () => {
      while (true) {
        for (let l of lines) {
          await sock.sendMessage(receiver + '@s.whatsapp.net', { text: l });
          await new Promise(r => setTimeout(r, (parseInt(delay) || 2) * 1000));
        }
      }
    })();
    return res.json({ message: `Loop started to ${receiver}` });
  });
});

app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`));
