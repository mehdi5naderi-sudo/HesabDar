interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}

type TelegramMessage = {
  message_id: number;
  from?: { id: number };
  chat: { id: number };
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

// Keep the balance label centralized so the existing message can be edited in place.
const BALANCE_TEXT = "💰 مانده فعلی";

function digitsToEnglish(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => "۰۱۲۳۴۵۶۷۸۹".indexOf(d).toString())
    .replace(/[٠-٩]/g, (d) => "٠١٢٣٤٥٦٧٨٩".indexOf(d).toString())
    .replace(/[٬،,\s]/g, "");
}

function money(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value) + " تومان";
}

async function telegram(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json<any>();
  if (!response.ok || !result.ok) {
    throw new Error(`Telegram ${method} failed: ${result.description ?? response.statusText}`);
  }
  return result;
}

async function sendText(env: Env, chatId: number, text: string): Promise<any> {
  return telegram(env, "sendMessage", { chat_id: chatId, text });
}

async function getSummary(env: Env, userId: string): Promise<{ deposits: number; withdrawals: number; balance: number }> {
  const row = await env.DB.prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN kind = 'deposit' THEN amount ELSE 0 END), 0) AS deposits,
       COALESCE(SUM(CASE WHEN kind = 'withdrawal' THEN amount ELSE 0 END), 0) AS withdrawals
     FROM transactions WHERE telegram_user_id = ?`
  ).bind(userId).first<{ deposits: number; withdrawals: number }>();
  const deposits = Number(row?.deposits ?? 0);
  const withdrawals = Number(row?.withdrawals ?? 0);
  return { deposits, withdrawals, balance: deposits - withdrawals };
}

/**
 * Keep one balance message in the chat: edit it in place whenever possible.
 * Only send a replacement if Telegram says the saved message no longer exists.
 * Other API errors must not trigger another message, because that could create duplicates.
 */
async function refreshBalanceMessage(env: Env, chatId: number, userId: string, balance: number): Promise<void> {
  const text = `${BALANCE_TEXT}: ${money(balance)}`;

  const saved = await env.DB.prepare(
    "SELECT message_id FROM balance_messages WHERE telegram_user_id = ?"
  ).bind(userId).first<{ message_id: number }>();

  if (saved?.message_id) {
    try {
      await telegram(env, "editMessageText", {
        chat_id: chatId,
        message_id: saved.message_id,
        text
      });
      return;
    } catch (error) {
      const reason = String(error);
      if (reason.includes("message is not modified")) {
        return;
      }

      // Only recreate the message when Telegram confirms the old message is gone.
      if (!/message to edit not found|message_id_invalid|message can't be edited|message to edit is not found/i.test(reason)) {
        console.error("editMessageText failed; not sending a duplicate balance message", error);
        return;
      }
    }
  }

  const sent = await sendText(env, chatId, text);
  const messageId = sent?.result?.message_id;
  if (messageId) {
    await env.DB.prepare(
      "INSERT OR REPLACE INTO balance_messages (telegram_user_id, message_id) VALUES (?, ?)"
    ).bind(userId, messageId).run();
  }
}

async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const userId = String(message.from?.id ?? "");
  const text = (message.text ?? "").trim();
  if (!userId || !text) return;

  if (text === "/start") {
    // Do not send a welcome/help message; keep the chat compact.
    return;
  }

  const match = text.match(/^(واریز|برداشت)\s+([\d۰-۹٠-٩٬،,\s]+)$/u);
  if (!match) {
    // Ignore unrelated messages and malformed entries instead of cluttering the chat.
    return;
  }

  const kind = match[1] === "واریز" ? "deposit" : "withdrawal";
  const normalized = digitsToEnglish(match[2]);
  const amount = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(amount) || amount <= 0) {
    return;
  }

  await env.DB.prepare(
    "INSERT INTO transactions (telegram_user_id, kind, amount, created_at) VALUES (?, ?, ?, ?)"
  ).bind(userId, kind, amount, new Date().toISOString()).run();

  const summary = await getSummary(env, userId);
  await refreshBalanceMessage(env, chatId, userId, summary.balance);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("ربات حسابدار فعال است.", { status: 200 });
    }

    if (url.pathname === `/setup/${env.WEBHOOK_SECRET}` && request.method === "GET") {
      const webhookUrl = `${url.origin}/telegram/${env.WEBHOOK_SECRET}`;
      const result = await telegram(env, "setWebhook", { url: webhookUrl, allowed_updates: ["message"] });
      return Response.json({ ok: true, webhook: webhookUrl, telegram: result.result });
    }

    if (url.pathname === `/telegram/${env.WEBHOOK_SECRET}` && request.method === "POST") {
      let update: TelegramUpdate;
      try {
        update = await request.json<TelegramUpdate>();
      } catch {
        return new Response("Bad JSON", { status: 400 });
      }
      if (update.message) {
        try {
          await handleMessage(env, update.message);
        } catch (error) {
          console.error("Update failed", error);
        }
      }
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
};
