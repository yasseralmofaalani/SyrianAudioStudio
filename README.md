# استوديو الصوت السوري | Syrian Audio Studio

منصة ويب عربية (RTL) لمعالجة وتحويل الملفات الصوتية وإرسالها إلى Telegram.

## حقيقة مهمة عن GitHub Pages

**GitHub Pages لا يشغّل Node أو FFmpeg أو Telegram.**  
هو موقع ملفات ثابتة فقط.

لذلك التشغيل الكامل يتم بأحد طريقين:

| الطريقة | التحويل | Telegram | الرابط |
|---|---|---|---|
| **Render (موصى به)** — نشر من GitHub | ✅ خادم حقيقي | ✅ | `*.onrender.com` |
| **محلياً** `npm start` | ✅ | ✅ | `http://127.0.0.1:3847` |
| **GitHub Pages وحده** | ⚠️ داخل المتصفح فقط | ❌ | `*.github.io` |

---

## التشغيل الكامل على الإنترنت (Render) — موصى به

1. افتح:  
   [Deploy to Render](https://render.com/deploy?repo=https://github.com/yasseralmofaalani/SyrianAudioStudio)
2. اربط حساب GitHub واختر المستودع.
3. اختر الخطة **Free** ثم **Create**.
4. بعد انتهاء النشر انسخ رابط الخدمة مثل:  
   `https://syrian-audio-studio.onrender.com`
5. افتح هذا الرابط — الموقع يعمل بالكامل (واجهة + تحويل + Telegram).

### ربط GitHub Pages بالخادم السحابي (اختياري)

إذا أردت الإبقاء على رابط GitHub Pages:

1. افتح [https://yasseralmofaalani.github.io/SyrianAudioStudio/](https://yasseralmofaalani.github.io/SyrianAudioStudio/)
2. **الإعدادات** → الصق رابط Render → **حفظ وإعادة التحميل**
3. بعدها Pages تستخدم خادم Render لكل الخدمات.

أو عدّل الملف `js/config.js`:

```js
export const CLOUD_API = 'https://YOUR-SERVICE.onrender.com';
```

---

## التشغيل المحلي

```bash
git clone https://github.com/yasseralmofaalani/SyrianAudioStudio.git
cd SyrianAudioStudio
npm install
copy .env.example .env
npm start
```

ثم افتح: [http://127.0.0.1:3847](http://127.0.0.1:3847)

---

## المتغيرات البيئية

| المتغير | الوصف |
|---|---|
| `PORT` | منفذ الخادم (Render يضبطه تلقائياً) |
| `HOST` | الافتراضي `0.0.0.0` للنشر |
| `TELEGRAM_BOT_TOKEN` | اختياري |
| `TELEGRAM_CHAT_ID` | اختياري |
| `API_KEY` | اختياري لحماية `/api` |

---

## الترخيص

MIT
