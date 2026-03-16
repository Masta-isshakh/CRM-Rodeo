export type LanguageCode = "en" | "ar";

export const LANGUAGE_STORAGE_KEY = "crm.language";

const PHRASES_EN_AR: Array<[string, string]> = [
  ["Dashboard", "لوحة التحكم"],
  ["Customers", "العملاء"],
  ["Vehicles", "المركبات"],
  ["Tickets", "التذاكر"],
  ["Employees", "الموظفون"],
  ["Activity Log", "سجل النشاط"],
  ["Job Cards", "بطاقات العمل"],
  ["Service Creation", "إنشاء الخدمة"],
  ["Job History", "سجل الطلبات"],
  ["Service Execution", "تنفيذ الخدمة"],
  ["Payment & Invoices", "المدفوعات والفواتير"],
  ["Quality Check", "فحص الجودة"],
  ["Exit Permit", "تصريح الخروج"],
  ["Call Tracking", "تتبع المكالمات"],
  ["Inspection", "الفحص"],
  ["User Management", "إدارة المستخدمين"],
  ["Departments", "الأقسام"],
  ["Roles & Policies", "الأدوار والسياسات"],
  ["Admin", "الإدارة"],
  ["Users", "المستخدمون"],
  ["Sign out", "تسجيل الخروج"],
  ["CRM Console", "لوحة إدارة CRM"],
  ["Active Session", "جلسة نشطة"],
  ["Loading...", "جاري التحميل..."],
  ["No access configured", "لا توجد صلاحيات مهيأة"],
  [
    "You are signed in, but no department -> role -> policy permissions were resolved for your account. Ask an Admin to assign a Department role + Role policies.",
    "تم تسجيل دخولك، ولكن لم يتم العثور على صلاحيات القسم ثم الدور ثم السياسات لحسابك. اطلب من المسؤول تعيين دور قسم وسياسات الدور."
  ],
  ["Open menu", "فتح القائمة"],
  ["Close menu", "إغلاق القائمة"],
  ["Rodeo Drive", "روديو درايف"],
  ["Rodeo Drive CRM", "روديو درايف CRM"],
  ["Workspace", "مساحة العمل"],
  ["Verify", "تحقق"],
  ["Verified", "تم التحقق"],
  ["Save", "حفظ"],
  ["Save Changes", "حفظ التغييرات"],
  ["Add Vehicle", "إضافة مركبة"],
  ["Edit Vehicle", "تعديل المركبة"],
  ["Delete Vehicle", "حذف المركبة"],
  ["Vehicle Information", "معلومات المركبة"],
  ["Vehicle Details", "تفاصيل المركبة"],
  ["Vehicle ID", "معرف المركبة"],
  ["Plate Number", "رقم اللوحة"],
  ["Make", "الشركة المصنعة"],
  ["Manufacturer", "الشركة المصنعة"],
  ["Model", "الموديل"],
  ["Year", "السنة"],
  ["Vehicle Type", "نوع المركبة"],
  ["Color", "اللون"],
  ["VIN", "رقم الهيكل"],
  ["Notes", "ملاحظات"],
  ["Customer ID", "معرف العميل"],
  ["Back", "رجوع"],
  ["Next", "التالي"],
  ["Cancel", "إلغاء"],
  ["Confirm", "تأكيد"],
  ["Search", "بحث"],
  ["Records per page:", "عدد السجلات لكل صفحة:"],
  ["New Job Order", "طلب عمل جديد"],
  ["Job Order Management", "إدارة أوامر العمل"],
  ["Create New Job Order", "إنشاء أمر عمل جديد"],
  ["Customer", "العميل"],
  ["Order Type", "نوع الطلب"],
  ["Services", "الخدمات"],
  ["Confirm & Submit", "تأكيد وإرسال"],
  ["Login", "تسجيل الدخول"],
  ["Toggle language", "تبديل اللغة"],
  ["User", "مستخدم"],
  ["Email", "البريد الإلكتروني"],
  ["Enter your email", "أدخل بريدك الإلكتروني"],
  ["Password", "كلمة المرور"],
  ["Enter your password", "أدخل كلمة المرور"],
  ["Remember me", "تذكرني"],
  ["Forgot Password?", "هل نسيت كلمة المرور؟"],
  ["Password requirements", "متطلبات كلمة المرور"],
  ["At least 8 characters", "8 أحرف على الأقل"],
  ["At least 1 uppercase letter", "حرف كبير واحد على الأقل"],
  ["At least 1 lowercase letter", "حرف صغير واحد على الأقل"],
  ["At least 1 number", "رقم واحد على الأقل"],
  ["At least 1 special character", "رمز خاص واحد على الأقل"],
  ["Dismiss", "إخفاء"],
  ["Too many failed attempts. Try again in", "محاولات فاشلة كثيرة. حاول مرة أخرى بعد"],
  ["minute(s).", "دقيقة."],
  ["This account is temporarily blocked in this application after", "تم حظر هذا الحساب مؤقتًا في هذا التطبيق بعد"],
  ["failed login attempts. Try again in", "محاولات تسجيل دخول فاشلة. حاول مرة أخرى بعد"],
  ["minutes or contact an administrator.", "دقائق أو تواصل مع المسؤول."],
  ["Your account is inactive. Please contact your administrator.", "حسابك غير نشط. يرجى التواصل مع المسؤول."],
  ["Your dashboard access is disabled. Please contact your administrator.", "تم تعطيل الوصول إلى لوحة التحكم الخاصة بك. يرجى التواصل مع المسؤول."],
  ["Save changes", "حفظ التغييرات"],
  ["Select manufacturer", "اختر الشركة المصنعة"],
  ["Select model", "اختر الموديل"],
  ["Select color", "اختر اللون"],
  ["Select type", "اختر النوع"],
  ["Sedan", "سيدان"],
  ["SUV", "دفع رباعي"],
  ["Truck", "شاحنة"],
  ["Coupe", "كوبيه"],
  ["Hatchback", "هاتشباك"],
  ["Van", "فان"],
  ["Motorbike", "دراجة نارية"],
  ["Other", "أخرى"],
  ["White", "أبيض"],
  ["Black", "أسود"],
  ["Silver", "فضي"],
  ["Gray", "رمادي"],
  ["Red", "أحمر"],
  ["Blue", "أزرق"],
  ["Brown", "بني"],
  ["Beige", "بيج"],
  ["Green", "أخضر"],
  ["Yellow", "أصفر"],
  ["Orange", "برتقالي"],
  ["Purple", "بنفسجي"],
  ["Gold", "ذهبي"],
  ["Bronze", "برونزي"],
  ["Maroon", "عنابي"],
  ["Navy Blue", "أزرق كحلي"],
  ["Sky Blue", "أزرق سماوي"],
  ["Teal", "تركوازي غامق"],
  ["Turquoise", "فيروزي"],
  ["Olive", "زيتي"],
  ["Lime Green", "أخضر ليموني"],
  ["Mint Green", "أخضر نعناعي"],
  ["Burgundy", "خمري"],
  ["Champagne", "شمبانيا"],
  ["Pearl White", "أبيض لؤلؤي"],
  ["Matte Black", "أسود مطفي"],
  ["Metallic Silver", "فضي معدني"],
  ["Gunmetal", "رمادي معدني"],
  ["Charcoal", "فحمي"],
  ["Ivory", "عاجي"],
  ["Cream", "كريمي"],
  ["Sand", "رملي"],
  ["Copper", "نحاسي"],
  ["Success", "نجاح"],
  ["Error", "خطأ"],
  ["Warning", "تنبيه"],
  ["Info", "معلومة"],
  ["OK", "حسنًا"],
  ["Close", "إغلاق"],
  ["View Details", "عرض التفاصيل"],
  ["Actions", "الإجراءات"],
  ["Delete", "حذف"],
  ["Edit", "تعديل"],
  ["Add", "إضافة"],
  ["Refresh", "تحديث"],
  ["Create", "إنشاء"],
  ["Update", "تحديث"],
  ["Confirm action", "تأكيد الإجراء"],
  ["Are you sure you want to continue?", "هل أنت متأكد أنك تريد المتابعة؟"],
  ["Created", "تم الإنشاء"],
  ["Updated", "تم التحديث"],
  ["Cancelled", "تم الإلغاء"],
  ["Signed in as:", "مسجل الدخول باسم:"],
  ["Loading", "جاري التحميل"],
  ["Customer name", "اسم العميل"],
  ["Phone", "الهاتف"],
  ["Source", "المصدر"],
  ["Source (Instagram, WhatsApp, etc.)", "المصدر (إنستغرام، واتساب، إلخ)"],
  ["Outcome", "النتيجة"],
  ["NO_ANSWER", "لا يوجد رد"],
  ["ANSWERED", "تم الرد"],
  ["BOOKED", "تم الحجز"],
  ["FOLLOW_UP", "متابعة"],
  ["NOT_INTERESTED", "غير مهتم"],
  ["Follow-up date/time", "تاريخ/وقت المتابعة"],
  ["Follow-up date/time (optional)", "تاريخ/وقت المتابعة (اختياري)"],
  ["Save call", "حفظ المكالمة"],
  ["Call record saved.", "تم حفظ سجل المكالمة."],
  ["Call record updated.", "تم تحديث سجل المكالمة."],
  ["Delete this call record?", "هل تريد حذف سجل المكالمة هذا؟"],
  ["Deleted.", "تم الحذف."],
  ["Update failed.", "فشل التحديث."],
  ["Delete failed.", "فشل الحذف."],
  ["Failed to save call record.", "فشل حفظ سجل المكالمة."],
  ["Failed to load call tracking.", "فشل تحميل تتبع المكالمات."],
  ["Customer name and phone are required.", "اسم العميل ورقم الهاتف مطلوبان."],
  ["Activity update", "تحديث النشاط"],
  ["System", "النظام"],
  ["Inspection", "الفحص"],
  ["Service", "الخدمة"],
  ["Delivery QC", "فحص الجودة للتسليم"],
  ["Invoicing", "الفوترة"],
  ["Urgent", "عاجل"],
  ["Review", "مراجعة"],
  ["Attention", "انتباه"],
  ["Flag", "إشارة"],
  ["Next in line: by created date", "التالي في الدور: حسب تاريخ الإنشاء"],
  ["Finance and service review", "مراجعة المالية والخدمة"],
  ["Escalate decision queue", "تصعيد قائمة القرارات"],
  ["Re-check and close quality gaps", "إعادة الفحص وإغلاق فجوات الجودة"],
];

const EN_TO_AR = new Map<string, string>(PHRASES_EN_AR);
const AR_TO_EN = new Map<string, string>(PHRASES_EN_AR.map(([en, ar]) => [ar, en]));

const FRAGMENTS_EN_AR: Array<[string, string]> = [
  ["Signed in as:", "مسجل الدخول باسم:"],
  ["Verified:", "تم التحقق:"],
  ["(current)", "(الحالي)"],
  ["required", "مطلوب"],
  ["optional", "اختياري"],
  ["services", "خدمات"],
  ["vehicle", "مركبة"],
  ["customer", "عميل"],
  ["order", "طلب"],
  ["Save", "حفظ"],
  ["Delete", "حذف"],
  ["Edit", "تعديل"],
  ["Close", "إغلاق"],
  ["Refresh", "تحديث"],
];

const FRAGMENTS_AR_EN: Array<[string, string]> = FRAGMENTS_EN_AR.map(([en, ar]) => [ar, en]);

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function replaceEvery(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement);
}

export function translateTextValue(input: string, language: LanguageCode): string {
  const raw = String(input ?? "");
  const trimmed = normalizeSpaces(raw);
  if (!trimmed) return raw;

  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";

  if (language === "ar") {
    if (EN_TO_AR.has(trimmed)) return `${leading}${EN_TO_AR.get(trimmed)}${trailing}`;
    let out = trimmed;
    for (const [src, target] of FRAGMENTS_EN_AR) {
      if (out.includes(src)) out = replaceEvery(out, src, target);
    }
    return `${leading}${out}${trailing}`;
  }

  if (AR_TO_EN.has(trimmed)) return `${leading}${AR_TO_EN.get(trimmed)}${trailing}`;
  let out = trimmed;
  for (const [src, target] of FRAGMENTS_AR_EN) {
    if (out.includes(src)) out = replaceEvery(out, src, target);
  }
  return `${leading}${out}${trailing}`;
}

export function t(language: LanguageCode, englishText: string): string {
  return language === "ar" ? translateTextValue(englishText, "ar") : englishText;
}
