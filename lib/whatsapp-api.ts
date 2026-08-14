/**
 * WhatsApp Business API helper
 * Uses the MagicXBot API proxy with the configured credentials.
 * API base: https://crm.magicxbot.com/api/meta
 */

const WHATSAPP_API_URL = process.env.WHATSAPP_API_URL || "https://crm.magicxbot.com/api/meta";
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v19.0";
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";

function getMessagesUrl(): string {
  return `${WHATSAPP_API_URL}/${WHATSAPP_API_VERSION}/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
}

function getAuthHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
  };
}

/**
 * Send a plain text message to a WhatsApp number.
 */
export async function sendWhatsAppText(to: string, body: string): Promise<any> {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: { body },
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send text message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }

  return res.json();
}

/**
 * Send a document message to a WhatsApp number via a public download URL.
 */
export async function sendWhatsAppDocument(
  to: string,
  link: string,
  filename: string,
  caption?: string
): Promise<void> {
  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "document",
    document: {
      link,
      filename,
      ...(caption ? { caption } : {}),
    },
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send document message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }
}

/**
 * Send a generic WhatsApp message payload (for advanced use).
 */
export async function sendWhatsAppMessage(payload: Record<string, unknown>): Promise<unknown> {
  const fullPayload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    ...payload,
  };

  const res = await fetch(getMessagesUrl(), {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify(fullPayload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error("[WhatsApp] Failed to send message:", errorText);
    throw new Error(`WhatsApp API error ${res.status}: ${errorText}`);
  }

  return res.json();
}
