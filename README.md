# استوديو الصوت السوري | Syrian Audio Studio

منصة ويب عربية تعمل على **GitHub Pages فقط** — بدون خادم منفصل.

## الرابط

[https://yasseralmofaalani.github.io/SyrianAudioStudio/](https://yasseralmofaalani.github.io/SyrianAudioStudio/)

## ماذا يعمل على GitHub Pages

| الميزة | الحالة |
|---|---|
| استيراد مجلد / ملفات | ✅ داخل المتصفح |
| تحويل الصوت (FFmpeg.wasm) | ✅ داخل المتصفح |
| الاستماع والتنزيل و ZIP | ✅ |
| إرسال Telegram | ✅ من المتصفح مباشرة إلى Bot API |

## الاستخدام

1. افتح رابط GitHub Pages  
2. انتظر حتى تظهر حالة **FFmpeg جاهز في المتصفح**  
3. استورد الملفات → حوّل → نزّل أو أرسل لتلغرام  
4. لـ Telegram: Bot Token + Chat ID، والمستلم يضغط Start على البوت أولاً  

## ملاحظات

- أول تحويل قد يتأخر قليلاً أثناء تحميل محرك FFmpeg في المتصفح.  
- رمز البوت يُحفظ في جلسة المتصفح فقط (sessionStorage) وليس في GitHub.  
- الملفات الكبيرة جداً قد تكون أبطأ في المتصفح من خادم مخصص.

## تطوير محلي (اختياري)

```bash
npm install
npm start
```

يفتح نفس الواجهة مع خادم Node إن رغبت.

## الترخيص

MIT
