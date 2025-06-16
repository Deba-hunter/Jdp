// ✅ Complete WhatsApp Auto Sender with Pairing Code Login + File Upload + Delay

const express = require('express');
const fs = require('fs');
const path = require('path');
const formidable = require('formidable');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;
const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

app.use(express.static(path.join(__dirname, 'public')));

let globalSock;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    browser: ['WhatsAppBot', 'Chrome', '1.0'],
    printQRInTerminal: false,
    getMessage: async () => ({ conversation: "Hello" })
  });

  sock.ev.on('creds.update', saveCreds);
  globalSock = sock;
  return sock;
}

startSock();

app.get('/pair', async (req, res) => {
  const number = req.query.number;
  if (!number) return res.status(400).json({ error: 'Missing number' });

  try {
    const sock = globalSock || await startSock();
    const code = await sock.requestPairingCode(number);
    console.log('✅ Pairing Code:', code);
    return res.json({ code });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
});

app.post('/send', (req, res) => {
  const form = new formidable.IncomingForm({ multiples: false });
  form.uploadDir = sessionFolder;

  form.parse(req, async (err, fields, files) => {
    if (err) return res.status(400).json({ error: 'Form parse failed' });

    const receiver = fields.receiver;
    const delay = parseInt(fields.delay || '2');
    if (!receiver) return res.status(400).json({ error: 'Receiver missing' });

    try {
      const sock = globalSock || await startSock();
      const jid = receiver + '@s.whatsapp.net';

      if (!files.file) return res.status(400).json({ error: 'No file uploaded' });

      const file = files.file;
      const filePath = file.filepath || file.path;
      const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);

      (async function sendLoop() {
        while (true) {
          for (const line of lines) {
            await sock.sendMessage(jid, { text: line });
            await new Promise(r => setTimeout(r, delay * 1000));
          }
        }
      })();

      res.json({ message: 'Messages are being sent in loop...' });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });
});

app.listen(PORT, () => {
  console.log('✅ Server running on http://localhost:' + PORT);
});
