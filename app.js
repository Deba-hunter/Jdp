const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');

if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);
app.use(express.static('public'));

let globalSocket;
let isLoggedIn = false;

// Start or return current socket
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
  sock.ev.on('connection.update', ({ connection }) => {
    if (connection === 'open') {
      console.log('✅ Logged in successfully');
      isLoggedIn = true;
    }
  });

  globalSocket = sock;
  return sock;
}

startSocket();

// 👉 STEP 1: Submit number and get pairing code
app.get('/api/pair', async (req, res) => {
  const number = req.query.number;
  if (!number) return res.status(400).json({ error: 'Phone number is required' });

  try {
    const sock = globalSocket || await startSocket();

    if (isLoggedIn || sock.authState.creds.registered) {
      return res.status(200).json({ message: '✅ Already logged in' });
    }

    const code = await sock.requestPairingCode(number);
    console.log('🔢 Pairing Code for', number, ':', code);
    return res.status(200).json({ code });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// 👉 STEP 2: Upload message file and receiver
app.post('/api/send', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!receiver || !files.file) {
      return res.status(400).json({ error: 'Receiver number and file are required' });
    }

    try {
      const sock = globalSocket || await startSocket();
      const jid = receiver + '@s.whatsapp.net';

      const file = Array.isArray(files.file) ? files.file[0] : files.file;
      const filePath = file.filepath || file.path;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

      if (lines.length === 0) {
        return res.status(400).json({ error: 'Message file is empty' });
      }

      (async function loopMessages() {
        while (true) {
          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }
        }
      })();

      return res.status(200).json({ message: `📨 Messages started looping to ${receiver}` });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
  
