const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);
app.use(express.static('public'));

let sock; // Keep socket globally

async function initSocket() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Bot', 'Baileys', '1.0'],
    getMessage: async () => ({ conversation: "hello" }),
  });

  sock.ev.on('creds.update', saveCreds);
}

initSocket();

app.get('/pair', async (req, res) => {
  try {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Missing phone number in query' });

    if (!sock.authState.creds.registered) {
      const { code } = await sock.requestPairingCode(phone);
      return res.status(200).json({ pairing_code: code });
    } else {
      return res.status(200).json({ message: 'Already logged in' });
    }
  } catch (err) {
    return res.status(500).json({ error: 'Pairing failed', detail: err.message });
  }
});

app.post('/send', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(500).json({ error: 'Form error' });

    const { receiver, message, delay } = fields;
    const delaySec = parseInt(delay) || 2;

    if (!sock) return res.status(500).json({ error: 'Socket not initialized' });

    try {
      const jid = receiver + '@s.whatsapp.net';

      if (files.file) {
        const file = Array.isArray(files.file) ? files.file[0] : files.file;
        const lines = fs.readFileSync(file.filepath || file.path, 'utf-8').split('\n').filter(Boolean);

        for (const line of lines) {
          await sock.sendMessage(jid, { text: line });
          await new Promise(r => setTimeout(r, delaySec * 1000));
        }

        return res.status(200).json({ message: 'Messages sent from file.' });
      } else if (receiver && message) {
        await sock.sendMessage(jid, { text: message });
        return res.status(200).json({ message: `Message sent to ${receiver}` });
      } else {
        return res.status(400).json({ error: 'Missing fields' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Sending failed', detail: err.message });
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
    
