# استوديو الصوت السوري | Syrian Audio Studio

منصة ويب عربية (RTL) لمعالجة وتحويل الملفات الصوتية دفعة واحدة، والاستماع للنتائج، وإرسالها إلى Telegram عبر Bot API الرسمي.

## المتطلبات

- Node.js 18 أو أحدث
- اتصال بالإنترنت عند التثبيت الأول (لتحميل `ffmpeg-static` / `ffprobe-static`)

> لا تحتاج لتثبيت FFmpeg يدوياً على النظام: المشروع يستخدم حزم Node الثنائية الجاهزة.

## التثبيت والتشغيل

```bash
git clone https://github.com/yasseralmofaalani/SyrianAudioStudio.git
cd SyrianAudioStudio
npm install
copy .env.example .env
npm start
```

ثم افتح المتصفح على:

[http://127.0.0.1:3847](http://127.0.0.1:3847)

## التشغيل من GitHub Pages

الموقع:
[https://yasseralmofaalani.github.io/SyrianAudioStudio/](https://yasseralmofaalani.github.io/SyrianAudioStudio/)

على GitHub Pages تعمل الواجهة داخل المتصفح:
- استيراد الملفات / المجلدات
- تحويل الصوت عبر **FFmpeg.wasm** (في المتصفح)
- الاستماع والتنزيل و ZIP

**Telegram** يحتاج خادم Node (`npm start`) لأنه يتطلّب إخفاء رمز البوت على السيرفر.

### تفعيل Pages مرة واحدة من GitHub
1. Repository → **Settings** → **Pages**
2. Source: **GitHub Actions**
3. بعد الدفع لـ `main` يُنشر تلقائياً عبر workflow

للتطوير مع إعادة التشغيل التلقائي:

```bash
npm run dev
```

## المتغيرات البيئية (`.env`)

| المتغير | الوصف |
|---|---|
| `PORT` | منفذ الخادم (افتراضي 3847) |
| `HOST` | المضيف (افتراضي 127.0.0.1) |
| `MAX_FILE_SIZE_MB` | الحد الأقصى لحجم الملف |
| `MAX_FILES_PER_JOB` | أقصى عدد ملفات لكل جلسة |
| `CONCURRENCY` | عدد التحويلات المتزامنة |
| `TELEGRAM_BOT_TOKEN` | اختياري — إعداد دائم للبوت |
| `TELEGRAM_CHAT_ID` | اختياري — معرّف المحادثة الدائم |
| `API_KEY` | اختياري — حماية `/api` عند النشر العام |

**مهم:** لا تضع Bot Token داخل ملفات JavaScript الأمامية. الرمز يُرسل مرة واحدة إلى الخادم ويُحفظ في ذاكرة الجلسة فقط (أو عبر `.env` على السيرفر).

## الاستخدام السريع

1. من **استيراد الملفات**: اختر مجلداً (`webkitdirectory`) أو عدة ملفات أو اسحبها وأفلتها.
2. من **تحويل الصوت**: اختر الصيغة (الافتراضي MP3) والجودة (الافتراضي 192 kbps) ثم اضغط **بدء التحويل**.
3. راقب التقدم دون تجمد الواجهة (طابور متزامن).
4. من **مكتبة الملفات**: استمع للأصلي/المحوّل، نزّل ملفاً أو ZIP.
5. من **مركز Telegram**: اربط البوت، ثم أرسل المحدّد أو الكل.

## صيغ الإخراج

MP3 · M4A/AAC · OGG · OPUS · WAV · FLAC

## الأمان

- أوامر FFmpeg تُنفَّذ كمصفوفة معاملات بدون shell.
- منع Path Traversal عند قراءة/تنزيل الملفات.
- التحقق من نوع الملف (امتداد + محتوى/ffprobe).
- عدم تسجيل التوكن الكامل في السجلات.
- تنظيف المجلدات المؤقتة وفق `UPLOAD_TTL_HOURS`.

## هيكل المشروع

```text
syrian-audio-studio/
├── index.html
├── package.json
├── .env.example
├── README.md
├── css/
├── js/
├── server/
├── assets/
├── uploads/
└── converted/
```

## ملاحظات Telegram

- الإرسال كـ **Voice** يتطلب OGG/OPUS.
- حد الحجم الشائع لملفات البوت ≈ 50MB.
- حالة النجاح تظهر فقط بعد استجابة `ok` من Telegram مع `message_id`.

## الترخيص

MIT — للاستخدام الداخلي والوطني حسب رغبتك.
