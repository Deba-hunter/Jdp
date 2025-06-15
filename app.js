const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

// Create session directory if not exists
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

app.use(express.static('public'));

// Main setup
app.all('/api', async (req, res) => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Bot', 'Render', '1.0'],
    getMessage: async () => ({ conversation: 'hello' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // GET: Generate pairing code
  if (req.method === 'GET') {
    try {
      const phone = req.query.phone;
      if (!phone) return res.status(400).json({ error: 'Missing ?phone=91xxxxxx param' });

      if (!sock.authState.creds.registered) {
        const { code } = await sock.requestPairingCode(phone);
        return res.status(200).json({ code });
      } else {
        return res.status(200).json({ message: 'Already logged in' });
      }
    } catch (err) {
      return res.status(500).json({ error: 'Login failed', detail: err.message });
    }
  }

  // POST: Send message or file
  if (req.method === 'POST') {
    const form = new formidable.IncomingForm({ multiples: false });
    form.uploadDir = path.join(__dirname, 'session');

    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ error: 'Form parse error' });

      const { receiver, message, delay } = fields;
      const delaySec = parseInt(delay) || 2;

      try {
        const jid = receiver + '@s.whatsapp.net';

        if (files.file) {
          const file = Array.isArray(files.file) ? files.file[0] : files.file;
          const filePath = file.filepath || file.path;
          const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
          }

          return res.status(200).json({ message: `Messages sent from file to ${receiver}` });

        } else if (receiver && message) {
          await sock.sendMessage(jid, { text: message });
          return res.status(200).json({ message: `Message sent to ${receiver}` });
        } else {
          return res.status(400).json({ error: 'Missing receiver or message/file' });
        }
      } catch (err) {
        return res.status(500).json({ error: 'Sending failed', detail: err.message });
      }
    });
  } else {
    res.status(405).json({ error: 'Invalid method' });
  }

});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

                       
