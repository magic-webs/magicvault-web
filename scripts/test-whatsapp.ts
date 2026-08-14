import fs from "fs";
import path from "path";

// Load .env.local FIRST before loading any modules
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, "utf-8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      const idx = trimmed.indexOf("=");
      if (idx !== -1) {
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim();
        process.env[key] = val;
      }
    }
  }
}

async function runTest() {
  const { sendWhatsAppText } = await import("../lib/whatsapp-api");
  const targetNumber = process.argv[2] || "918926029883";
  const text = process.argv[3] || "Hello! This is a test message from MagicVault.";

  console.log(`Sending WhatsApp message to ${targetNumber}...`);
  console.log(`Text: "${text}"`);

  try {
    const response = await sendWhatsAppText(targetNumber, text);
    console.log("\nAPI RESPONSE:");
    console.log(JSON.stringify(response, null, 2));
  } catch (err: any) {
    console.error("FAILURE:", err.message);
  }
}

runTest();
