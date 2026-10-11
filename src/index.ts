import * as XLSX from "xlsx";

interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
}

type TelegramMessage = {
  message_id: number;
  from?: { id: number; first_name?: string };
  chat: { id: number };
  text?: string;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
};

const MENU = {
  keyboard: [[{ text: "➕ واریز" }, { text: "➖ برداشت" }, { text: "📊 گزارش" }]],
  resize_keyboard: true,
  is_persistent: true
};

const PENDING_KEY = "hesabdar_pending_";

function digitsToEnglish(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[٬،,\s]/g, "");
}

async function telegram(env: Env, method: string, body: Record<string, unknown>): Promise<any> {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const result = await response.json<any>();
  if (!response.ok || !result.ok) throw new Error(`Telegram API ${method} failed`);
  return result;
}

async function sendText(env: Env, chatId: number, text: string): Promise<void> {
  await telegram(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: MENU
  });
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

function money(value: number): string {
  return new Intl.NumberFormat("fa-IR").format(value) + " تومان";
}

async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const chatId = message.chat.id;
  const userId = String(message.from?.id ?? "");
  const text = (message.text ?? "").trim();

  if (!userId || !text) return;

  // Each Telegram user accesses only their own ledger, keyed by their Telegram ID.
  if (text === "/id") {
    await sendText(env, chatId, `شناسه عددی تلگرام شما: ${userId}`);
    return;
  }

  if (text === "/start") {
    const summary = await getSummary(env, userId);
    await sendText(env, chatId,
      `سلام! ربات حسابدار آماده است.\n\nجمع واریزها: ${money(summary.deposits)}\nجمع برداشت‌ها: ${money(summary.withdrawals)}\nمانده فعلی: ${money(summary.balance)}\n\nاز سه دکمه زیر استفاده کن.`);
    return;
  }

  if (text === "➕ واریز" || text === "واریز") {
    await env.DB.prepare("INSERT OR REPLACE INTO bot_state (telegram_user_id, pending_kind) VALUES (?, 'deposit')").bind(userId).run();
    await sendText(env, chatId, "مبلغ واریز را به تومان وارد کن. مثال: ۵۰۰۰۰۰");
    return;
  }

  if (text === "➖ برداشت" || text === "برداشت") {
    await env.DB.prepare("INSERT OR REPLACE INTO bot_state (telegram_user_id, pending_kind) VALUES (?, 'withdrawal')").bind(userId).run();
    await sendText(env, chatId, "مبلغ برداشت را به تومان وارد کن. مثال: ۲۰۰۰۰۰");
    return;
  }

  if (text === "📊 گزارش" || text === "گزارش") {
    await sendExcelReport(env, chatId, userId);
    return;
  }

  const pending = await env.DB.prepare("SELECT pending_kind FROM bot_state WHERE telegram_user_id = ?")
    .bind(userId).first<{ pending_kind: string }>();

  if (pending?.pending_kind === "deposit" || pending?.pending_kind === "withdrawal") {
    const normalized = digitsToEnglish(text);
    if (!/^\d+$/.test(normalized)) {
      await sendText(env, chatId, "لطفاً فقط مبلغ را به عدد وارد کن؛ مثلاً ۵۰۰۰۰۰");
      return;
    }

    const amount = Number(normalized);
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      await sendText(env, chatId, "مبلغ باید عدد صحیح و بیشتر از صفر باشد. دوباره وارد کن.");
      return;
    }

    const kind = pending.pending_kind;
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO transactions (telegram_user_id, kind, amount, created_at) VALUES (?, ?, ?, ?)"
    ).bind(userId, kind, amount, now).run();
    await env.DB.prepare("DELETE FROM bot_state WHERE telegram_user_id = ?").bind(userId).run();

    const summary = await getSummary(env, userId);
    const label = kind === "deposit" ? "واریز" : "برداشت";
    await sendText(env, chatId,
      `✅ ${label} ثبت شد: ${money(amount)}\n\nجمع واریزها: ${money(summary.deposits)}\nجمع برداشت‌ها: ${money(summary.withdrawals)}\nمانده فعلی: ${money(summary.balance)}`);
    return;
  }

  await sendText(env, chatId, "از یکی از سه دکمه «واریز»، «برداشت» یا «گزارش» استفاده کن.");
}

async function sendExcelReport(env: Env, chatId: number, userId: string): Promise<void> {
  const rows = await env.DB.prepare(
    "SELECT id, kind, amount, created_at FROM transactions WHERE telegram_user_id = ? ORDER BY id ASC"
  ).bind(userId).all<{ id: number; kind: string; amount: number; created_at: string }>();

  let balance = 0;
  const sheetRows: (string | number)[][] = [
    ["شماره", "تاریخ و ساعت", "نوع تراکنش", "واریز (تومان)", "برداشت (تومان)", "مانده (تومان)"]
  ];

  let deposits = 0;
  let withdrawals = 0;
  for (const row of rows.results) {
    const isDeposit = row.kind === "deposit";
    if (isDeposit) {
      deposits += Number(row.amount);
      balance += Number(row.amount);
    } else {
      withdrawals += Number(row.amount);
      balance -= Number(row.amount);
    }
    sheetRows.push([
      Number(row.id),
      new Date(row.created_at).toLocaleString("fa-IR", { timeZone: "Asia/Tehran" }),
      isDeposit ? "واریز" : "برداشت",
      isDeposit ? Number(row.amount) : 0,
      isDeposit ? 0 : Number(row.amount),
      balance
    ]);
  }

  if (rows.results.length === 0) {
    sheetRows.push(["", "", "هنوز تراکنشی ثبت نشده است", 0, 0, 0]);
  }

  const summaryRows = [
    ["عنوان", "مبلغ (تومان)"],
    ["جمع واریزها", deposits],
    ["جمع برداشت‌ها", withdrawals],
    ["مانده فعلی", balance]
  ];

  const workbook = XLSX.utils.book_new();
  const ledger = XLSX.utils.aoa_to_sheet(sheetRows);
  ledger["!cols"] = [{ wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(workbook, ledger, "گردش حساب");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summaryRows), "خلاصه حساب");

  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  const file = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  });

  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("caption", "گزارش اکسل حسابداری — مانده در هر ردیف درج شده است.");
  form.append("document", file, "gozaresh-hesab.xlsx");

  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`, {
    method: "POST",
    body: form
  });
  const result = await response.json<any>();
  if (!response.ok || !result.ok) {
    await sendText(env, chatId, "ساخت گزارش انجام شد اما ارسال فایل با خطا روبه‌رو شد. دوباره تلاش کن.");
    return;
  }

  const summary = await getSummary(env, userId);
  await sendText(env, chatId,
    `گزارش آماده شد.\nجمع واریزها: ${money(summary.deposits)}\nجمع برداشت‌ها: ${money(summary.withdrawals)}\nمانده فعلی: ${money(summary.balance)}`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return new Response("ربات حسابدار Cloudflare فعال است.", { status: 200 });
    }

    if (url.pathname === `/setup/${env.WEBHOOK_SECRET}` && request.method === "GET") {
      const webhookUrl = `${url.origin}/telegram/${env.WEBHOOK_SECRET}`;
      const result = await telegram(env, "setWebhook", {
        url: webhookUrl,
        allowed_updates: ["message"],
        drop_pending_updates: false
      });
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
          console.error("Update processing failed", error);
          if (update.message.chat?.id) {
            try { await sendText(env, update.message.chat.id, "خطایی رخ داد. لطفاً دوباره تلاش کن."); } catch {}
          }
        }
      }
      return new Response("OK");
    }

    return new Response("Not found", { status: 404 });
  }
};
