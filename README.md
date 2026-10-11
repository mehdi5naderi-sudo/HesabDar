# ربات حسابدار تلگرام روی Cloudflare

این نسخه برای اجرای رایگان روی Cloudflare Workers و ذخیره ماندگار تراکنش‌ها در D1 طراحی شده است. سه دکمه اصلی دارد: واریز، برداشت و گزارش. توضیحات تراکنش پرسیده نمی‌شود. مبلغ‌ها تومان هستند و مانده پس از هر تراکنش نمایش داده می‌شود. فایل Excel در شیت اول، مانده را در هر ردیف دارد.

## فایل‌ها
- `src/index.ts`: کد ربات
- `schema.sql`: ساخت جدول‌های پایگاه داده
- `wrangler.toml`: اتصال Worker به D1

## راه‌اندازی
1. در Cloudflare از بخش Workers & Pages یک D1 database با نام `hesabdar-db` بساز.
2. شناسه D1 را از داشبورد کپی و جایگزین `REPLACE_WITH_D1_DATABASE_ID` در `wrangler.toml` کن.
3. محتوای `schema.sql` را در بخش Console پایگاه داده اجرا کن. علاوه بر جدول تراکنش‌ها، این جدول وضعیت انتظار را هم بساز:
   ```sql
   CREATE TABLE IF NOT EXISTS bot_state (
     telegram_user_id TEXT PRIMARY KEY,
     pending_kind TEXT NOT NULL CHECK (pending_kind IN ('deposit', 'withdrawal'))
   );
   ```
4. Worker را از طریق Git integration یا Wrangler منتشر کن.
5. در Settings > Variables and Secrets سه Secret اضافه کن:
   - `TELEGRAM_BOT_TOKEN`: توکن BotFather
   - `TELEGRAM_OWNER_ID`: شناسه عددی تلگرام صاحب حساب
   - `WEBHOOK_SECRET`: یک رشته تصادفی طولانی و محرمانه
6. در مرورگر آدرس `https://نام-worker.نام-کاربری.workers.dev/setup/WEBHOOK_SECRET` را باز کن؛ به جای `WEBHOOK_SECRET` مقدار واقعی Secret را قرار بده. پاسخ باید `ok: true` داشته باشد.
7. در تلگرام به ربات پیام `/start` بده.

برای پیدا کردن شناسه عددی تلگرام، پیش از تنظیم `TELEGRAM_OWNER_ID` به ربات پیام `/id` بده؛ شناسه‌ای که برمی‌گرداند را در Secret قرار بده، سپس دوباره `/start` بفرست.

## حریم خصوصی
ربات فقط به شناسه ثبت‌شده در `TELEGRAM_OWNER_ID` اجازه ثبت و مشاهده تراکنش می‌دهد. توکن ربات را هرگز در کد یا مخزن GitHub قرار نده.
