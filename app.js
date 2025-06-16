const express = require("express");
const fs = require("fs");
const path = require("path");
const formidable = require("formidable");
const { makeWASocket, useMultiFileAuthState } = require("baileys");

const app = express();
const PORT = process.env.PORT || 3000;
const sessionPath = path.join(__dirname, "session");

if (!fs.existsSync(sessionPath)) fs.mkdirSync(sessionPath);

let sock;
let isLoggedIn = false;

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// Show index.html (phone number form)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public/index.html"));
});

// Handle phone number input and start session after 2 mins
app.post("/start", express.urlencoded({ extended: true }), async (req, res) => {
  const phone = req.body.phone;
  console.log("📱 Phone received:", phone);

  setTimeout(async () => {
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
    sock = makeWASocket({
      auth: state,
      generateHighQualityLinkPreview: true,
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      const { connection, pairingCode } = update;
      if (pairingCode) console.log("🔗 Pairing Code:", pairingCode);
      if (connection === "open") {
        isLoggedIn = true;
        console.log("✅ WhatsApp logged in!");
      }
    });

    sock.ev.on("messages.upsert", () => {});
  }, 2 * 60 * 1000); // 2 minutes

  res.send("⏳ Please wait 2 minutes... Check terminal for code.");
});

// Show message sending UI after login
app.get("/send", (req, res) => {
  if (!isLoggedIn) return res.send("❌ Not logged in yet. Please complete pairing.");
  res.sendFile(path.join(__dirname, "public/send.html"));
});

// Handle message send request
app.post("/send", (req, res) => {
  const form = formidable({ multiples: false });
  form.parse(req, async (err, fields, files) => {
    const { receiver, delay, repeat } = fields;
    if (!receiver || !sock?.user) return res.status(400).send("Missing data or not logged in.");

    let message = "Hello from WhatsApp Automation!";
    if (files.messageFile && files.messageFile.filepath) {
      message = fs.readFileSync(files.messageFile.filepath, "utf-8");
    }

    const delayMs = Number(delay || 2) * 1000;
    const repeatCount = Number(repeat || 1);

    for (let i = 0; i < repeatCount; i++) {
      await sock.sendMessage(receiver + "@s.whatsapp.net", { text: message });
      await new Promise((r) => setTimeout(r, delayMs));
    }

    res.send("✅ Messages sent.");
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
         
