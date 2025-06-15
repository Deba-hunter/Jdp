const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');

if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);
app.use(express.static(path.join(__dirname, '../public')));

let globalSocket;

async function startSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['Render Bot', 'Chrome', '1.0'],
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: "hello" })
  });

  sock.ev.on('creds.update', saveCreds);
  globalSocket = sock;

  return sock;
}

startSocket();

app.get('/api', async (req, res) => {
  try {
    const sock = globalSocket || await startSocket();
    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode("91XXXXXXXXXX"); // Change if needed
      console.log('🔑 Pairing Code:', code);
      return res.status(200).json({ code });
    } else {
      return res.status(200).json({ message: '✅ Already logged in.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay } = fields;
    const delaySec = parseInt(delay) || 5;

    try {
      const sock = globalSocket || await startSocket();
      const jid = receiver + '@s.whatsapp.net';

      if (files.file) {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const filePath = file.filepath || file.path;
        const message = fs.readFileSync(filePath, 'utf-8').trim();

        res.status(200).json({ message: `🟢 Sending message to ${receiver} in loop` });

        // Send message in infinite loop
        (async function loopSend() {
          while (true) {
            await sock.sendMessage(jid, { text: message });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }
        })();
      } else {
        return res.status(400).json({ error: 'No file uploaded' });
      }
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
    
