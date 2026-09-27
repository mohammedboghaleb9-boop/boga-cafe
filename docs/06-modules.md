# 06 · دليل الأقسام: أين يوجد كل شيء وكيف أعدّله

> **قبل لمس الكود:** كثير من التعديلات تُنجز من **لوحة الإدارة** مباشرة (الأسعار، المنتجات، المخزون، المدن، النصوص، روابط التواصل، القواعد). الكود فقط للتصميم والميزات الجديدة.

## 1. خريطة الأقسام

| القسم | الرابط | المجلد | ملفات مهمة |
|---|---|---|---|
| الرئيسية | `/` | `src/features/home` | `HomePage.tsx` (ترتيب الأقسام) + `sections/*.tsx` (كل قسم ملف) |
| المتجر | `/shop` | `src/features/shop` | `ShopPage.tsx`، `ProductCard.tsx` (بطاقة المنتج المستعملة في كل مكان) |
| صفحة المنتج | `/product/:slug` | `src/features/product` | `ProductPage.tsx` |
| أحادي المصدر | `/single-origin` | `src/features/single-origin` | |
| الخلطة الخاصة | `/custom-blend` | `src/features/custom-blend` | `CustomBlendPage.tsx`، `blend-helpers.ts` |
| المهنيون B2B | `/b2b` | `src/features/b2b` | `SampleRequestForm.tsx`، `QuoteRequestForm.tsx` |
| السلة | `/cart` | `src/features/cart` | `CartPage.tsx`، `CartProvider.tsx` (حالة السلة) |
| الدفع وصفحة الطلب | `/checkout`، `/order/:id` | `src/features/checkout` | `CheckoutPage.tsx`، `PaymentPanel.tsx`، `OrderPage.tsx` |
| اتصل بنا | `/contact` | `src/features/contact` | |
| الإدارة | `/admin/...` | `src/features/admin` | مجلد لكل قسم + `permissions.ts` |
| الرأس والتذييل | كل الصفحات | `src/shared/layout` | `Header.tsx`، `Footer.tsx`، `SocialLinks.tsx` |
| صورة المنتج | المتجر، المنتج، الخلطة الخاصة | `src/shared/ui/ProductVisual.tsx` + `src/shared/sticker.ts` | الكيس الحقيقي + ملصق المنتج المولَّد من البيانات |
| الصور والشعار | كل الصفحات | `src/shared/media.ts` + `src/assets/` | القائمة المعتمدة في `docs/08-visual-assets.md` |
| الحركة مع السكرول | كل المتجر | `src/styles/motion.css` | تُطفأ تلقائياً عند من يطلب تقليل الحركة |

## 2. تعديلات شائعة

### تغيير الألوان أو الخطوط
`src/styles/tokens.css` فقط. المتجر يستعمل دائماً ألوان «الكيس الأسود» (آخر كتلة في الملف)، ولوحة الإدارة تستعمل الوضع الفاتح أو الداكن حسب جهاز المستخدم.

### تبديل صورة
ضع الملف الجديد في `src/assets/photos/` بنفس الاسم وحدّث مقاسه في `src/shared/media.ts`. القواعد في `docs/08-visual-assets.md`.

### تعديل الحركة مع السكرول
`src/styles/motion.css`: كل حركة في كتلة واحدة (الصورة الافتتاحية، الظهور التدريجي، التأثير العمقي، ختم الخلطة الخاصة، الرأس).

### تغيير نص ثابت في الواجهة (زر، عنوان…)
`src/i18n/dictionaries/ar.ts` و `fr.ts` و `en.ts` — نفس المفتاح في الملفات الثلاثة. إن نسيت لغة، يرفض المشروع البناء ويخبرك بالمكان.

### تغيير نص الصفحة الرئيسية أو شريط الإعلان
من الإدارة: **المحتوى**. (دون كود)

### إضافة/حذف/ترتيب قسم في الصفحة الرئيسية
`src/features/home/HomePage.tsx`: القائمة `sections`. لإضافة قسم: أنشئ ملفاً في `sections/` وأضفه للقائمة.

### تغيير سعر، وصفة، منتج، أو إخفاؤه
من الإدارة: **المنتجات والخلطات**.

### تغيير المخزون أو إيقاف مصدر في الخلطة الخاصة
من الإدارة: **المخزون والمصادر** (زر «تعديل المخزون» + مفتاح «في الخلطة الخاصة»).

### تغيير حد 10 كلغ، الحد الأدنى للنسب، رسوم الكيس
من الإدارة: **الإعدادات**.

### تغيير صلاحيات دور
`src/features/admin/permissions.ts` (القائمة والمسارات تتبع تلقائياً). في الإنتاج: نفس القاعدة في سياسات قاعدة البيانات (`supabase/migrations`).

### إضافة طريقة دفع جديدة
1. `src/core/types.ts`: أضف المعرّف إلى `PaymentMethodId`.
2. `src/services/payments/index.ts`: أضف محوّلاً (adapter) يحدد الخطوة التالية.
3. أضفها في `src/data/seed/config.ts` (أو من قاعدة البيانات في الإنتاج).
صفحة الدفع لا تحتاج أي تعديل.

### تغيير نص رسائل واتساب/البريد للإدارة
`src/services/notifications/templates.ts`.

### إضافة لغة رابعة (مثلاً الإسبانية)
1. أنشئ `src/i18n/dictionaries/es.ts` (انسخ `fr.ts`).
2. أضف `'es'` إلى `Locale` في `src/core/types.ts` وإلى `LOCALES` في `src/i18n/index.tsx`.
3. TypeScript سيشير إلى كل مكان يحتاج نصاً إسبانياً (المنتجات، المدن…).

### إضافة علم بلد جديد
`src/shared/ui/Flag.tsx`. بدون رسم، يظهر رمز البلد (مثلاً `PE`) تلقائياً.

## 3. قواعد العمل التي تحمي المشروع

1. **منطق الأعمال في `src/core` فقط.** لا تحسب سعراً أو مخزوناً داخل صفحة.
2. **الصفحات لا تعرف أين تُخزّن البيانات**: فقط `api` و `hooks` من `src/data`.
3. **كل نص ظاهر للزبون في القواميس** أو في الإدارة، وليس مكتوباً داخل الكود.
4. **كل قاعدة جديدة = اختبار جديد** في `src/core/__tests__`.
5. **CSS بخصائص منطقية** (`margin-inline-start` بدل `margin-left`) لتعمل العربية تلقائياً.
