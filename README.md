# ربات حسابدار شخصی تلگرام

ساده‌ترین ربات حسابداری: فقط `واریز` و `برداشت` بنویس، مانده پایین چت همیشه هست.

## راه‌اندازی

۱. در Cloudflare مسیر **Workers & Pages → D1 → hesabdar-db → Console** را باز کن و محتوای `schema.sql` را اجرا کن.
۲. در **Settings → Variables and Secrets** دو Secret تنظیم کن:
- `TELEGRAM_BOT_TOKEN` — توکن BotFather
- `WEBHOOK_SECRET` — یک رشته تصادفی بلند
۳. آدرس `https://نام-worker.workers.dev/setup/مقدار-WEBHOOK_SECRET` را در مرورگر باز کن تا Webhook ثبت شود.
۴. به ربات پیام `/start` بفرست.

## استفاده

- `واریز 1000` — ثبت واریز
- `برداشت 500` — ثبت برداشت
- پیام مانده به‌صورت خودکار در همان چت به‌روز می‌شود
