const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');

app.use(express.json());
app.use(express.static('public')); // Serve public folder

// Helper: Clean session folder
function cleanSession() {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(sessionFolder, { recursive: true });
}

// Start WhatsApp socket
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

// Route to get pairing code (POST /api/pair)
app.post('/api/pair', async (req, res) => {
  const { number } = req.body;
  // Number validation: country code ke saath, bina + ke, 10-15 digits
  if (!number || !/^\d{10,15}$/.test(number)) {
    return res.status(400).json({ error: 'WhatsApp number required in correct format (e.g. 919876543210)' });
  }

  try {
    // Clean session for fresh login
    cleanSession();

    const sock = await startSocket();
    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(number);
      console.log('🟢 Pairing Code:', code);
      return res.status(200).json({ code, message: 'Enter this code in WhatsApp app > Linked Devices > Link with phone number instead.' });
    } else {
      return res.status(200).json({ message: '✅ Already logged in.' });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Route to send bulk messages from file (POST /api)
app.post('/api', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    // Number validation
    if (!receiver || !/^\d{10,15}$/.test(receiver)) {
      return res.status(400).json({ error: 'Receiver WhatsApp number required in correct format (e.g. 919876543210)' });
    }

    try {
      const sock = globalSocket || await startSocket();
      const jid = receiver + '@s.whatsapp.net';

      if (files.file) {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const filePath = file.filepath || file.path;
        const lines = fs.readFileSync(filePath, 'utf-8').split('\n').map(line => line.trim()).filter(Boolean);

        if (lines.length === 0) {
          return res.status(400).json({ error: 'File is empty.' });
        }

        for (const line of lines) {
          await sock.sendMessage(jid, { text: line });
          await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        }

        return res.status(200).json({ message: `📁 ${lines.length} messages sent from file to ${receiver}` });

      } else {
        return res.status(400).json({ error: 'File upload required' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Sending failed', detail: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
        
