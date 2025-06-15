const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure session directory exists
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

app.use(express.static('public'));

app.all('/api', async (req, res) => {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['WhatsApp-Bot', 'Render', '1.0'],
    getMessage: async () => ({ conversation: 'hi' }),
  });

  sock.ev.on('creds.update', saveCreds);

  // GET → Generate Pairing Code
  if (req.method === 'GET') {
    const phone = req.query.phone;
    if (!phone) return res.status(400).json({ error: 'Missing ?phone=91xxxxxxx' });

    try {
      sock.ev.once('connection.update', async (update) => {
        if (update.connection === 'open') {
          if (!sock.authState.creds.registered) {
            const { code } = await sock.requestPairingCode(phone);
            return res.status(200).json({ code });
          } else {
            return res.status(200).json({ message: 'Already logged in' });
          }
        } else if (update.connection === 'close') {
          const shouldReconnect = update.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
          if (!shouldReconnect) {
            return res.status(500).json({ error: 'Disconnected' });
          }
        }
      });
    } catch (err) {
      return res.status(500).json({ error: 'Login failed', detail: err.message });
    }
  }

  // POST → Send Message
  else if (req.method === 'POST') {
    const form = new formidable.IncomingForm();

    form.parse(req, async (err, fields) => {
      if (err) return res.status(500).json({ error: 'Form parse error' });

      const receiver = fields.receiver?.trim();
      const message = fields.message?.trim();
      const delay = parseInt(fields.delay) || 2;

      if (!receiver || !message) {
        return res.status(400).json({ error: 'receiver and message are required' });
      }

      const jid = receiver + '@s.whatsapp.net';

      try {
        await sock.sendMessage(jid, { text: message });
        await new Promise(resolve => setTimeout(resolve, delay * 1000));
        return res.status(200).json({ message: 'Message sent!' });
      } catch (err) {
        return res.status(500).json({ error: 'Sending failed', detail: err.message });
      }
    });
  }

  else {
    res.status(405).json({ error: 'Invalid method' });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});
    
