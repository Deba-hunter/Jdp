const express = require('express');
const fs = require('fs');
const path = require('path');
const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');

const app = express();
const PORT = process.env.PORT || 3000;

const sessionFolder = path.join(__dirname, 'session');
if (!fs.existsSync(sessionFolder)) fs.mkdirSync(sessionFolder);

let globalSock = null;

async function startSock() {
  const { state, saveCreds } = await useMultiFileAuthState(sessionFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: ['Chrome', 'Baileys', '1.0'],
    getMessage: async () => ({ conversation: "hi" }),
  });

  sock.ev.on('creds.update', saveCreds);
  globalSock = sock;
  return sock;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/pair', async (req, res) => {
  try {
    const phone = req.query.number;
    if (!phone) return res.status(400).json({ error: 'Phone number required' });

    const sock = globalSock || await startSock();

    if (!sock.authState.creds.registered) {
      const code = await sock.requestPairingCode(phone);
      console.log('✅ Pairing Code:', code);
      return res.json({ code });
    } else {
      return res.json({ message: '✅ Already logged in.' });
    }

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Pairing failed', detail: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
