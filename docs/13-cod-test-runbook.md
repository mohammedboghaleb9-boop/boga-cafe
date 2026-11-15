# 13 · Runbook: أول تجربة COD حقيقية من التليفون

كُتب 2026-11-15 (فرع `claude/sweet-hopper-4bqf9z`). الهدف: طلب COD واحد حقيقي من تليفون، من البداية حتى الآخر، بلا ما يبقى البيع مفتوح لحد آخر.
الحالة اللي تبنى عليها (قراءة Supabase 2026-11-14، قراية فقط): 23 migration مطبّقين (2026-11-15: 24، آخرها `20261115090000`)، `cod` مفعّل والباقي مطفي، `salesOpen` = NULL، 0 طلب، 0 منتج active، 0 مدينة active، 0 كغ ستوك، `storefront` v12 (2026-11-13)، الـ job `expire-unpaid-orders` خدام كل 15 دقيقة، `notify-outbox` ما منشوراش، Vault خاوي.

## 0. شكون كيدير شنو

| الخطوة | شكون | واش كتبدّل production |
|---|---|---|
| الكود، الاختبارات، الـ PR | Claude | لا |
| تطبيق الـ migration `20261115090000` (SQL Editor) | Claude بموافقة المالك، تدار 2026-11-15 | نعم (سالات) |
| الدمج فـ `main` (كينشر الموقع أوتوماتيكياً) | المالك | نعم |
| منتج TEST، الستوك، المدينة والثمن ديال التوصيل | المالك (Admin) | نعم |
| فتح وإغلاق البيع | المالك (Admin، TOTP) | نعم |
| الطلب من التليفون | المالك | نعم (طلب حقيقي) |
| استعلامات التحقق (SELECT فقط) | Claude أو المالك | لا |

## 1. قبل نهار التجربة (مرة وحدة)

1. **الـ migration: تدارت 2026-11-15** (Claude، بموافقة المالك): النتيجة `true / true / 1`، والـ job ديال الانتهاء خدم بيها 09:00 و09:15 و09:30Z. **ما تعاودش تشغّل الـ block:** دابا كيوقف بـ `stop: 20261115090000 is already in the history`، وهادا عادي (حماية).
2. **من بعد الدمج:** تأكد أن الموقع الحي تبدّل (Claude يقارن البصمة ديال الملفات). الـ `storefront` ما خاصهاش redeploy: الـ bundle ديالها هو نفسو (SHA-256 `5aebf1b1…8271`).
3. **Turnstile:** فـ Supabase ← Edge Functions ← Secrets، تأكد بعينك (بلا ما تنقل القيم) أن `TURNSTILE_SECRET_KEY` و `TURNSTILE_HOSTNAMES` كاينين، وأن `TURNSTILE_HOSTNAMES` فيه `bogacafe.ma`. بلا هادشي كل طلب كيترفض (`captcha`)، وما كيضيع والو.
4. **الحسابات:** جوج حسابات admin فقط (أنت و Abderrahim)، بجوج `owner` بـ TOTP (مقروء 2026-11-14). ما كاين حتى حساب ثالث يتزاد.

## 2. نهار التجربة (نافذة قصيرة، 30 دقيقة تقريباً)

1. **Admin ← Produits & blends و Stock & origines:** منتج واحد (مثلاً `TEST`) active بثمن حقيقي ولا رمزي، والأصل ديالو active، بستوك صغير (مثلاً 2 كغ). سجّل الستوك قبل.
2. **Admin ← Livraison:** مدينة وحدة active (مدينتك) بثمن توصيل > 0.
3. **Admin ← Paramètres ← Ventes:** «Ouvrir les ventes» (owner، TOTP).
4. **من التليفون (بالعربية، 390 px):**
   - زيد المنتج للسلة، سير لـ checkout: قبل ما تختار المدينة، المجموع خاصو يبان «—» والزر بلا مبلغ.
   - عمّر: الاسم، التليفون، التليفون الثاني (يقدر يكون نفس الرقم)، المدينة، العنوان. طريقة الدفع: الدفع عند الاستلام.
   - اضغط مرة وحدة. صفحة الطلب: العنوان «طلبك مسجّل: أرسله لنا أيضاً عبر واتساب».
   - اضغط WhatsApp: الرسالة خاصها توصل لرقم BOGA بالتفاصيل كاملين.
   - حل نفس رابط الطلب فـ tab جديد ولا فـ متصفح آخر: خاصو يبان «أرسل لنا رقم طلبك عبر واتساب»، والرسالة فيها غير رقم الطلب.
5. **Admin ← Commandes:** الطلب ظاهر بالتليفونين. كتبان المدة: «يُلغى إذا لم يُؤكَّد» (24 ساعة من الطلب).
6. **أغلق البيع** مباشرة من بعد الطلب (Admin ← Paramètres ← Ventes).
7. **كمّل الطلب ولا لغيه:**
   - إلا بغيتي غير تجربة تقنية: «Annuler la commande» (الستوك كيرجع).
   - إلا بغيتي تجربة كاملة مع شركة النقل: `Confirmée` ← `En production` ← `Expédiée` ← `Livrée` (owner فقط) ← «Encaissé par le transporteur» ← «Reçu par BOGA» نهار توصل الفلوس فعلاً.

8. **التنظيف (من بعد التحقق ديال القسم 3):** إلا ما بغيتيش تخلي منتج التجربة والمدينة active، رجعهم غير active فـ Admin (المنتج، الأصل، والمدينة). البيع خاصو يبقى مسدود. الطلب كيبقى فالسجل (ما كيتمسحش)، ورقم الطلب الجاي كيكون اللي من بعدو.

## 3. من بعد التجربة: التحقق (SELECT فقط)

```sql
select (select settings -> 'salesOpen' from public.site_config where id = 1) as sales_open,
       (select count(*) from public.orders) as orders,
       (select jsonb_agg(jsonb_build_object('n', number, 'status', status, 'pay', payment_status, 'stock_back', stock_returned)) from public.orders) as list,
       (select jsonb_agg(jsonb_build_object('reason', reason, 'kg', delta_kg)) from public.stock_movements) as movements,
       (select coalesce(sum(stock_kg), 0) from public.origins) as stock_kg,
       (select count(*) from public.notification_outbox where status = 'pending') as outbox_pending,
       (select count(*) from public.rate_limits where bucket like 'req:ip:%') as ip_buckets;
```

المنتظر: `sales_open` مسدود؛ طلب واحد؛ إلا تلغى: `stock_back = true` والستوك رجع كيف كان؛ `ip_buckets` ≥ 1 (هادي كتأكد أن حدود الـ IP خدامين)؛ الرسائل فـ `notification_outbox` كيبقاو `pending` حيت المرسل مطفي (عادي).

## 4. إلا وقع مشكل

| شنو شفتي | السبب المحتمل | شنو دير |
|---|---|---|
| «captcha» ولا الطلب ما دازش | أسرار Turnstile ناقصين ولا hostname | سد البيع، صيفط screenshot ديال أسماء الأسرار لـ Claude |
| «sales_closed» | البيع ما تفتحش | تأكد من Paramètres ← Ventes |
| المدينة ما كتبانش | المدينة ماشي active ولا الثمن 0 | Admin ← Livraison |
| «out_of_stock» | الستوك 0 ولا الأصل ماشي active | Admin ← Stock & origines |
| ضغطة غالطة على «Livrée» | ما كترجعش من الواجهة | ما تبدّل والو، قول لـ Claude |

## 5. قبل الإطلاق الرسمي (ماشي جزء من هاد التجربة)

- المرسل الأوتوماتيكي (`notify-outbox`، Vault، cron): كيتسنى الأسرار ديال Abderrahim. قبل ما يتشعل: نقررو شنو نديرو بالرسائل `pending` ديال التجربة (block SQL كيتوجد فالمرحلة D).
- الصفحات القانونية، HSTS، redirect ديال `www`، حذف الـ wildcard ديال Turnstile: المراحل E و F.
- `noindex` كيبقى حتى قرار الإطلاق.
