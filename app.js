const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const qrcode = require('qrcode');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');

app.use(express.json());
app.use(express.static('public')); // Serve frontend

// Helper: Clean session folder
function cleanSession() {
  if (fs.existsSync(sessionFolder)) {
    fs.rmSync(sessionFolder, { recursive: true, force: true });
  }
  fs.mkdirSync(sessionFolder, { recursive: true });
}

// WhatsApp Socket State
let globalSocket = null;
let qrData = null;
let isReady = false;

// Start WhatsApp bot (auto-start on server run)
async function startSocket() {
  if (globalSocket) return; // Already running

  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Bot', 'Chrome', '1.0'],
    getMessage: async () => ({ conversation: "hello" })
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { qr, connection, lastDisconnect } = update;
    if (qr) {
      qrData = qr;
      isReady = false;
    }
    if (connection === 'open') {
      isReady = true;
      qrData = null;
      console.log('✅ WhatsApp Connected!');
    }
    if (connection === 'close') {
      isReady = false;
      qrData = null;
      globalSocket = null;
      if (lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) {
        setTimeout(startSocket, 3000); // Auto-reconnect except on loggedOut
      }
    }
  });

  globalSocket = sock;
}

startSocket(); // Auto-start on server launch

// --- API ROUTES ---

// Get QR code
app.get('/api/qr', async (req, res) => {
  if (isReady) return res.json({ message: 'Already authenticated!' });
  if (!qrData) return res.json({ message: 'QR code not generated yet. Please wait...' });
  const qrImage = await qrcode.toDataURL(qrData);
  res.json({ qr: qrImage });
});

// Bulk message API
app.post('/api', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form parse error' });

    const { receiver, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!receiver || !/^\d{10,15}$/.test(receiver)) {
      return res.status(400).json({ error: 'Receiver WhatsApp number required in correct format (e.g. 919876543210)' });
    }

    try {
      const sock = globalSocket;
      if (!sock || !isReady) return res.status(400).json({ error: 'WhatsApp not authenticated. Please login first.' });
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
