const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

const sessionFolder = path.join(__dirname, 'session');
const publicPath = path.join(__dirname, '../public');

if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

// Serve static files from 'public' folder
app.use(express.static(publicPath));

// Serve index.html at root
app.get('/', (req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

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

// Pairing code endpoint
app.get('/api/pair', async (req, res) => {
  try {
    const phone = req.query.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const sock = globalSocket || await startSocket();
    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(phone);
      console.log('Pairing Code:', code);
      return res.status(200).json({ code });
    } else {
      return res.status(200).json({ message: 'Already logged in.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Send messages from uploaded file
app.post('/api/send', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    try {
      const sock = globalSocket || await startSocket();
      const jid = receiver + '@s.whatsapp.net';

      if (files.file) {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const filePath = file.filepath || file.path;
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

        while (true) {
          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }
        }

      } else {
        return res.status(400).json({ error: 'No message file uploaded' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Sending failed', detail: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
