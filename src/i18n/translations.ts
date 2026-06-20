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
  ["Internal Chat", "الدردشة الداخلية"],
  ["File Sharing", "مشاركة الملفات"],
  ["Push Notifications", "إشعارات الرسائل النصية"],
  ["Inspection", "الفحص"],
  ["Campaign Audience", "جمهور الحملة"],
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
  ["Rodeo Drive CRM Logo", "شعار روديو درايف CRM"],
  ["Application failed to load", "فشل تحميل التطبيق"],
  ["Reload application", "إعادة تحميل التطبيق"],
  ["CRM Logo", "شعار CRM"],
  ["Checking your session...", "جارٍ التحقق من جلستك..."],
  ["Your session expired after 1 hour. Please sign in again.", "انتهت جلستك بعد ساعة واحدة. يرجى تسجيل الدخول مرة أخرى."],
  ["Unexpected error while rendering.", "حدث خطأ غير متوقع أثناء العرض."],
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
  ["Job Order Details", "تفاصيل أمر العمل"],
  ["job orders", "أوامر العمل"],
  ["Load details failed", "فشل تحميل التفاصيل"],
  ["Could not load latest details. Showing available data.", "تعذر تحميل أحدث التفاصيل. يتم عرض البيانات المتاحة."],
  ["Create New Job Order", "إنشاء أمر عمل جديد"],
  ["Category", "الفئة"],
  ["Packages", "الباقات"],
  ["No services match your filter", "لا توجد خدمات مطابقة لفلترك"],
  ["Try a different category or type.", "جرّب فئة أو نوعًا مختلفًا."],
  ["Customer", "العميل"],
  ["Order Type", "نوع الطلب"],
  ["Services", "الخدمات"],
  ["Confirm & Submit", "تأكيد وإرسال"],
  ["Login", "تسجيل الدخول"],
  ["Sign in", "تسجيل الدخول"],
  ["Sign In", "تسجيل الدخول"],
  ["Signing you in...", "جارٍ تسجيل دخولك..."],
  ["Reset Password", "إعادة تعيين كلمة المرور"],
  ["Confirm New Password", "تأكيد كلمة المرور الجديدة"],
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
  ["You are being redirected to Amazon WorkMail. Please sign in to manage your inbox.", "يتم تحويلك إلى Amazon WorkMail. يرجى تسجيل الدخول لإدارة بريدك الإلكتروني."],
  ["Open WorkMail now", "افتح WorkMail الآن"],
  ["Internal Communication", "التواصل الداخلي"],
  ["Rodeo Team Chat", "دردشة فريق روديو"],
  ["Team Chat", "دردشة الفريق"],
  ["members", "أعضاء"],
  ["Broadcast", "بث عام"],
  ["Direct", "مباشر"],
  ["Conversations", "المحادثات"],
  ["Company-wide channel", "قناة على مستوى الشركة"],
  ["Search or start new chat", "ابحث أو ابدأ محادثة جديدة"],
  ["Search people or channels", "ابحث عن أشخاص أو قنوات"],
  ["Search conversations", "ابحث في المحادثات"],
  ["All Team", "كل الفريق"],
  ["Company-wide announcements and updates", "إعلانات وتحديثات على مستوى الشركة"],
  ["Real-time team communication", "تواصل فوري بين الفريق"],
  ["No messages yet. Say hello!", "لا توجد رسائل بعد. قل مرحبا!"],
  ["No messages yet. Start the conversation.", "لا توجد رسائل بعد. ابدأ المحادثة."],
  ["Type a message", "اكتب رسالة"],
  ["View only", "عرض فقط"],
  ["Write a message and press Enter", "اكتب رسالة واضغط Enter"],
  ["You can view messages only", "يمكنك فقط عرض الرسائل"],
  ["Sending...", "جاري الإرسال..."],
  ["Send", "إرسال"],
  ["Sent", "تم الإرسال"],
  ["Seen", "تمت المشاهدة"],
  ["Message input", "حقل الرسالة"],
  ["Send message", "إرسال الرسالة"],
  ["unread", "غير مقروء"],
  ["You", "أنت"],
  ["Message could not be sent.", "تعذر إرسال الرسالة."],
  ["Failed to load messages.", "فشل تحميل الرسائل."],
  ["Unable to initialize chat.", "تعذر تهيئة الدردشة."],
  ["Chat backend not yet deployed.", "خلفية الدردشة لم يتم نشرها بعد."],
  ["Internal chat data model is not available. Please deploy backend changes.", "نموذج بيانات الدردشة الداخلية غير متاح. يرجى نشر تغييرات الواجهة الخلفية."],
  ["You do not have access to this page.", "ليس لديك صلاحية الوصول إلى هذه الصفحة."],
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
  ["Delete this job order from history? This action cannot be undone.", "هل تريد حذف طلب العمل هذا من السجل؟ لا يمكن التراجع عن هذا الإجراء."],
  ["Job order history deleted successfully.", "تم حذف سجل طلب العمل بنجاح."],
  ["Delete History", "حذف السجل"],
  ["Deleted.", "تم الحذف."],
  ["Update failed.", "فشل التحديث."],
  ["Delete failed.", "فشل الحذف."],
  ["Failed to save call record.", "فشل حفظ سجل المكالمة."],
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
  ["Documents", "المستندات"],
  ["Download", "تنزيل"],
  ["Generated:", "تاريخ الإنشاء:"],
  ["Inspection Report", "تقرير الفحص"],
  ["Quality Check Report", "تقرير فحص الجودة"],
  ["Invoice/Bill", "فاتورة/إيصال"],
  ["Billing", "الفوترة"],
  ["Permit", "تصريح"],
  ["Could not add services to this job order.", "تعذر إضافة الخدمات إلى أمر العمل هذا."],
  ["Could not cancel this job order.", "تعذر إلغاء أمر العمل هذا."],
  [
    "No additional discount can be applied. The order has already reached the role policy discount limit.",
    "لا يمكن تطبيق خصم إضافي. لقد وصل الطلب بالفعل إلى الحد الأقصى للخصم حسب سياسة الدور."
  ],
  ["Your job order was not created.", "لم يتم إنشاء أمر العمل الخاص بك."],
  ["Order Cancelled Successfully!", "تم إلغاء الطلب بنجاح!"],
  ["Job Order ID:", "معرف أمر العمل:"],
  ["This order is now marked as Cancelled.", "تم الآن وضع علامة ملغي على هذا الطلب."],
  ["Order Created Successfully!", "تم إنشاء الطلب بنجاح!"],
  ["Services Added Successfully!", "تمت إضافة الخدمات بنجاح!"],
  ["New Invoice ID:", "معرف الفاتورة الجديد:"],
  ["Confirm Cancellation", "تأكيد الإلغاء"],
  ["You are about to cancel order", "أنت على وشك إلغاء الطلب"],
  ["Keep Order", "الاحتفاظ بالطلب"],
  ["No matching job orders found", "لم يتم العثور على أوامر عمل مطابقة"],
  ["Try adjusting your search terms or click \"New Job Order\" to create one", "حاول تعديل كلمات البحث أو انقر على \"أمر عمل جديد\" لإنشاء أمر."],
  ["Create Date", "تاريخ الإنشاء"],
  ["Job Card ID", "معرف بطاقة العمل"],
  ["Job Order Records", "سجلات أوامر العمل"],
  ["Cancel Order", "إلغاء الطلب"],
  ["Job Order Details -", "تفاصيل أمر العمل -"],
  ["Close Details", "إغلاق التفاصيل"],
  ["New Customer", "عميل جديد"],
  ["Existing Customer", "عميل موجود"],
  ["Full Name *", "الاسم الكامل *"],
  ["Phone *", "الهاتف *"],
  ["Heard of us from *", "سمعت عنا من *"],
  ["Select…", "اختر…"],
  ["Walk-in", "زيارة مباشرة"],
  ["Refer by person", "إحالة من شخص"],
  ["Social media", "وسائل التواصل الاجتماعي"],
  ["Referred Person Name *", "اسم الشخص المُحيل *"],
  ["Referred Person Mobile *", "جوال الشخص المُحيل *"],
  ["Platform *", "المنصة *"],
  ["Other Note *", "ملاحظة أخرى *"],
  ["Search Customer", "بحث عن عميل"],
  ["Verify Customer", "تحقق من العميل"],
  ["Customer Management", "إدارة العملاء"],
  ["Manage customer information, vehicles, contacts, and relationships.", "إدارة معلومات العملاء والمركبات والجهات الاتصال والعلاقات."],
  ["No customers found matching your search", "لم يتم العثور على عملاء مطابقين لبحثك"],
  ["Customer Verified", "تم التحقق من العميل"],
  ["Name:", "الاسم:"],
  ["Customer ID:", "معرف العميل:"],
  ["Email:", "البريد الإلكتروني:"],
  ["Mobile:", "الجوال:"],
  ["Address:", "العنوان:"],
  ["Heard of us from:", "سمعت عنا من:"],
  ["Referred Name:", "اسم المُحيل:"],
  ["Referred Mobile:", "جوال المُحيل:"],
  ["Platform:", "المنصة:"],
  ["Other Note:", "ملاحظة أخرى:"],
  ["Registered Vehicles:", "المركبات المسجلة:"],
  ["Change Customer", "تغيير العميل"],
  ["Duplicate Customer Warning", "تحذير عميل مكرر"],
  ["This customer already exists in the system.", "هذا العميل موجود بالفعل في النظام."],
  ["Are you sure you want to save as a new customer?", "هل أنت متأكد أنك تريد الحفظ كعميل جديد؟"],
  ["Yes, Save Anyway", "نعم، احفظ على أي حال"],
  ["No, Cancel", "لا، إلغاء"],
  ["Service Specification", "مواصفات الخدمة"],
  ["Service Creation", "إنشاء الخدمة"],
  ["Service Intelligence", "معلومات الخدمات"],
  ["Configure services, packages, and brand specifications with bilingual visibility.", "تهيئة الخدمات والباقات ومواصفات العلامات التجارية مع عرض ثنائي اللغة."],
  ["Uncategorized", "غير مصنف"],
  ["Category updated successfully.", "تم تحديث الفئة بنجاح."],
  ["Category created successfully.", "تم إنشاء الفئة بنجاح."],
  ["Failed to save category", "فشل حفظ الفئة"],
  ["Service updated successfully.", "تم تحديث الخدمة بنجاح."],
  ["Service created successfully.", "تم إنشاء الخدمة بنجاح."],
  ["Failed to save service", "فشل حفظ الخدمة"],
  ["Package updated successfully.", "تم تحديث الباقة بنجاح."],
  ["Package created successfully.", "تم إنشاء الباقة بنجاح."],
  ["Failed to save package", "فشل حفظ الباقة"],
  ["Category deleted successfully.", "تم حذف الفئة بنجاح."],
  ["Brand specification deleted successfully.", "تم حذف مواصفات العلامة التجارية بنجاح."],
  ["deleted successfully.", "تم الحذف بنجاح."],
  ["Brand specification saved successfully.", "تم حفظ مواصفات العلامة التجارية بنجاح."],
  ["Brand specification cleared successfully.", "تم مسح مواصفات العلامة التجارية بنجاح."],
  ["Failed to save brand specification", "فشل حفظ مواصفات العلامة التجارية"],
  ["Change Brand Spec", "تغيير مواصفات العلامة"],
  ["Set Brand Spec", "تعيين مواصفات العلامة"],
  ["brands", "علامات"],
  ["Edit Category", "تعديل الفئة"],
  ["Add New Category", "إضافة فئة جديدة"],
  ["Category name in English", "اسم الفئة بالإنجليزية"],
  ["Arabic Name *", "الاسم بالعربية *"],
  ["Category name in Arabic", "اسم الفئة بالعربية"],
  ["Arabic Description", "الوصف بالعربية"],
  ["Category description in English", "وصف الفئة بالإنجليزية"],
  ["Category description in Arabic", "وصف الفئة بالعربية"],
  ["Edit Service", "تعديل الخدمة"],
  ["Add New Service", "إضافة خدمة جديدة"],
  ["Select a category", "اختر فئة"],
  ["e.g. SVC001", "مثال: SVC001"],
  ["Service name in English", "اسم الخدمة بالإنجليزية"],
  ["Service name in Arabic", "اسم الخدمة بالعربية"],
  ["Service description in English", "وصف الخدمة بالإنجليزية"],
  ["Service description in Arabic", "وصف الخدمة بالعربية"],
  ["Edit Package", "تعديل الباقة"],
  ["Add New Package", "إضافة باقة جديدة"],
  ["Package name in English", "اسم الباقة بالإنجليزية"],
  ["Package name in Arabic", "اسم الباقة بالعربية"],
  ["Package description in English", "وصف الباقة بالإنجليزية"],
  ["Package description in Arabic", "وصف الباقة بالعربية"],
  ["e.g. PKG001", "مثال: PKG001"],
  ["Edit Brand", "تعديل العلامة"],
  ["Add Brand", "إضافة علامة"],
  ["Brand name", "اسم العلامة"],
  ["Brand", "العلامة التجارية"],
  ["Product", "المنتج"],
  ["Measurement", "المقاس"],
  ["Selected product", "المنتج المحدد"],
  ["Selected measurement", "المقاس المحدد"],
  ["Apply Specification", "تطبيق المواصفات"],
  ["Next: Vehicle", "التالي: المركبة"],
  ["registered vehicle(s). Select one or add a new vehicle.", "مركبة/مركبات مسجلة. اختر واحدة أو أضف مركبة جديدة."],
  ["Back to Vehicle Selection", "العودة إلى اختيار المركبة"],
  ["License Plate *", "رقم اللوحة *"],
  ["VIN Number", "رقم الهيكل"],
  ["Save Vehicle", "حفظ المركبة"],
  ["Vehicle Selected", "تم اختيار المركبة"],
  ["Vehicle:", "المركبة:"],
  ["License Plate:", "رقم اللوحة:"],
  ["Type:", "النوع:"],
  ["Change Vehicle", "تغيير المركبة"],
  ["Next: Services", "التالي: الخدمات"],
  ["Services Selection", "اختيار الخدمات"],
  ["Select services for", "اختر الخدمات لـ"],
  ["No services configured yet", "لا توجد خدمات مهيأة بعد"],
  ["Please create services from the Service Creation page first.", "يرجى إنشاء الخدمات أولاً من صفحة إنشاء الخدمة."],
  ["Package Price Applied", "تم تطبيق سعر الباقة"],
  ["Notes / Comments (Optional)", "ملاحظات / تعليقات (اختياري)"],
  ["Expected Delivery Date & Time", "تاريخ ووقت التسليم المتوقع"],
  ["Price Summary", "ملخص الأسعار"],
  ["Apply Discount:", "تطبيق الخصم:"],
  ["Discount Amount (QAR):", "قيمة الخصم (ر.ق):"],
  ["Max Allowed Discount:", "الحد الأقصى المسموح للخصم:"],
  ["Discount Amount:", "قيمة الخصم:"],
  ["Total:", "الإجمالي:"],
  ["Next: Confirm", "التالي: تأكيد"],
  ["Add Services to Job Order", "إضافة خدمات إلى أمر العمل"],
  ["Create services from Service Creation before adding to a job order.", "أنشئ خدمات من صفحة إنشاء الخدمة قبل إضافتها إلى أمر عمل."],
  ["Add Services", "إضافة خدمات"],
  ["Order Confirmation", "تأكيد الطلب"],
  ["Change Selection", "تغيير الاختيار"],
  ["Selected Services", "الخدمات المختارة"],
  ["Service Name", "اسم الخدمة"],
  ["No services selected", "لم يتم اختيار أي خدمات"],
  ["Subtotal", "المجموع الفرعي"],
  ["Additional Information", "معلومات إضافية"],
  ["Expected Delivery Date", "تاريخ التسليم المتوقع"],
  ["Expected Delivery Time", "وقت التسليم المتوقع"],
  ["Notes / Comments", "ملاحظات / تعليقات"],
  ["Creating...", "جارٍ الإنشاء..."],
  ["Services Summary (", "ملخص الخدمات ("],
  ["Add Service", "إضافة خدمة"],
  ["Status:", "الحالة:"],
  ["Technician:", "الفني:"],
  ["Started:", "بدأ:"],
  ["Ended:", "انتهى:"],
  ["Duration:", "المدة:"],
  ["Click \"Add Service\" to add services to this job order", "انقر على \"إضافة خدمة\" لإضافة خدمات إلى أمر العمل هذا"],
  ["Documents (", "المستندات ("],
  ["No documents available.", "لا توجد مستندات متاحة."],
  ["Quality Check List", "قائمة فحص الجودة"],
  ["No services to evaluate", "لا توجد خدمات للتقييم"],
  ["Delivery & Time Tracking", "تتبع التسليم والوقت"],
  ["Delivery and time tracking details", "تفاصيل تتبع التسليم والوقت"],
  ["Action done by", "تم الإجراء بواسطة"],
  ["Select Order Type", "اختر نوع الطلب"],
  ["completed service(s). Choose the type of order you want to create:", "خدمة/خدمات مكتملة. اختر نوع الطلب الذي تريد إنشاءه:"],
  ["Service Order", "طلب خدمة"],
  ["This vehicle has no completed services yet. Proceeding with New Job Order.", "هذه المركبة لا تحتوي على خدمات مكتملة بعد. سيتم المتابعة بأمر عمل جديد."],
  ["Continue", "متابعة"],
  ["Services added", "تمت إضافة الخدمات"],
  ["Try adjusting your search terms or click \"New Job Order\" to create one", "حاول تعديل كلمات البحث أو انقر \"أمر عمل جديد\" لإنشاء أمر."],
  ["Search by any details", "ابحث بأي تفاصيل"],
  ["Service Management System © 2023 | Job Order Management Module", "نظام إدارة الخدمة © 2023 | وحدة إدارة أوامر العمل"],
  ["Optional", "اختياري"],
  ["Instagram", "إنستغرام"],
  ["Twitter", "تويتر"],
  ["TikTok", "تيك توك"],
  ["Website", "الموقع الإلكتروني"],
  ["Search by name, customer ID, mobile, or email...", "ابحث بالاسم أو معرف العميل أو الجوال أو البريد الإلكتروني..."],
  ["Select", "اختيار"],
  ["Manufacturer *", "الشركة المصنعة *"],
  ["Model *", "الموديل *"],
  ["Year *", "السنة *"],
  ["Vehicle Type *", "نوع المركبة *"],
  ["Color *", "اللون *"],
  ["Color:", "اللون:"],
  ["Add any special instructions, notes, or comments for this order...", "أضف أي تعليمات خاصة أو ملاحظات أو تعليقات لهذا الطلب..."],
  ["Details", "التفاصيل"],
  ["Home Address", "عنوان المنزل"],
  ["Upload/Take Photo", "رفع/التقاط صورة"],
  ["* Required for Amber/Red status", "* مطلوب عند حالة كهرماني/أحمر"],
  ["Create services from Service Creation before adding services.", "أنشئ خدمات من صفحة إنشاء الخدمة قبل إضافة الخدمات."],
  ["Services:", "الخدمات:"],
  ["No roadmap data.", "لا توجد بيانات خارطة طريق."],
  ["No documents available.", "لا توجد مستندات متاحة."],
  ["Billing & Invoices", "الفوترة والفواتير"],
  ["Invoices", "الفواتير"],
  ["Invoice #", "رقم الفاتورة"],
  ["Fully Paid", "مدفوع بالكامل"],
  ["Partially Paid", "مدفوع جزئيًا"],
  ["Unpaid", "غير مدفوع"],
  ["Payment Activity Log", "سجل نشاط المدفوعات"],
  ["No payment activity yet.", "لا يوجد نشاط مدفوعات بعد."],
  ["No exit permit data found.", "لم يتم العثور على بيانات تصريح خروج."],
  ["Download Inspection Report", "تنزيل تقرير الفحص"],
  ["Service Management", "إدارة الخدمات"],
  ["No matching services found.", "لم يتم العثور على خدمات مطابقة."],
  ["Create New Service", "إنشاء خدمة جديدة"],
  ["Service ID", "معرف الخدمة"],
  ["SUV Price", "سعر SUV"],
  ["Sedan Price", "سعر سيدان"],
  ["View", "عرض"],
  ["Package", "باقة"],
  ["No individual services available.", "لا توجد خدمات فردية متاحة."],
  ["Service Details", "تفاصيل الخدمة"],
  ["Included Services:", "الخدمات المضمنة:"],
  ["You are about to delete", "أنت على وشك الحذف"],
  ["). This action cannot be undone.", "). لا يمكن التراجع عن هذا الإجراء."],
  ["(optional)", "(اختياري)"],
  ["No matching customers found", "لم يتم العثور على عملاء مطابقين"],
  ["Try adjusting your search terms or clear the search to see all records", "حاول تعديل كلمات البحث أو مسح البحث لرؤية جميع السجلات"],
  ["Try adjusting your search terms or clear the search to see all records", "حاول تعديل كلمات البحث أو امسح البحث لرؤية جميع السجلات"],
  ["Company", "الشركة"],
  ["First Name", "الاسم الأول"],
  ["Last Name", "اسم العائلة"],
  ["Contacts", "جهات الاتصال"],
  ["Deals", "الصفقات"],
  ["contacts", "جهات الاتصال"],
  ["deals", "الصفقات"],
  ["tickets", "التذاكر"],
  ["Delete Customer", "حذف العميل"],
  ["Customer Details -", "تفاصيل العميل -"],
  ["Created At", "تاريخ الإنشاء"],
  ["Related Records", "السجلات المرتبطة"],
  ["Loading…", "جارٍ التحميل…"],
  ["Loading customers…", "جارٍ تحميل العملاء…"],
  ["Loading vehicles...", "جارٍ تحميل المركبات..."],
  ["Loading customers...", "جارٍ تحميل العملاء..."],
  ["Latest 10 items per section", "آخر 10 عناصر لكل قسم"],
  ["Loading contacts…", "جارٍ تحميل جهات الاتصال…"],
  ["No contacts.", "لا توجد جهات اتصال."],
  ["Loading deals…", "جارٍ تحميل الصفقات…"],
  ["No deals.", "لا توجد صفقات."],
  ["Loading tickets…", "جارٍ تحميل التذاكر…"],
  ["No tickets.", "لا توجد تذاكر."],
  ["No customers found", "لم يتم العثور على عملاء"],
  ["No related sections are enabled for your role.", "لا توجد أقسام مرتبطة مفعّلة لدورك."],
  ["You don’t have permission to view customer detail sections.", "ليس لديك صلاحية لعرض أقسام تفاصيل العميل."],
  ["You don’t have access to this page.", "ليس لديك صلاحية الوصول إلى هذه الصفحة."],
  ["Enter first name", "أدخل الاسم الأول"],
  ["Enter last name", "أدخل اسم العائلة"],
  ["Enter mobile number", "أدخل رقم الجوال"],
  ["Enter email address", "أدخل البريد الإلكتروني"],
  ["Enter company name", "أدخل اسم الشركة"],
  ["Enter notes", "أدخل ملاحظات"],
  ["Enter person name", "أدخل اسم الشخص"],
  ["Enter note", "أدخل ملاحظة"],
  ["Customers Management", "إدارة العملاء"],
  ["Search by any customer details", "ابحث بأي تفاصيل للعميل"],
  ["Search is disabled for your role", "البحث معطل لدورك"],
  ["Search by any customer details", "ابحث بأي من تفاصيل العميل"],
  ["Showing", "عرض"],
  ["of", "من"],
  ["(Filtered by: \"", "(تمت التصفية بواسطة: \""],
  ["Customers Records", "سجلات العملاء"],
  ["Add New Customer", "إضافة عميل جديد"],
  ["Customer Information", "معلومات العميل"],
  ["Customer Name", "اسم العميل"],
  ["Customer ID required", "معرف العميل مطلوب"],
  ["Please select how customer heard about us", "يرجى اختيار كيف عرف العميل عنا"],
  ["Referred person name is required", "اسم الشخص المُحيل مطلوب"],
  ["Referred person mobile is required", "رقم جوال الشخص المُحيل مطلوب"],
  ["Please select social media platform", "يرجى اختيار منصة التواصل الاجتماعي"],
  ["Please enter note for Other", "يرجى إدخال ملاحظة لحقل أخرى"],
  ["Failed to load customers from Amplify.", "فشل تحميل العملاء من Amplify."],
  ["Could not load related records.", "تعذر تحميل السجلات المرتبطة."],
  ["Customer updated successfully!", "تم تحديث العميل بنجاح!"],
  ["Customer deleted successfully!", "تم حذف العميل بنجاح!"],
  ["Failed to create customer. Check console.", "فشل إنشاء العميل. تحقق من وحدة التحكم."],
  ["Failed to update customer. Check console.", "فشل تحديث العميل. تحقق من وحدة التحكم."],
  ["Delete failed. Check console.", "فشل الحذف. تحقق من وحدة التحكم."],
  ["Service Management System ©", "نظام إدارة الخدمة ©"],
  ["| Customers Management Module", "| وحدة إدارة العملاء"],
  ["Confirm Deletion", "تأكيد الحذف"],
  ["You are about to delete customer", "أنت على وشك حذف العميل"],
  ["Order Cancelled", "تم إلغاء الطلب"],
  ["Order", "الطلب"],
  ["cancelled successfully.", "تم الإلغاء بنجاح."],
  ["Payment Recorded", "تم تسجيل الدفع"],
  ["Payment", "الدفع"],
  ["recorded successfully.", "تم التسجيل بنجاح."],
  ["Refund Processed", "تمت معالجة الاسترداد"],
  ["Refund", "استرداد"],
  ["processed successfully.", "تمت المعالجة بنجاح."],
  ["Service Approval Requests", "طلبات اعتماد الخدمة"],
  ["Requested by", "طُلب بواسطة"],
  ["Requested at", "تاريخ الطلب"],
  ["Decided by", "تم القرار بواسطة"],
  ["Package / Group", "الباقة / المجموعة"],
  ["Included Services", "الخدمات المضمنة"],
  ["Individual Services (Non-package)", "الخدمات الفردية (خارج الباقة)"],
  ["Invoices (", "الفواتير ("],
  ["No invoices found in normalized tables.", "لم يتم العثور على فواتير في الجداول الموحّدة."],
  ["Payment Method", "طريقة الدفع"],
  ["Services Included", "الخدمات المتضمنة"],
  ["No services linked to this invoice.", "لا توجد خدمات مرتبطة بهذه الفاتورة."],
  ["Serial", "الرقم التسلسلي"],
  ["Amount", "المبلغ"],
  ["Method", "الطريقة"],
  ["Cashier", "أمين الصندوق"],
  ["Timestamp", "الوقت"],
  ["Bill Generated", "تم إنشاء الفاتورة"],
  ["Record Payment -", "تسجيل دفعة -"],
  ["Balance", "الرصيد"],
  ["Total Discount (QAR)", "إجمالي الخصم (ر.ق)"],
  ["Max discount:", "الحد الأقصى للخصم:"],
  ["Total Discount (%)", "إجمالي الخصم (%)"],
  ["Changing either discount field updates the other automatically.", "تغيير أي حقل خصم يحدّث الآخر تلقائيًا."],
  ["Amount to Pay (QAR) *", "المبلغ المطلوب دفعه (ر.ق) *"],
  ["Payment Method *", "طريقة الدفع *"],
  ["Cash", "نقدًا"],
  ["Card", "بطاقة"],
  ["Transfer", "تحويل"],
  ["Upload Transfer Proof *", "رفع إثبات التحويل *"],
  ["Process Refund -", "معالجة الاسترداد -"],
  ["Max Refund", "الحد الأقصى للاسترداد"],
  ["Refund Type", "نوع الاسترداد"],
  ["Refund Type *", "نوع الاسترداد *"],
  ["Full Refund", "استرداد كامل"],
  ["Partial Refund", "استرداد جزئي"],
  ["Refund Amount (QAR) *", "مبلغ الاسترداد (ر.ق) *"],
  ["Max:", "الحد الأقصى:"],
  ["Payment & Invoice Management", "إدارة المدفوعات والفواتير"],
  ["Showing unpaid/partially paid only •", "عرض غير المدفوع/المدفوع جزئيًا فقط •"],
  ["Showing unpaid/partially paid and cancelled-with-refundable-balance •", "عرض غير المدفوع/المدفوع جزئيًا والطلبات الملغاة ذات الرصيد القابل للاسترداد •"],
  ["shown of", "معروض من"],
  ["total", "الإجمالي"],
  ["Payment & Invoice Records", "سجلات المدفوعات والفواتير"],
  ["Try adjusting your search terms.", "حاول تعديل كلمات البحث."],
  ["Service Management System © 2023 | Payment & Invoice Management Module", "نظام إدارة الخدمة © 2023 | وحدة إدارة المدفوعات والفواتير"],
  ["Request History Details", "تفاصيل سجل الطلبات"],
  ["Back to History", "العودة إلى السجل"],
  ["Request Summary", "ملخص الطلب"],
  ["Request ID", "معرف الطلب"],
  ["Decision By", "تم القرار بواسطة"],
  ["Decision Date", "تاريخ القرار"],
  ["Requested By", "طُلب بواسطة"],
  ["Request Date", "تاريخ الطلب"],
  ["Assigned To", "مُسند إلى"],
  ["Pending", "قيد الانتظار"],
  ["Mobile Number", "رقم الجوال"],
  ["Vehicle Plate", "لوحة المركبة"],
  ["Financial Overview", "نظرة مالية عامة"],
  ["Current Job Total", "إجمالي الطلب الحالي"],
  ["Bill ID:", "معرف الفاتورة:"],
  ["Payment Status:", "حالة الدفع:"],
  ["Requested Service", "الخدمة المطلوبة"],
  ["Combined Total (estimate)", "الإجمالي المجمّع (تقديري)"],
  ["Current total:", "الإجمالي الحالي:"],
  ["Requested:", "المطلوب:"],
  ["Estimate:", "التقدير:"],
  ["Decision Note", "ملاحظة القرار"],
  ["Service Approval History", "سجل اعتماد الخدمة"],
  ["View all past service approval decisions and details", "عرض جميع قرارات اعتماد الخدمة السابقة وتفاصيلها"],
  ["Filter History", "تصفية السجل"],
  ["Job Card ID, Customer, Decision...", "معرف بطاقة العمل، العميل، القرار..."],
  ["Decision", "القرار"],
  ["All", "الكل"],
  ["Approved", "موافق عليه"],
  ["Declined", "مرفوض"],
  ["Date Range", "النطاق الزمني"],
  ["All Time", "كل الوقت"],
  ["Today", "اليوم"],
  ["This Week", "هذا الأسبوع"],
  ["This Month", "هذا الشهر"],
  ["Clear", "مسح"],
  ["Request History", "سجل الطلبات"],
  ["Displaying", "عرض"],
  ["requests", "طلبات"],
  ["No History Available", "لا يوجد سجل متاح"],
  ["No request history found for the selected filters.", "لم يتم العثور على سجل طلبات للفلاتر المحددة."],
  ["Plate", "اللوحة"],
  ["Added", "تمت الإضافة"],
  ["Delete user account", "حذف حساب المستخدم"],
  ["This action is permanent and cannot be undone.", "هذا الإجراء دائم ولا يمكن التراجع عنه."],
  ["User Management System", "نظام إدارة المستخدمين"],
  ["Edit user details", "تعديل تفاصيل المستخدم"],
  ["User Details", "تفاصيل المستخدم"],
  ["View and manage user account settings", "عرض وإدارة إعدادات حساب المستخدم"],
  ["Back to users list", "العودة إلى قائمة المستخدمين"],
  ["Back to Users", "العودة إلى المستخدمين"],
  ["User Information", "معلومات المستخدم"],
  ["Employee ID", "معرف الموظف"],
  ["First name", "الاسم الأول"],
  ["Last name", "اسم العائلة"],
  ["Mobile number", "رقم الجوال"],
  ["Select a department first.", "اختر قسمًا أولاً."],
  ["Line Manager", "المدير المباشر"],
  ["Account Settings", "إعدادات الحساب"],
  ["User Status", "حالة المستخدم"],
  ["Inactive users are blocked from access.", "المستخدمون غير النشطين محجوبون عن الوصول."],
  ["Toggle user active status", "تبديل حالة نشاط المستخدم"],
  ["Dashboard Access", "وصول لوحة التحكم"],
  ["Disabled users cannot access the CRM dashboard.", "المستخدمون المعطلون لا يمكنهم الوصول إلى لوحة CRM."],
  ["Toggle dashboard access", "تبديل وصول لوحة التحكم"],
  ["Password Management", "إدارة كلمة المرور"],
  ["Locked due to failed attempts (", "مقفل بسبب محاولات فاشلة ("],
  ["min left)", "دقيقة متبقية)"],
  ["Reset User Password", "إعادة تعيين كلمة مرور المستخدم"],
  ["Send a password reset email to this user.", "إرسال بريد إعادة تعيين كلمة المرور لهذا المستخدم."],
  ["Search by Employee ID, Name, Email, Mobile, Department, or Role", "ابحث بمعرف الموظف أو الاسم أو البريد الإلكتروني أو الجوال أو القسم أو الدور"],
  ["RBAC self-check (dev only)", "فحص RBAC الذاتي (للتطوير فقط)"],
  ["Users List", "قائمة المستخدمين"],
  ["Add New User", "إضافة مستخدم جديد"],
  ["Users list visibility is disabled for your role.", "عرض قائمة المستخدمين معطل لدورك."],
  ["Employee Name", "اسم الموظف"],
  ["No users found.", "لم يتم العثور على مستخدمين."],
  ["email@domain.com", "email@domain.com"],
  ["Tip: use Qatar format like +974 XXXXXXXX", "نصيحة: استخدم تنسيق قطر مثل +974 XXXXXXXX"],
  ["Login Page", "صفحة تسجيل الدخول"],
  ["Set-password link", "رابط تعيين كلمة المرور"],
  ["Copy link", "نسخ الرابط"],
  ["Invite", "دعوة"],
  ["Users get access from Department(Group) → Roles → Policies.", "يحصل المستخدمون على الوصول من القسم (المجموعة) ← الأدوار ← السياسات."],
  ["Try adjusting your search terms or click \"New Job Order\" to create one", "جرّب تعديل كلمات البحث أو اضغط \"طلب عمل جديد\" لإنشاء طلب"],
  ["Customer Information", "معلومات العميل"],
  ["Address", "العنوان"],
  ["Edit Customer", "تعديل العميل"],
  ["This customer has", "هذا العميل لديه"],
  ["e.g., 123456", "مثال: 123456"],
  ["e.g., JTDBR32E720054321", "مثال: JTDBR32E720054321"],
  ["Status", "الحالة"],
  ["Heard of us from", "عرفنا من خلال"],
  ["Referred Person Name", "اسم الشخص المُحيل"],
  ["Referred Person Mobile", "جوال الشخص المُحيل"],
  ["Social Platform", "المنصة الاجتماعية"],
  ["Other Note", "ملاحظة أخرى"],
  ["Completed Services", "الخدمات المكتملة"],
  ["Customer Since", "عميل منذ"],
  ["Owned By", "مملوك بواسطة"],
  ["Price", "السعر"],
  ["Discount (", "الخصم ("],
  ["Total", "الإجمالي"],
  ["Notes:", "ملاحظات:"],
  ["No services added yet", "لم تتم إضافة خدمات بعد"],
  ["Click \"Add Service\" to add services to this job order", "اضغط \"إضافة خدمة\" لإضافة خدمات إلى طلب العمل هذا"],
  ["Job Order Roadmap", "مسار طلب العمل"],
  ["Started", "بدأ"],
  ["Completed", "مكتمل"],
  ["This vehicle has", "هذه المركبة لديها"],
  ["&times;", "×"],
  ["Exit Permit Management", "إدارة إذن الخروج"],
  ["Search by job order ID, customer name, vehicle plate, etc.", "ابحث برقم طلب العمل أو اسم العميل أو لوحة المركبة، إلخ."],
  ["20 per page", "20 لكل صفحة"],
  ["50 per page", "50 لكل صفحة"],
  ["100 per page", "100 لكل صفحة"],
  ["No eligible job orders found", "لم يتم العثور على طلبات عمل مؤهلة"],
  ["This screen displays only orders eligible for exit permit creation", "تعرض هذه الشاشة فقط الطلبات المؤهلة لإنشاء إذن خروج"],
  ["Service Management System © 2023 | Exit Permit Management Module", "نظام إدارة الخدمة © 2023 | وحدة إدارة إذن الخروج"],
  ["Create Exit Permit", "إنشاء إذن خروج"],
  ["Collected By", "تم الاستلام بواسطة"],
  ["Enter name of person collecting the vehicle", "أدخل اسم الشخص المستلم للمركبة"],
  ["Next Service Date", "تاريخ الخدمة التالية"],
  ["Exit Permit Created Successfully!", "تم إنشاء إذن الخروج بنجاح!"],
  ["Permit ID:", "معرف الإذن:"],
  ["No services recorded", "لا توجد خدمات مسجلة"],
  ["Additional Services Request", "طلب خدمات إضافية"],
  ["Customer Notes / Comments", "ملاحظات / تعليقات العميل"],
  ["Permit ID", "معرف الإذن"],
  ["Created By", "تم الإنشاء بواسطة"],
  ["No matching vehicles found", "لم يتم العثور على مركبات مطابقة"],
  ["Vehicle Details -", "تفاصيل المركبة -"],
  ["Mobile", "الجوال"],
  ["Type", "النوع"],
  ["Completed Services (from Job Orders)", "الخدمات المكتملة (من طلبات العمل)"],
  ["Add New Order", "إضافة طلب جديد"],
  ["Order #", "طلب #"],
  ["No completed job orders found for this vehicle (matched by plate number).", "لم يتم العثور على طلبات عمل مكتملة لهذه المركبة (مطابقة برقم اللوحة)."],
  ["Enter Customer ID", "أدخل معرف العميل"],
  ["Customer missing", "العميل غير موجود"],
  ["Customer not found. Please use a valid Customer ID.", "لم يتم العثور على العميل. يرجى استخدام معرف عميل صالح."],
  ["Please enter a Customer ID.", "يرجى إدخال معرف العميل."],
  ["Customer ID is invalid. Please verify a valid customer.", "معرف العميل غير صالح. يرجى التحقق من عميل صالح."],
  ["Verified", "تم التحقق"],
  ["Verified:", "تم التحقق:"],
  ["Customer verified:", "تم التحقق من العميل:"],
  ["Vehicle created successfully!", "تم إنشاء المركبة بنجاح!"],
  ["Vehicle updated successfully!", "تم تحديث المركبة بنجاح!"],
  ["Vehicle deleted successfully!", "تم حذف المركبة بنجاح!"],
  ["Create failed. Check console.", "فشل الإنشاء. تحقق من وحدة التحكم."],
  ["Update failed. Check console.", "فشل التحديث. تحقق من وحدة التحكم."],
  ["Failed to load vehicles. Check console.", "فشل تحميل المركبات. تحقق من وحدة التحكم."],
  ["Vehicle ID is not editable.", "معرف المركبة غير قابل للتعديل."],
  ["Auto-generated", "يتم إنشاؤه تلقائيًا"],
  ["Customer ID required", "معرف العميل مطلوب"],
  ["Make required", "الشركة المصنعة مطلوبة"],
  ["Model required", "الموديل مطلوب"],
  ["Year required", "السنة مطلوبة"],
  ["Type required", "النوع مطلوب"],
  ["Color required", "اللون مطلوب"],
  ["Plate number required", "رقم اللوحة مطلوب"],
  ["Vehicle ID required", "معرف المركبة مطلوب"],
  ["No vehicles found", "لم يتم العثور على مركبات"],
  ["e.g. 123456", "مثال: 123456"],
  ["e.g. 2024", "مثال: 2024"],
  ["Vehicle Management", "إدارة المركبات"],
  ["Search by any vehicle details", "ابحث بأي تفاصيل للمركبة"],
  ["Vehicle Records", "سجلات المركبات"],
  ["Completed Services (from Job Orders)", "الخدمات المكتملة (من أوامر العمل)"],
  ["Order #", "رقم الطلب"],
  ["| Vehicle Management Module", "| وحدة إدارة المركبات"],
  ["You are about to delete vehicle", "أنت على وشك حذف مركبة"],
  ["Owned By", "مملوكة بواسطة"],
  ["Completed Services", "الخدمات المكتملة"],
  ["Add New Order", "إضافة طلب جديد"],
  ["Welcome Back,", "مرحبًا بعودتك،"],
  ["Budget", "الميزانية"],
  ["Expense", "المصروفات"],
  ["🎯", "🎯"],
  ["Projects", "المشاريع"],
  ["Revenue Forecast", "توقعات الإيرادات"],
  ["Overview of Profit", "نظرة عامة على الربح"],
  ["Revenue forecast lines", "خطوط توقعات الإيرادات"],
  ["Your Performance", "أداؤك"],
  ["Live check on operations", "متابعة مباشرة للعمليات"],
  ["New orders", "طلبات جديدة"],
  ["Orders on hold", "طلبات معلقة"],
  ["Orders delivered", "طلبات تم تسليمها"],
  ["This week", "هذا الأسبوع"],
  ["Last week", "الأسبوع الماضي"],
  ["Sales Overview", "نظرة عامة على المبيعات"],
  ["Quick Actions", "إجراءات سريعة"],
  ["Jump straight to high impact tasks.", "انتقل مباشرة إلى المهام عالية التأثير."],
  ["Create Invoice", "إنشاء فاتورة"],
  ["Start Inspection", "بدء الفحص"],
  ["Prepare Exit Permit", "تجهيز إذن الخروج"],
  ["Add Customer", "إضافة عميل"],
  ["Priority List", "قائمة الأولويات"],
  ["Keep urgent tasks visible to the team.", "اجعل المهام العاجلة مرئية للفريق."],
  ["Recent Activity", "النشاط الأخير"],
  ["Latest team movements in real-time.", "آخر تحركات الفريق في الوقت الفعلي."],
  ["Customer Name", "اسم العميل"],
  ["Mobile Number", "رقم الجوال"],
  ["Vehicle Plate", "لوحة المركبة"],
  ["Work Status", "حالة العمل"],
  ["Payment Status", "حالة الدفع"],
  ["Email Address", "عنوان البريد الإلكتروني"],
  ["Registered Vehicles", "المركبات المسجلة"],
  ["Add New Vehicle", "إضافة مركبة جديدة"],
  ["Not provided", "غير متوفر"],
  ["Not specified", "غير محدد"],
  ["No notes", "لا توجد ملاحظات"],
  ["N/A", "غير متوفر"],
  ["No vehicles.", "لا توجد مركبات."],
  ["Saving...", "جارٍ الحفظ..."],
  ["completed", "مكتمل"],
  ["added successfully!", "تمت الإضافة بنجاح!"],
  ["This action cannot be undone.", "لا يمكن التراجع عن هذا الإجراء."],
  ["Try adjusting your search terms or click \"New Job Order\" to create one", "جرّب تعديل كلمات البحث أو اضغط \"طلب عمل جديد\" لإنشاء طلب"],
  ["Click \"Add Service\" to add services to this job order", "اضغط \"إضافة خدمة\" لإضافة خدمات إلى طلب العمل هذا"],
  ["Job Order History", "سجل أوامر العمل"],
  ["Cancelled + Unpaid and Completed + Fully Paid job orders (live from backend)", "طلبات العمل الملغاة وغير المدفوعة والمكتملة والمدفوعة بالكامل (مباشرة من الخلفية)"],
  ["Search by Job ID, Customer, Plate, Status...", "ابحث برقم الطلب أو العميل أو اللوحة أو الحالة..."],
  ["No job orders found", "لم يتم العثور على أوامر عمل"],
  ["(Filtered)", "(تمت التصفية)"],
  ["Records per page", "سجلات لكل صفحة"],
  ["Export", "تصدير"],
  ["Service Management System © 2023 | Job Order History Module", "نظام إدارة الخدمة © 2023 | وحدة سجل أوامر العمل"],
  ["Export Data", "تصدير البيانات"],
  ["From Date", "من تاريخ"],
  ["To Date", "إلى تاريخ"],
  ["Export downloads a CSV file (Excel-compatible).", "التصدير ينزّل ملف CSV (متوافق مع Excel)."],
  ["No services in this order.", "لا توجد خدمات في هذا الطلب."],
  ["Customer Notes", "ملاحظات العميل"],
  ["Next Service", "الخدمة التالية"],
  ["Bill ID", "معرف الفاتورة"],
  ["Discount", "الخصم"],
  ["Specification", "المواصفة"],
  ["Specification required before adding this service.", "يجب اختيار المواصفة قبل إضافة هذه الخدمة."],
  ["Included in package", "مشمولة في الباقة"],
  ["Referred Name", "اسم المُحيل"],
  ["Referred Mobile", "جوال المُحيل"],
  ["Net", "الصافي"],
  ["Paid", "المدفوع"],
  ["Amount Paid", "المبلغ المدفوع"],
  ["Balance Due", "الرصيد المستحق"],
  ["Voucher Gift", "قسيمة هدية"],
  ["Voucher Gift Builder", "منشئ قسيمة الهدية"],
  ["Create voucher gifts with live service/package pricing and policy-based discount limits.", "أنشئ قسائم هدية مع تسعير حي للخدمات/الباقات وحدود خصم حسب السياسات."],
  ["Voucher Gift Summary", "ملخص قسيمة الهدية"],
  ["Net Voucher", "صافي القسيمة"],
  ["Generate Voucher With Payment Info", "إنشاء قسيمة مع معلومات الدفع"],
  ["Generate Voucher Without Payment Info", "إنشاء قسيمة بدون معلومات الدفع"],
  ["Voucher with payment information opened in a new tab.", "تم فتح القسيمة مع معلومات الدفع في علامة تبويب جديدة."],
  ["Voucher without payment information opened in a new tab.", "تم فتح القسيمة بدون معلومات الدفع في علامة تبويب جديدة."],
  ["Package Pricing Audit", "تدقيق تسعير الباقة"],
  ["Quality Check Module", "وحدة فحص الجودة"],
  ["Quality Check Records", "سجلات فحص الجودة"],
  ["No quality check jobs found", "لم يتم العثور على مهام فحص جودة"],
  ["Service Management System © 2023 | Quality Check Module", "نظام إدارة الخدمة © 2023 | وحدة فحص الجودة"],
  ["Quality Check Details - Job Order #", "تفاصيل فحص الجودة - طلب العمل #"],
  ["✓ Pass", "✓ ناجح"],
  ["✗ Failed", "✗ فاشل"],
  ["~ Acceptable", "~ مقبول"],
  // Batch 2 — Dashboard / Customer / Vehicule / Tickets / Employees
  ["Add Employee", "أضف موظفاً"],
  ["approvals pending decision", "موافقات في انتظار القرار"],
  ["Create ticket", "إنشاء تذكرة"],
  ["Delete this ticket?", "هل تريد حذف هذه التذكرة؟"],
  ["delivery QC misses", "إخفاقات فحص جودة التسليم"],
  ["Edit Employee", "تعديل الموظف"],
  ["Failed to create ticket.", "فشل إنشاء التذكرة."],
  ["Failed to delete employee.", "فشل حذف الموظف."],
  ["Failed to load tickets.", "فشل تحميل التذاكر."],
  ["First name is required", "الاسم الأول مطلوب"],
  ["First name, last name and email are required.", "الاسم الأول والأخير والبريد الإلكتروني مطلوبة."],
  ["Job order", "أمر العمل"],
  ["Last name is required", "اسم العائلة مطلوب"],
  ["Missing", "مفقود"],
  ["New Employee", "موظف جديد"],
  ["No employees yet.", "لا يوجد موظفون بعد."],
  ["No tickets yet.", "لا توجد تذاكر بعد."],
  ["Not Found", "غير موجود"],
  ["Operation failed. Check console for details.", "فشلت العملية. تحقق من وحدة التحكم للتفاصيل."],
  ["Phone:", "الهاتف:"],
  ["Position", "المنصب"],
  ["Salary", "الراتب"],
  ["Salary:", "الراتب:"],
  ["service approvals aging >24h", "موافقات الخدمة التي تجاوزت 24 ساعة"],
  ["Support Tickets", "تذاكر الدعم"],
  ["Ticket created.", "تم إنشاء التذكرة."],
  ["Ticket deleted.", "تم حذف التذكرة."],
  ["Ticket updated.", "تم تحديث التذكرة."],
  ["Title", "العنوان"],
  ["Title is required.", "العنوان مطلوب."],
  ["Vehicle Management Module", "وحدة إدارة المركبات"],
  ["vehicles awaiting inspection", "مركبات في انتظار الفحص"],
  ["Welcome Back", "مرحباً بعودتك"],
  ["Secure Email Access", "الوصول الآمن للبريد الإلكتروني"],
  ["Signing in...", "جاري تسجيل الدخول..."],
  ["Access Email", "الوصول إلى البريد"],
  ["Your credentials are sent securely to AWS WorkMail servers only.", "يتم إرسال بيانات اعتمادك بأمان إلى خوادم AWS WorkMail فقط."],
  ["Trouble signing in?", "مشكلة في تسجيل الدخول؟"],
  ["Contact your administrator for password reset assistance.", "تواصل مع مسؤولك للحصول على مساعدة إعادة تعيين كلمة المرور."],
  ["Email and password are required.", "البريد الإلكتروني وكلمة المرور مطلوبان."],
  ["Invalid email or password. Please try again.", "بريد إلكتروني أو كلمة مرور غير صحيحة. يرجى المحاولة مرة أخرى."],
  ["Failed to retrieve your email. Please contact support.", "فشل الحصول على بريدك الإلكتروني. يرجى التواصل مع الدعم."],
  ["Authentication successful. Opening your inbox...", "تم التحقق بنجاح. جاري فتح صندوق الوارد..."],
  ["Show password", "عرض كلمة المرور"],
  ["Hide password", "إخفاء كلمة المرور"],
  ["Your account is locked. Please contact your administrator.", "حسابك مقفل. يرجى التواصل مع مسؤولك."],
  ["Too many failed login attempts. Please try again later.", "محاولات تسجيل دخول فاشلة كثيرة جداً. يرجى المحاولة لاحقاً."],
  ["Use your WorkMail username (for example: mohd.haggo) or full email address.", "استخدم اسم مستخدم WorkMail الخاص بك (مثال: mohd.haggo) أو البريد الإلكتروني الكامل."],
  ["Unable to open WorkMail. Please try again.", "تعذر فتح WorkMail. يرجى المحاولة مرة أخرى."],
  ["Continue with SSO", "المتابعة عبر تسجيل الدخول الموحد"],
  ["Redirecting...", "جاري إعادة التوجيه..."],
  ["Single Sign-On will open your organization identity provider for authentication.", "سيفتح تسجيل الدخول الموحد موفر الهوية الخاص بمؤسستك لإتمام المصادقة."],
  ["Email is required.", "البريد الإلكتروني مطلوب."],
  ["Continue to Email", "المتابعة إلى البريد الإلكتروني"],
  ["Your organization currently opens the Amazon WorkMail web application directly.", "تقوم مؤسستك حالياً بفتح تطبيق Amazon WorkMail مباشرة."],
  ["Campaign Audience is temporarily unavailable.", "ميزة جمهور الحملة غير متاحة مؤقتاً."],
  ["File Sharing is temporarily unavailable.", "ميزة مشاركة الملفات غير متاحة مؤقتاً."],
  ["Push Notifications is temporarily unavailable.", "ميزة إشعارات الرسائل النصية غير متاحة مؤقتاً."],
  ["Daily Report", "التقرير اليومي"],
  ["Scheduled Reports", "التقارير المجدولة"],
  ["Analytics & Delivery", "التحليلات والتسليم"],
  ["Filter data, export PDF/Excel instantly, and schedule report delivery by email.", "صفِّ البيانات وصدِّر PDF أو Excel فوراً وجدول إرسال التقرير عبر البريد الإلكتروني."],
  ["Report Filters", "فلاتر التقرير"],
  ["Filter by customer, vehicle, service, status, payment state, and date range.", "قم بالتصفية حسب العميل والمركبة والخدمة والحالة وحالة الدفع ونطاق التاريخ."],
  ["Reset Filters", "إعادة تعيين الفلاتر"],
  ["Generate Excel", "إنشاء Excel"],
  ["Schedule Delivery", "جدولة الإرسال"],
  ["Date & Time", "التاريخ والوقت"],
  ["Select recipient", "اختر المستلم"],
  ["Schedule Report", "جدولة التقرير"],
  ["Filtered Report Preview", "معاينة التقرير المفلتر"],
  ["Scheduled Reports Queue", "قائمة التقارير المجدولة"],
  ["Recipient", "المستلم"],
  ["Send At", "الإرسال في"],
  ["No records match the current filters.", "لا توجد سجلات تطابق الفلاتر الحالية."],
  ["No schedules found.", "لا توجد جداول تقارير."],
  ["Please select a recipient email.", "يرجى اختيار بريد إلكتروني للمستلم."],
  ["Please choose a valid schedule date and time.", "يرجى اختيار تاريخ ووقت صالحين للجدولة."],
  ["Scheduled report model is not available yet. Please deploy backend changes.", "نموذج التقارير المجدولة غير متاح بعد. يرجى نشر تغييرات الخلفية."],
  ["Report schedule saved successfully.", "تم حفظ جدول التقرير بنجاح."],
  ["Failed to save report schedule.", "فشل حفظ جدول التقرير."],
  ["You do not have access to export PDF reports.", "ليس لديك صلاحية تصدير تقارير PDF."],
  ["You do not have access to export Excel reports.", "ليس لديك صلاحية تصدير تقارير Excel."],
  ["You do not have access to schedule reports.", "ليس لديك صلاحية جدولة التقارير."],
  ["You do not have access to cancel schedules.", "ليس لديك صلاحية إلغاء الجداول."],
  ["PDF report generated successfully.", "تم إنشاء تقرير PDF بنجاح."],
  ["Excel report generated successfully.", "تم إنشاء تقرير Excel بنجاح."],
  ["Failed to load scheduled report data.", "فشل تحميل بيانات التقارير المجدولة."],
  ["Schedule cancelled.", "تم إلغاء الجدول."],
  ["Failed to cancel schedule.", "فشل إلغاء الجدول."],
  ["Data Model", "نموذج البيانات"],
  ["Model", "النموذج"],
  ["Report Scope", "نطاق التقرير"],
  ["Included Fields", "الحقول المضمنة"],
  ["Please select at least one field to include in the report.", "يرجى اختيار حقل واحد على الأقل لإدراجه في التقرير."],
  ["Filter Field 1", "حقل التصفية 1"],
  ["Filter Value 1", "قيمة التصفية 1"],
  ["Filter Field 2", "حقل التصفية 2"],
  ["Filter Value 2", "قيمة التصفية 2"],
  ["Filter Field 3", "حقل التصفية 3"],
  ["Filter Value 3", "قيمة التصفية 3"],
  ["Report Title", "عنوان التقرير"],
  ["Today at a glance", "لمحة سريعة لليوم"],
  ["Track performance, incidents, and delivery flow in one place.", "تابع الأداء والحوادث وتدفق التسليم في مكان واحد."],
  ["Executive Operations", "العمليات التنفيذية"],
  ["Unified daily brief for service, quality, finance, and staffing.", "ملخص يومي موحد للخدمة والجودة والمالية والتوظيف."],
  ["Report Date", "تاريخ التقرير"],
  ["Visual Flavor", "الطابع البصري"],
  ["Style", "النمط"],
  ["Executive", "تنفيذي"],
  ["Technical", "تقني"],
  ["Luxury", "فاخر"],
  ["Export Snapshot", "تصدير الملخص"],
  ["Jobs Created", "الأوامر المنشأة"],
  ["Jobs Completed", "الأوامر المكتملة"],
  ["Revenue", "الإيرادات"],
  ["New Customers", "عملاء جدد"],
  ["Active Employees", "الموظفون النشطون"],
  ["Incidents", "الحوادث"],
  ["Operational Health", "صحة العمليات"],
  ["Completion Rate", "معدل الإنجاز"],
  ["Quality Score", "مؤشر الجودة"],
  ["Today Feed", "تغذية اليوم"],
  ["No activity captured for this date.", "لا يوجد نشاط مسجل لهذا التاريخ."],
  ["No file path/url available", "لا يوجد مسار ملف أو رابط متاح"],
  ["Daily operations focus", "تركيز العمليات اليومية"],
  ["Overview", "نظرة عامة"],
  ["Operations", "العمليات"],
  ["Communication", "التواصل"],
  ["People & Support", "الأفراد والدعم"],
  ["Top priority: keep rework and incident count under control before shift handoff.", "الأولوية القصوى: إبقاء إعادة العمل وعدد الحوادث تحت السيطرة قبل تسليم الوردية."],
  ["Finance watch: verify invoice alignment for all completed orders.", "متابعة مالية: التحقق من توافق الفواتير لجميع الأوامر المكتملة."],
  ["Service focus: maintain throughput while preserving quality checkpoints.", "تركيز الخدمة: الحفاظ على سرعة الإنجاز مع الالتزام بنقاط فحص الجودة."],
  ["Event", "حدث"],
  ["Filter debug", "تشخيص الفلتر"],
  ["Auto-detected columns from current result set", "الأعمدة المكتشفة تلقائياً من مجموعة النتائج الحالية"],
  ["Service columns", "أعمدة الخدمة"],
  ["Date columns", "أعمدة التاريخ"],
  ["No service columns detected", "لم يتم اكتشاف أعمدة خدمة"],
  ["No date columns detected", "لم يتم اكتشاف أعمدة تاريخ"],
  ["Low confidence", "ثقة منخفضة"],
  ["Medium confidence", "ثقة متوسطة"],
  ["High confidence", "ثقة عالية"],
  ["From Date", "من تاريخ"],
  ["To Date", "إلى تاريخ"],
  ["Activity Feed", "تغذية النشاط"],
  ["No activity captured for this date range.", "لا يوجد نشاط مسجل لهذا النطاق الزمني."],
  ["Job Order Details", "تفاصيل أوامر العمل"],
  ["No job orders found for this date range.", "لا توجد أوامر عمل ضمن هذا النطاق الزمني."],
  ["Customers In Range", "العملاء ضمن النطاق"],
  ["No customers found for this date range.", "لا يوجد عملاء ضمن هذا النطاق الزمني."],
  ["Vehicles In Range", "المركبات ضمن النطاق"],
  ["No vehicles found for this date range.", "لا توجد مركبات ضمن هذا النطاق الزمني."],
  ["Vehicle", "المركبة"],
  ["Products", "المنتجات"],
  ["Raw Details", "تفاصيل خام"],
  ["to", "إلى"],
  ["Detected source columns used now", "أعمدة المصدر المكتشفة والمستخدمة الآن"],
  ["Customer source", "مصدر العميل"],
  ["Vehicle source", "مصدر المركبة"],
  ["Service source", "مصدر الخدمة"],
  ["Unknown source", "مصدر غير معروف"],
  ["Click a source label to open and highlight it in Raw Details.", "انقر على تسمية المصدر لفتحها وتمييزها داخل التفاصيل الخام."],
  ["Click a source label to open and highlight it in Raw Details. Use Ctrl/Cmd + click to multi-select.", "انقر على تسمية المصدر لفتحها وتمييزها داخل التفاصيل الخام. استخدم Ctrl/Cmd مع النقر للتحديد المتعدد."],
  // JobOrderHistory — missing keys
  ["Not assigned", "غير معين"],
  ["Not started", "لم يبدأ"],
  ["Load failed:", "فشل التحميل:"],
  ["Records", "السجلات"],
  ["0m", "0 دقيقة"],
  // PaymentInvoiceManagement — missing keys
  ["Order not found in backend.", "لم يتم العثور على الطلب في النظام."],
  ["Repair failed:", "فشلت عملية الإصلاح:"],
  ["Cancel failed:", "فشل الإلغاء:"],
  ["Payment failed:", "فشل الدفع:"],
  ["Refund failed:", "فشل الاسترداد:"],
  ["Bill generation failed:", "فشل إنشاء الفاتورة:"],
  ["Refund can only be initiated for cancelled orders.", "يمكن بدء الاسترداد فقط للطلبات الملغاة."],
  ["No payments exist for this order. Refund is not possible.", "لا توجد مدفوعات لهذا الطلب. الاسترداد غير ممكن."],
  ["Please upload a valid file (JPG, PNG, or PDF).", "يرجى رفع ملف صالح (JPG أو PNG أو PDF)."],
  ["File size must be less than 5MB.", "يجب أن يكون حجم الملف أقل من 5 ميجابايت."],
  ["Please select a payment method.", "يرجى اختيار طريقة الدفع."],
  ["Please enter a valid payment amount.", "يرجى إدخال مبلغ دفع صالح."],
  ["Please upload proof of transfer.", "يرجى رفع إثبات التحويل."],
  ["This job order is already fully paid. No additional payment is allowed.", "هذا الطلب مدفوع بالكامل بالفعل. لا يُسمح بأي دفعة إضافية."],
  ["Bill with the same payment details already exists in Documents.", "توجد فاتورة بنفس تفاصيل الدفع بالفعل في المستندات."],
  ["Bill generated successfully and added to Documents.", "تم إنشاء الفاتورة بنجاح وإضافتها إلى المستندات."],
  ["Generating...", "جارٍ الإنشاء..."],
  ["Cancelling...", "جارٍ الإلغاء..."],
  ["Record Payment", "تسجيل دفعة"],
  ["Process Refund", "معالجة الاسترداد"],
  ["Generate Bill", "إنشاء فاتورة"],
  ["Invoice", "فاتورة"],
  ["Transfer proof uploaded to Documents.", "تم رفع إثبات التحويل إلى المستندات."],
  ["Backend order not found.", "لم يتم العثور على طلب الخلفية."],
  ["Load failed:", "فشل التحميل:"],
  ["Inspection Module", "وحدة الفحص"],
  ["Search by any details", "ابحث بأي تفاصيل"],
  ["No jobs found", "لم يتم العثور على وظائف"],
  ["inspection jobs", "طلبات الفحص"],
  ["Inspection Jobs Records", "سجلات طلبات الفحص"],
  ["Records per page:", "السجلات لكل صفحة:"],
  ["No inspection jobs found", "لم يتم العثور على طلبات فحص"],
  ["Service Management System © 2023 | Inspection Module", "نظام إدارة الخدمة © 2023 | وحدة الفحص"],
  ["Inspection Details - Job Order #", "تفاصيل الفحص - أمر العمل #"],
  ["Download Inspection Report", "تنزيل تقرير الفحص"],
  ["No services added yet", "لم تتم إضافة خدمات بعد"],
  ["Inspection List", "قائمة الفحص"],
  ["Inspection started.", "تم بدء الفحص."],
  ["Start failed:", "فشل البدء:"],
  ["Save and Pause Inspection", "حفظ وإيقاف الفحص"],
  ["Save and pause", "احفظ وأوقف"],
  ["inspection? You can resume later.", "الفحص؟ يمكنك الاستئناف لاحقًا."],
  ["inspection saved and paused.", "تم حفظ الفحص وإيقافه."],
  ["inspection resumed.", "تم استئناف الفحص."],
  ["Mark as Not Required", "وضع كغير مطلوب"],
  ["Mark", "وضع"],
  ["inspection as not required?", "الفحص كغير مطلوب؟"],
  ["Complete", "إكمال"],
  ["inspection?", "الفحص؟"],
  ["inspection completed successfully.", "تم إكمال الفحص بنجاح."],
  ["Finish the inspection? Status will change to Service_Operation.", "إنهاء الفحص؟ ستتغير الحالة إلى Service_Operation."],
  ["Inspection finished! Status changed to Service_Operation.", "تم إنهاء الفحص! تم تغيير الحالة إلى Service_Operation."],
  ["Finish failed:", "فشل الإنهاء:"],
  ["Order Cancelled Successfully", "تم إلغاء الطلب بنجاح"],
  ["Select all items as Pass", "حدد كل العناصر كناجحة"],
  ["Select All", "تحديد الكل"],
  ["Add comments...", "أضف تعليقات..."],
  ["Upload/Take Photo", "رفع/التقاط صورة"],
  ["Add Services to Job Order", "إضافة خدمات إلى أمر العمل"],
  ["Services Selection", "اختيار الخدمات"],
  ["Select services for", "اختر خدمات لـ"],
  ["Create services from Service Creation before adding services.", "أنشئ خدمات من شاشة إنشاء الخدمات قبل إضافتها."],
  ["All Categories", "كل الفئات"],
  ["No services match your filter", "لا توجد خدمات مطابقة لفلترك"],
  ["Try a different category or type.", "جرّب فئة أو نوعًا مختلفًا."],
  ["Price Summary", "ملخص السعر"],
  ["Apply Discount:", "تطبيق الخصم:"],
  ["Remaining Allowed Discount:", "الخصم المتبقي المسموح:"],
  ["Exit permit already exists for this order.", "يوجد إذن خروج مسبق لهذا الطلب."],
  ["No order selected for exit permit creation.", "لم يتم اختيار طلب لإنشاء إذن الخروج."],
  ["This order is not eligible for Exit Permit.", "هذا الطلب غير مؤهل لإنشاء إذن الخروج."],
  ["Please fill in all required fields.", "الرجاء تعبئة جميع الحقول المطلوبة."],
  ["Please select a next service date.", "الرجاء اختيار تاريخ الخدمة القادمة."],
  ["No eligible job orders found", "لا توجد طلبات مؤهلة"],
  ["This screen displays only orders eligible for exit permit creation", "تعرض هذه الشاشة فقط الطلبات المؤهلة لإنشاء إذن الخروج"],
  ["Exit Permit Created Successfully!", "تم إنشاء إذن الخروج بنجاح!"],
  ["Permit ID:", "رقم الإذن:"],
  ["Not Evaluated", "لم يُقيَّم"],
  ["Product Inventory", "مخزون المنتجات"],
  ["Manage product categories, subcategories, and stock", "إدارة فئات المنتجات والفئات الفرعية والمخزون"],
  ["Add Category", "إضافة فئة"],
  ["Refresh", "تحديث"],
  ["No categories yet", "لا توجد فئات بعد"],
  ["Click \"Add Category\" to create your first category.", "انقر \"إضافة فئة\" لإنشاء أول فئة."],
  ["No inventory categories have been created.", "لم يتم إنشاء أي فئات للمخزون."],
  ["Subcategory", "فئة فرعية"],
  ["Subcategories", "فئات فرعية"],
  ["Click to explore", "انقر للاستكشاف"],
  ["Edit category", "تعديل الفئة"],
  ["Delete category", "حذف الفئة"],
  ["Subcategories inside", "الفئات الفرعية داخل"],
  ["Back", "رجوع"],
  ["Add Subcategory", "إضافة فئة فرعية"],
  ["Create at least one subcategory first", "أنشئ فئة فرعية واحدة على الأقل أولاً"],
  ["Add product directly in this category", "أضف منتجًا مباشرة داخل هذه الفئة"],
  ["Add Product", "إضافة منتج"],
  ["No subcategories yet", "لا توجد فئات فرعية بعد"],
  ["Click \"Add Subcategory\" to create one.", "انقر \"إضافة فئة فرعية\" لإنشاء واحدة."],
  ["No subcategories in this category.", "لا توجد فئات فرعية في هذه الفئة."],
  ["Custom Field", "حقل مخصص"],
  ["Custom Fields", "حقول مخصصة"],
  ["Quick product name", "اسم منتج سريع"],
  ["Quick Add", "إضافة سريعة"],
  ["Click to view products", "انقر لعرض المنتجات"],
  ["Manage custom fields", "إدارة الحقول المخصصة"],
  ["Edit subcategory", "تعديل الفئة الفرعية"],
  ["Delete subcategory", "حذف الفئة الفرعية"],
  ["Showing products in", "عرض المنتجات في"],
  ["Add Products", "إضافة منتجات"],
  ["Search by name, serial or barcode...", "ابحث بالاسم أو الرقم التسلسلي أو الباركود..."],
  ["No products match your search", "لا توجد منتجات تطابق بحثك"],
  ["No products yet", "لا توجد منتجات بعد"],
  ["Click \"Add Products\" to add stock.", "انقر \"إضافة منتجات\" لإضافة مخزون."],
  ["Product Name", "اسم المنتج"],
  ["Serial / Barcode", "الرقم التسلسلي / الباركود"],
  ["Available", "المتاح"],
  ["Total Added", "إجمالي المضاف"],
  ["S/N:", "الرقم التسلسلي:"],
  ["QR:", "رمز QR:"],
  ["unit", "وحدة"],
  ["units", "وحدات"],
  ["Delete product", "حذف المنتج"],
  ["Recent Transactions", "أحدث المعاملات"],
  ["Add Stock", "إضافة مخزون"],
  ["Store - Product Checkout", "المتجر - صرف المنتجات"],
  ["Select a product category, then choose what to retrieve from inventory", "اختر فئة منتج ثم حدد ما تريد سحبه من المخزون"],
  ["Start Over", "ابدأ من جديد"],
  ["Select Category", "اختر الفئة"],
  ["Select Subcategory", "اختر الفئة الفرعية"],
  ["Checkout Products", "صرف المنتجات"],
  ["Which category do you want to retrieve products from?", "من أي فئة تريد سحب المنتجات؟"],
  ["No inventory categories", "لا توجد فئات للمخزون"],
  ["Ask an admin to set up product categories first.", "اطلب من المسؤول إعداد فئات المنتجات أولاً."],
  ["Select a subcategory", "اختر فئة فرعية"],
  ["Which subcategory do you want to retrieve products from?", "من أي فئة فرعية تريد سحب المنتجات؟"],
  ["No subcategories", "لا توجد فئات فرعية"],
  ["This category has no subcategories with products.", "هذه الفئة لا تحتوي على فئات فرعية بها منتجات."],
  ["Back to Categories", "العودة إلى الفئات"],
  ["Available Products", "المنتجات المتاحة"],
  ["Select quantity to check out", "اختر الكمية للصرف"],
  ["No products available for checkout", "لا توجد منتجات متاحة للصرف"],
  ["All products in this subcategory are out of stock or unavailable.", "كل المنتجات في هذه الفئة الفرعية نافدة أو غير متاحة."],
  ["available", "متاح"],
  ["Qty:", "الكمية:"],
  ["Back to Subcategories", "العودة إلى الفئات الفرعية"],
  ["Recent Store Activity", "أحدث نشاط المتجر"],
  ["Qty", "الكمية"],
  ["Checked Out By", "تم صرفه بواسطة"],
  ["New Category", "فئة جديدة"],
  ["Category Name", "اسم الفئة"],
  ["e.g. Electronics, Lubricants, Tools...", "مثل: إلكترونيات، زيوت، أدوات..."],
  ["Optional description...", "وصف اختياري..."],
  ["Saving...", "جارٍ الحفظ..."],
  ["Save Changes", "حفظ التغييرات"],
  ["Create Category", "إنشاء فئة"],
  ["New Subcategory", "فئة فرعية جديدة"],
  ["Inside category:", "داخل الفئة:"],
  ["Subcategory Name", "اسم الفئة الفرعية"],
  ["e.g. Motor Oil, Filters, Brake Pads...", "مثل: زيت المحرك، الفلاتر، فحمات الفرامل..."],
  ["You can define custom product fields for this subcategory after creating it.", "يمكنك تحديد حقول منتجات مخصصة لهذه الفئة الفرعية بعد إنشائها."],
  ["Define the data fields that will appear on every product in", "حدد حقول البيانات التي ستظهر على كل منتج في"],
  ["These fields will be available when adding products by quantity.", "ستكون هذه الحقول متاحة عند إضافة المنتجات حسب الكمية."],
  ["No custom fields defined", "لا توجد حقول مخصصة معرفة"],
  ["Click \"Add Field\" to add your first custom field.", "انقر \"إضافة حقل\" لإضافة أول حقل مخصص."],
  ["Field label (e.g. Color)", "تسمية الحقل (مثل: اللون)"],
  ["Field type", "نوع الحقل"],
  ["Text (string)", "نص (string)"],
  ["Yes/No (boolean)", "نعم/لا (boolean)"],
  ["Mark as required", "تعيين كمطلوب"],
  ["Remove field", "إزالة الحقل"],
  ["Add Field", "إضافة حقل"],
  ["Save Field Definitions", "حفظ تعريفات الحقول"],
  ["to", "إلى"],
  ["Select subcategory...", "اختر فئة فرعية..."],
  ["No subcategories found. Create a subcategory first.", "لم يتم العثور على فئات فرعية. أنشئ فئة فرعية أولاً."],
  ["By Quantity", "حسب الكمية"],
  ["By Scanning", "بواسطة المسح"],
  ["Checked out", "تم صرف"],
  ["unit(s) of", "وحدة من"],
  ["unit(s) available.", "وحدة متاحة."],
  ["Only", "فقط"],
  ["Added", "تمت إضافة"],
  ["item(s) added via scan.", "عنصر تمت إضافته عبر المسح."],
  ["is already in the scan list.", "موجود بالفعل في قائمة المسح."],
  ["No items to process.", "لا توجد عناصر للمعالجة."],
  ["Failed to process scan", "فشل في معالجة المسح"],
  ["Enter a product name for", "أدخل اسم منتج لـ"],
  ["this subcategory", "هذه الفئة الفرعية"],
  ["Quick added", "تمت الإضافة السريعة"],
  ["in", "في"],
  ["Product removed.", "تم حذف المنتج."],
  ["Category removed.", "تم حذف الفئة."],
  ["Subcategory removed.", "تم حذف الفئة الفرعية."],
  ["Field definitions saved.", "تم حفظ تعريفات الحقول."],
  ["Please enter a product name.", "يرجى إدخال اسم منتج."],
  ["Failed to add product", "فشل في إضافة المنتج"],
  ["Failed to load categories", "فشل في تحميل الفئات"],
  ["Failed to load subcategories", "فشل في تحميل الفئات الفرعية"],
  ["Failed to load products", "فشل في تحميل المنتجات"],
  ["Load failed", "فشل التحميل"],
  ["Checkout failed", "فشل الصرف"],
  ["Delete failed", "فشل الحذف"],
  ["Save failed", "فشل الحفظ"],
  ["Subcategory updated.", "تم تحديث الفئة الفرعية."],
  ["Subcategory created.", "تم إنشاء الفئة الفرعية."],
  ["Category updated.", "تم تحديث الفئة."],
  ["Category created.", "تم إنشاء الفئة."],
  ["No order selected.", "لم يتم اختيار طلب."],
  ["Order not found.", "لم يتم العثور على الطلب."],
  ["Quality Check Approved! Order moved to Ready status.", "تم اعتماد فحص الجودة! تم نقل الطلب إلى حالة جاهز."],
  ["Quality Check Rejected! Order returned to Service Execution (Service_Operation).", "تم رفض فحص الجودة! تمت إعادة الطلب إلى تنفيذ الخدمة (Service_Operation)."],
  ["Approve failed:", "فشل الاعتماد:"],
  ["Reject failed:", "فشل الرفض:"],
  ["Specification:", "المواصفة:"],
  ["Daily Sales Snapshot", "ملخص المبيعات اليومي"],
  ["No records in selected date range.", "لا توجد سجلات ضمن النطاق الزمني المحدد."],
  ["Branch", "الفرع"],
  ["Vehicle Model", "طراز المركبة"],
  ["Advisor", "المستشار"],
  ["Brand", "العلامة"],
  ["Service Description", "وصف الخدمة"],
  ["Invoice No", "رقم الفاتورة"],
];

PHRASES_EN_AR.push(
  ["Create Job Card", "إنشاء بطاقة عمل"],
  ["Preparing job card...", "جاري تجهيز بطاقة العمل..."],
  ["Job Order Receipt", "إيصال أمر العمل"],
  ["All Data Models", "كل نماذج البيانات"],
  ["Select data models", "اختر نماذج البيانات"],
  ["Job Orders Only", "أوامر العمل فقط"],
  ["Data Model", "نموذج البيانات"],
  ["Job Orders", "أوامر العمل"],
  ["Service Catalog", "دليل الخدمات"],
  ["User Profiles", "ملفات المستخدمين"],
  ["Voucher Gifts", "هدايا القسائم"],
  ["Quotations", "عروض الأسعار"],
  ["Inspection finished! Status changed to Service_Operation and PDF report generated.", "تم إنهاء الفحص! تم تغيير الحالة إلى تنفيذ الخدمة وتم إنشاء تقرير PDF."],
  ["Customer Signature (Required)", "توقيع العميل (مطلوب)"],
  ["Attention and Failed Findings", "الملاحظات التي تحتاج انتباهاً أو فشلت"],
  ["No attention or failed findings were recorded. Pass and completed items are excluded from this report.", "لم يتم تسجيل أي ملاحظات تحتاج انتباهاً أو فشلت. يتم استبعاد العناصر الناجحة والمكتملة من هذا التقرير."],
  ["Attention and failed findings only", "الملاحظات التي تحتاج انتباهاً أو فشلت فقط"],
  ["PDF report generated", "تم إنشاء تقرير PDF"],
  ["CRM@roadiodrive.work", "CRM@roadiodrive.work"],
  ["| Sedan:", "| سيدان:"],
);

PHRASES_EN_AR.push(
  ["Today at a glance", "لمحة سريعة لليوم"],
  ["Track performance, incidents, and delivery flow in one place.", "تابع الأداء والحوادث وتدفق التسليم في مكان واحد."],
  ["Overview", "نظرة عامة"],
  ["Operations", "العمليات"],
  ["Loading dashboard...", "جاري تحميل لوحة التحكم..."],
  ["Job Status Overview", "نظرة عامة على حالة الطلبات"],
  ["Jobs Over Time", "الطلبات عبر الوقت"],
  ["Top Service Categories", "أعلى فئات الخدمات"],
  ["View all", "عرض الكل"],
  ["Daily", "يومي"],
  ["history count", "عدد السجلات"],
  ["all time", "كل الوقت"],
  ["collected", "محصل"],
  ["New Requests", "طلبات جديدة"],
  ["In Progress", "قيد التنفيذ"],
  ["Upcoming Deliveries", "عمليات التسليم القادمة"],
  ["Avg. Turnaround Time", "متوسط وقت الإنجاز"],
  ["Days", "أيام"],
  ["Service Operation", "تنفيذ الخدمة"],
  ["New Request", "طلب جديد"],
  ["Search by any inspection details", "ابحث بأي تفاصيل فحص"],
  ["Track incoming inspections, move active vehicles forward, and keep the queue review-ready.", "تابع الفحوصات الواردة، وادفع المركبات النشطة للأمام، وحافظ على جاهزية قائمة المراجعة."],
  ["DETAILS", "التفاصيل"],
  ["FULL NAME", "الاسم الكامل"],
  ["EXPECTED DELIVERY", "موعد التسليم المتوقع"],
  ["TECHNICIAN", "الفني"],
  ["HEARD FROM", "مصدر المعرفة"],
  ["TOTAL AMOUNT", "إجمالي المبلغ"],
  ["Language", "اللغة"]
);

const AUTO_AUDIT_TRANSLATIONS_EN_AR: Array<[string, string]> = [
  [
    "Application Error",
    "??????? ???"
  ],
  [
    "A runtime error interrupted rendering. You can retry without reloading first.",
    "??? ??????? ??? ???? ????? ??? can ????? ???????? ???? re???? ??????? ?????"
  ],
  [
    "Retry Render",
    "????? ???????? ?????"
  ],
  [
    "Reload Page",
    "????? ????? ????"
  ],
  [
    "Inventory",
    "???????"
  ],
  [
    "Service Technicians",
    "?????? ???????"
  ],
  [
    "Database Cleanup",
    "????? ????? ????????"
  ],
  [
    "Current date and time",
    "?????? ??????? ? ?????"
  ],
  [
    "Language",
    "?????"
  ],
  [
    "Language switch",
    "????? ?????"
  ],
  [
    "Internal Chat is temporarily unavailable.",
    "??????? ???????? is ?????? ??? ????"
  ],
  [
    "CRM Rodeo Premium Workspace",
    "CRM Rodeo ???? ????? ?????"
  ],
  [
    "All rights reserved",
    "?? ?????? ??????"
  ],
  [
    "Total Amount",
    "???????? ??????"
  ],
  [
    "Net Amount",
    "?????? ??????"
  ],
  [
    "invoice(s)",
    "????????(s)"
  ],
  [
    "Customer Details",
    "?????? ??????"
  ],
  [
    "Full Name",
    "???? Name"
  ],
  [
    "Heard From",
    "??? ??"
  ],
  [
    "Referral Name",
    "??????? Name"
  ],
  [
    "Referral Mobile",
    "??????? ??????"
  ],
  [
    "Platform",
    "??????"
  ],
  [
    "Source Note",
    "?????? ??????"
  ],
  [
    "Jobs Done",
    "??????? ??"
  ],
  [
    "Overdue",
    "?????"
  ],
  [
    "Schedule & completion times",
    "????? & ??????? ?????"
  ],
  [
    "Expected Delivery",
    "????? ???????"
  ],
  [
    "Expected",
    "?????"
  ],
  [
    "Date",
    "???????"
  ],
  [
    "Time",
    "?????"
  ],
  [
    "Est. Duration",
    "Est. ?????"
  ],
  [
    "Actual Delivery",
    "???? ???????"
  ],
  [
    "Duration",
    "?????"
  ],
  [
    "Delivered By",
    "Delivered ??????"
  ],
  [
    "file(s)",
    "???(s)"
  ],
  [
    "No file available",
    "?? ??? ????"
  ],
  [
    "No documents available",
    "?? ????????? ????"
  ],
  [
    "Documents will appear here once uploaded",
    "????????? will ????? here ????? ???ed"
  ],
  [
    "steps completed",
    "steps ?????"
  ],
  [
    "Service Operation",
    "?????? ?????"
  ],
  [
    "Action By",
    "??????? ??????"
  ],
  [
    "Job Summary",
    "????? ????"
  ],
  [
    "Assigned Technician",
    "Assigned ?????"
  ],
  [
    "evaluated",
    "?? ??????"
  ],
  [
    "Pass",
    "????"
  ],
  [
    "Failed",
    "???"
  ],
  [
    "Technician",
    "?????"
  ],
  [
    "Quality checks will appear here once services are completed",
    "??? ??????s will ????? here ????? ??????? are ?????"
  ],
  [
    "Requested Services & Tasks",
    "Requested ??????? & ??????"
  ],
  [
    "service(s)",
    "??????(s)"
  ],
  [
    "done",
    "??"
  ],
  [
    "Ended",
    "?????"
  ],
  [
    "Use Add Service to append tasks to this job card",
    "Use ????? ?????? ??? append ?????? ??? ??? ????? ?????"
  ],
  [
    "Make / Model",
    "?????? / ??????"
  ],
  [
    "Registration Date",
    "??????? ???????"
  ],
  [
    "You don't have access to this page.",
    "??? don't have ?????? ??? ??? ????"
  ],
  [
    "Refresh logs",
    "????? logs"
  ],
  [
    "Retry",
    "????? ????????"
  ],
  [
    "Loading activity logs\\u2026",
    "???? ??????? ?????? logs..."
  ],
  [
    "No logs yet.",
    "?? logs yet."
  ],
  [
    "Copy mobile numbers",
    "??? ?????? ???????"
  ],
  [
    "Clipboard access is not available in this browser.",
    "??????? ?????? is ??? ???? ?? ??? ???????"
  ],
  [
    "Filtered values copied to the clipboard.",
    "????? ????? ?? ????? ??? ???????"
  ],
  [
    "Upload a large Excel file once, keep the imported dataset in the database, and filter it safely for WhatsApp campaigns.",
    "??? ???? Excel ??? ?????, keep ???????ed dataset ?? ????? ????????, ? ???? ?? ????? ?? WhatsApp campaigns."
  ],
  [
    "Imported rows",
    "???????ed ??????"
  ],
  [
    "Unique mobiles",
    "????? ??????"
  ],
  [
    "Last import",
    "??? ???????"
  ],
  [
    "Excel Import",
    "Excel ???????"
  ],
  [
    "Preview the workbook and upload all records into the campaign audience database table.",
    "?????? ???? ? ??? ?? ??????? ??? ????? ?????? ????? ???????? ????"
  ],
  [
    "Reading file...",
    "Reading ???"
  ],
  [
    "Choose Excel file",
    "?????? Excel ???"
  ],
  [
    "No file selected",
    "?? ??? ????ed"
  ],
  [
    "rows",
    "??????"
  ],
  [
    "Select a workbook to begin",
    "???? ???? ??? ???"
  ],
  [
    "Sheet",
    "????"
  ],
  [
    "Replace current campaign dataset before import",
    "Replace ?????? ?????? dataset ??? ???????"
  ],
  [
    "Preview",
    "??????"
  ],
  [
    "Rows are paginated in groups of 30",
    "?????? are paginated ?? groups ?? 30"
  ],
  [
    "Visible columns",
    "???? ???????"
  ],
  [
    "Removed empty",
    "Removed ????"
  ],
  [
    "Removed empty means columns with no values in all rows.",
    "Removed ???? means ??????? ?? ?? ????? ?? ?? ??????"
  ],
  [
    "Table",
    "????"
  ],
  [
    "Cards",
    "??????"
  ],
  [
    "Scroll horizontally to view all columns",
    "Scroll ?????? ??? ??? ?? ???????"
  ],
  [
    "No rows found in this sheet.",
    "?? ?????? ?? ?????? ?? ??? ????"
  ],
  [
    "Row",
    "??"
  ],
  [
    "First page",
    "????? ????"
  ],
  [
    "Previous page",
    "?????? ????"
  ],
  [
    "Page",
    "????"
  ],
  [
    "Rows",
    "??????"
  ],
  [
    "Next page",
    "?????? ????"
  ],
  [
    "Last page",
    "??? ????"
  ],
  [
    "Jump to page",
    "?????? ??? ????"
  ],
  [
    "Go",
    "??????"
  ],
  [
    "Importing...",
    "???????ing..."
  ],
  [
    "Import into database",
    "??????? ??? ????? ????????"
  ],
  [
    "Total rows",
    "???????? ??????"
  ],
  [
    "Valid rows",
    "????? ??????"
  ],
  [
    "Skipped rows",
    "Skipped ??????"
  ],
  [
    "Duplicates",
    "????????"
  ],
  [
    "Campaign Filters",
    "?????? ???????"
  ],
  [
    "Filter by service date, service name, customer name, phone number, batch, and export the audience list for WhatsApp.",
    "????? ??? ?????? ???????, ?????? name, ?????? name, ?????? ?????, ????, ? ????? ??????? ????? ?? WhatsApp"
  ],
  [
    "Table view",
    "???? ???"
  ],
  [
    "Card view",
    "????? ???"
  ],
  [
    "Loading campaign audience data...",
    "???? ??????? ????? ?????? data..."
  ],
  [
    "Result column",
    "??????? ??????"
  ],
  [
    "Select column",
    "???? ??????"
  ],
  [
    "Service contains",
    "?????? contains"
  ],
  [
    "e.g. polish, full ppf",
    "????: polish, ???? ppf"
  ],
  [
    "Service age",
    "?????? age"
  ],
  [
    "Any",
    "??"
  ],
  [
    "Older than",
    "Older ??"
  ],
  [
    "Newer than",
    "Newer ??"
  ],
  [
    "Date range",
    "??????? ??????"
  ],
  [
    "month",
    "???"
  ],
  [
    "months",
    "????"
  ],
  [
    "Service date from",
    "?????? ??????? ??"
  ],
  [
    "Service date to",
    "?????? ??????? ???"
  ],
  [
    "Selected column values",
    "????ed ?????? ?????"
  ],
  [
    "unique values",
    "????? ?????"
  ],
  [
    "No values match the current real-time filters.",
    "?? ????? ?????? ?????? real-time ???????"
  ],
  [
    "Show unique mobile numbers only",
    "Show ????? ?????? ??????? ???"
  ],
  [
    "Filtered rows",
    "????? ??????"
  ],
  [
    "Pages",
    "?????"
  ],
  [
    "Selected batch",
    "????ed ????"
  ],
  [
    "No rows match the current filters.",
    "?? ?????? ?????? ?????? ???????"
  ],
  [
    "Loading Customers",
    "???? ??????? ???????"
  ],
  [
    "Please wait while we fetch your data",
    "???? wait ????? ??? fetch ????? ?? data"
  ],
  [
    "Contact Info",
    "??? ????? Info"
  ],
  [
    "Vehicle Make/Model",
    "??????? ??????/??????"
  ],
  [
    "Recent Service",
    "???? ??????"
  ],
  [
    "Total Spent",
    "???????? ???????"
  ],
  [
    "service records",
    "?????? ???????"
  ],
  [
    "Not available",
    "??? ????"
  ],
  [
    "Total Vehicles",
    "???????? ????????"
  ],
  [
    "Job",
    "?????"
  ],
  [
    "Deal",
    "Deal"
  ],
  [
    "Contact",
    "??? ?????"
  ],
  [
    "No recent activity available.",
    "?? ???? ?????? ????"
  ],
  [
    "Back to Customers",
    "Back ??? ???????"
  ],
  [
    "Elegant Glass",
    "???? ?????"
  ],
  [
    "Executive Minimal",
    "?????? ????"
  ],
  [
    "Pixel Pass: List View",
    "???? ????: ????? ???"
  ],
  [
    "Pixel Pass: Detail View",
    "???? ????: Detail ???"
  ],
  [
    "Contact Information",
    "??? ????? ???????"
  ],
  [
    "Associated Vehicles",
    "Associated ????????"
  ],
  [
    "Loading vehicles…",
    "???? ??????? ????????…"
  ],
  [
    "Job History / Recent Activity",
    "????? ????? / ???? ??????"
  ],
  [
    "Related Job Orders",
    "Related ??? ?????s"
  ],
  [
    "No related job orders found for this customer.",
    "?? related ??? ?????s ?? ?????? ?? ??? ??????."
  ],
  [
    "No completed services found for this customer.",
    "?? ????? ??????? ?? ?????? ?? ??? ??????."
  ],
  [
    "Permission",
    "????????"
  ],
  [
    "Filtered by:",
    "????? ??????:"
  ],
  [
    "Loading customer details...",
    "???? ??????? ?????? ??????..."
  ],
  [
    "Saving customer...",
    "???? ????? ??????..."
  ],
  [
    "Saving customer changes...",
    "???? ????? ?????? changes..."
  ],
  [
    "Deleting customer...",
    "???? ????? ??????..."
  ],
  [
    "Period From",
    "?????? ??"
  ],
  [
    "Period To",
    "?????? ???"
  ],
  [
    "Generated (Qatar)",
    "?? ??????? (Qatar)"
  ],
  [
    "From",
    "??"
  ],
  [
    "To",
    "???"
  ],
  [
    "Daily KPIs",
    "???? ?????? ??????"
  ],
  [
    "Filters",
    "???????"
  ],
  [
    "Total Jobs",
    "???????? ???????"
  ],
  [
    "all time",
    "?? ?????"
  ],
  [
    "Completed Jobs",
    "????? ???????"
  ],
  [
    "Revenue (QAR)",
    "????????? (QAR)"
  ],
  [
    "collected",
    "???????"
  ],
  [
    "Customer Satisfaction",
    "?????? ?????"
  ],
  [
    "4.8&nbsp;",
    "4.8"
  ],
  [
    "6.2%&nbsp;",
    "6.2%"
  ],
  [
    "vs last 7 days",
    "????? ??? 7 ????"
  ],
  [
    "history count",
    "????? ?????"
  ],
  [
    "Job Status Overview",
    "????? ?????? ???? ????"
  ],
  [
    "View all",
    "??? ??"
  ],
  [
    "Jobs Over Time",
    "??????? Over ?????"
  ],
  [
    "Daily",
    "????"
  ],
  [
    "Last Week",
    "??? ???????"
  ],
  [
    "Top Service Categories",
    "?????? ?????? ??????"
  ],
  [
    "New Requests",
    "???? ?????"
  ],
  [
    "↑ 14.6%",
    "↑ 14.6%"
  ],
  [
    "In Progress",
    "?? ??????"
  ],
  [
    "↑ 10.1%",
    "↑ 10.1%"
  ],
  [
    "Upcoming Deliveries",
    "Upcoming ?????????"
  ],
  [
    "↑ 8.3%",
    "↑ 8.3%"
  ],
  [
    "Avg. Turnaround Time",
    "????? ??????? ?????"
  ],
  [
    "2.6&nbsp;",
    "2.6"
  ],
  [
    "Days",
    "????"
  ],
  [
    "↓ 12.4%",
    "↓ 12.4%"
  ],
  [
    "This will permanently delete",
    "??? will ???? ???? ???"
  ],
  [
    "all records",
    "???? ???????"
  ],
  [
    "from the database, except user profiles. Roles, departments, job orders, customers, vehicles, services, and all other data will be erased. This action",
    "?? ????? ????????, except ???????? ??????? ???????, ???????, ??? ?????s, ???????, ????????, ???????, ? ?? other data will be ????? ??? ???????"
  ],
  [
    "cannot be undone",
    "?? ???? ??????? ???"
  ],
  [
    "Models that will be wiped:",
    "?????? ??? will be wiped:"
  ],
  [
    "to unlock:",
    "??? ??? ?????:"
  ],
  [
    "Cleanup complete.",
    "????? complete."
  ],
  [
    "Total deleted:",
    "???????? ?????:"
  ],
  [
    "records.",
    "???????"
  ],
  [
    "Errors:",
    "?????:"
  ],
  [
    "(check console for details).",
    "(check ???? ?????? ?? ????????)."
  ],
  [
    "Department name required",
    "????? name ?????"
  ],
  [
    "Create failed",
    "????? ???"
  ],
  [
    "Select old and enter new name",
    "???? ???? ? ???? ???? name"
  ],
  [
    "Rename failed",
    "????? ????? ???"
  ],
  [
    "Role creation failed.",
    "????? creation ???"
  ],
  [
    "Add role failed",
    "????? ????? ???"
  ],
  [
    "Role name already exists.",
    "????? name ?????? ?????"
  ],
  [
    "Role update failed",
    "????? ????? ???"
  ],
  [
    "Department & Role Management",
    "????? & ????? ???????"
  ],
  [
    "Add New Department",
    "????? ???? ?????"
  ],
  [
    "Create departments, add roles, and manage your organizational structure with full-width department and role cards.",
    "????? ???????, ????? ???????, ? manage ????? ?? organizational ?????? ?? full-width ????? ? ????? ??????"
  ],
  [
    "Departments & Roles",
    "??????? & ???????"
  ],
  [
    "Department name",
    "????? name"
  ],
  [
    "Total Roles",
    "???????? ???????"
  ],
  [
    "Avg Roles/Dept",
    "????? ???????/Dept"
  ],
  [
    "Add Role",
    "????? ?????"
  ],
  [
    "Department key:",
    "????? ???????:"
  ],
  [
    "Users in this department:",
    "?????????? ?? ??? ?????:"
  ],
  [
    "Department Roles",
    "????? ???????"
  ],
  [
    "Role assigned to this department",
    "????? ?????? ??? ??? ?????"
  ],
  [
    "No roles assigned yet.",
    "?? ??????? assigned yet."
  ],
  [
    "No departments yet.",
    "?? ??????? yet."
  ],
  [
    "Create role",
    "????? ?????"
  ],
  [
    "Create Role",
    "????? ?????"
  ],
  [
    "Department:",
    "?????:"
  ],
  [
    "Role name",
    "????? name"
  ],
  [
    "Role description (optional)",
    "????? description (???????)"
  ],
  [
    "Create & Add",
    "????? & ?????"
  ],
  [
    "Edit role",
    "Edit ?????"
  ],
  [
    "Edit Role",
    "Edit ?????"
  ],
  [
    "Edit department",
    "Edit ?????"
  ],
  [
    "Edit Department",
    "Edit ?????"
  ],
  [
    "Delete Department",
    "??? ?????"
  ],
  [
    "Are you sure you want to delete",
    "?? ??? ????? ??? want ??? ???"
  ],
  [
    "This department must have no users before deletion.",
    "??? ????? must have ?? ?????????? ??? deletion."
  ],
  [
    "Keep Department",
    "Keep ?????"
  ],
  [
    "Loading document...",
    "???? ??????? ?????"
  ],
  [
    "Close editor",
    "????? ??????"
  ],
  [
    "Untitled Document",
    "Untitled ?????"
  ],
  [
    "Saved at",
    "?? ????? at"
  ],
  [
    "Bold",
    "????"
  ],
  [
    "Italic",
    "????"
  ],
  [
    "Underline",
    "?????"
  ],
  [
    "Bullet list",
    "???? ?????"
  ],
  [
    "Numbered list",
    "????? ?????"
  ],
  [
    "Insert link",
    "????? ????"
  ],
  [
    "Insert image",
    "????? ????"
  ],
  [
    "Start typing... Your document will auto-save every 2 seconds.",
    "??? ??????? ????? ?? ????? will auto-save every 2 seconds."
  ],
  [
    "Document (Doc)",
    "????? (?????)"
  ],
  [
    "words",
    "?????"
  ],
  [
    "Unknown editor type",
    "??? ????? ?????? ???"
  ],
  [
    "Loading editor...",
    "???? ??????? ??????"
  ],
  [
    "Loading form...",
    "???? ??????? ???????"
  ],
  [
    "Untitled Form",
    "Untitled ???????"
  ],
  [
    "Form description (optional)",
    "??????? description (???????)"
  ],
  [
    "Add questions to your form",
    "????? ????? ??? ????? ?? ???????"
  ],
  [
    "Question",
    "????"
  ],
  [
    "Short text",
    "Short text"
  ],
  [
    "Long text",
    "Long text"
  ],
  [
    "Checkboxes",
    "Checkboxes"
  ],
  [
    "Multiple choice",
    "Multiple choice"
  ],
  [
    "Dropdown",
    "Dropdown"
  ],
  [
    "Required",
    "?????"
  ],
  [
    "Delete field",
    "??? field"
  ],
  [
    "Add option",
    "????? option"
  ],
  [
    "Add text field",
    "????? text field"
  ],
  [
    "Text",
    "Text"
  ],
  [
    "Add email field",
    "????? ?????? ?????????? field"
  ],
  [
    "Add textarea",
    "????? textarea"
  ],
  [
    "Add checkboxes",
    "????? checkboxes"
  ],
  [
    "Add multiple choice",
    "????? multiple choice"
  ],
  [
    "Add dropdown",
    "????? dropdown"
  ],
  [
    "Answer",
    "?????"
  ],
  [
    "your@email.com",
    "????? ??@email.com"
  ],
  [
    "Choose from list",
    "?????? ?? ?????"
  ],
  [
    "Submit",
    "?????"
  ],
  [
    "Form",
    "???????"
  ],
  [
    "questions",
    "?????"
  ],
  [
    "Loading spreadsheet...",
    "???? ??????? ???? ??????"
  ],
  [
    "Untitled Spreadsheet",
    "Untitled ???? ??????"
  ],
  [
    "Sum",
    "Sum"
  ],
  [
    "Increase decimal",
    "Increase decimal"
  ],
  [
    "Decrease decimal",
    "Decrease decimal"
  ],
  [
    "Spreadsheet (Sheet)",
    "???? ?????? (????)"
  ],
  [
    "Loading presentation...",
    "???? ??????? ??? ??????"
  ],
  [
    "Untitled Presentation",
    "Untitled ??? ??????"
  ],
  [
    "Add new slide",
    "????? ???? ?????"
  ],
  [
    "New Slide",
    "???? ?????"
  ],
  [
    "Duplicate slide",
    "???? ?????"
  ],
  [
    "Delete slide",
    "??? ?????"
  ],
  [
    "Slide Title",
    "????? Title"
  ],
  [
    "Add content here",
    "????? content here"
  ],
  [
    "Slide",
    "?????"
  ],
  [
    "Presentation (Slides)",
    "??? ?????? (?????)"
  ],
  [
    "slides",
    "?????"
  ],
  [
    "First name is required.",
    "????? name is ?????"
  ],
  [
    "Last name is required.",
    "??? name is ?????"
  ],
  [
    "Enter a valid email address.",
    "???? ????? ?????? ?????????? ???????"
  ],
  [
    "Salary must be a positive number.",
    "?????? must be positive ?????"
  ],
  [
    "Manage team profiles with Customer-style visual parity",
    "Manage ?????? ??????? ?? ??????-style visual parity"
  ],
  [
    "Search employees",
    "??? ????????"
  ],
  [
    "Refreshing...",
    "?????ing..."
  ],
  [
    "Workforce",
    "????? ???????"
  ],
  [
    "Employee Directory",
    "?????? Directory"
  ],
  [
    "records",
    "???????"
  ],
  [
    "Loading employees...",
    "???? ??????? ????????..."
  ],
  [
    "No employees found.",
    "?? ???????? ?? ??????"
  ],
  [
    "Delete Employee",
    "??? ??????"
  ],
  [
    "Deleting...",
    "???? ?????..."
  ],
  [
    "Order not found",
    "????? ??? ?? ??????"
  ],
  [
    "This order is not eligible for standard Exit Permit.",
    "??? ????? is ??? ???? ?? ????? ????? ??????."
  ],
  [
    "Bypass is allowed only for Ready + Unpaid orders.",
    "Bypass is ????? ??? ?? ???? + ??? ????? ???????"
  ],
  [
    "No order selected for bypass.",
    "?? ????? ????ed ?? bypass."
  ],
  [
    "Please fill required bypass fields.",
    "???? ???? ????? bypass fields."
  ],
  [
    "per page",
    "??? ????"
  ],
  [
    "Bypass Exit Permit",
    "Bypass ????? ??????"
  ],
  [
    "Bypassed By",
    "Bypassed ??????"
  ],
  [
    "Person Collecting the Car",
    "Person ?????? ???????"
  ],
  [
    "Enter collector name",
    "???? ??????? name"
  ],
  [
    "Collector Mobile",
    "??????? ??????"
  ],
  [
    "Enter collector mobile",
    "???? ??????? ??????"
  ],
  [
    "Bypass Reason",
    "Bypass ?????"
  ],
  [
    "Why is this order bypassed?",
    "Why is ??? ????? bypassed?"
  ],
  [
    "Bypass Note",
    "Bypass ??????"
  ],
  [
    "Add optional note",
    "????? ??????? ??????"
  ],
  [
    "Create Bypass",
    "????? Bypass"
  ],
  [
    "Bypass",
    "Bypass"
  ],
  [
    "Document",
    "?????"
  ],
  [
    "Services Summary",
    "???? ???????"
  ],
  [
    "Permit Mode",
    "Permit ?????"
  ],
  [
    "Migrated legacy department drives:",
    "Migrated legacy ????? ???????:"
  ],
  [
    "Failed to load drive data.",
    "??? ?? load ??????? data."
  ],
  [
    "Unlimited",
    "??? ?????"
  ],
  [
    "Managers",
    "????????"
  ],
  [
    "This action requires a department drive manager approval.",
    "??? ??????? ????? ????? ??????? ?????? approval."
  ],
  [
    "Request submitted to managers.",
    "??? submitted ??? ????????"
  ],
  [
    "Failed to submit approval request.",
    "??? ?? ????? approval ???"
  ],
  [
    "Cannot execute move. The original file(s) could not be found.",
    "Cannot ????? ??? ?????? ???(s) could ??? be ?? ??????"
  ],
  [
    "Cannot execute delete. The target file no longer exists.",
    "Cannot ????? ??? ????? ??? ?? ??? ???? ?????"
  ],
  [
    "Cannot execute folder creation. Folder name is missing.",
    "Cannot ????? ???? creation. ???? name is ?????"
  ],
  [
    "Upload approvals cannot be auto-executed because file data is not stored in the request.",
    "??? approvals cannot be auto-executed because ??? data is ??? stored ?? ???"
  ],
  [
    "Unsupported approval action.",
    "??? ????? approval ???????"
  ],
  [
    "Approval saved, but execution failed. See row badge for details.",
    "Approval ?? ?????, but execution ??? See ?? badge ?? ????????"
  ],
  [
    "Approved request executed successfully.",
    "????? ??? executed ?????"
  ],
  [
    "Approval queue updated.",
    "Approval queue ?? ???????"
  ],
  [
    "Failed to update approval request.",
    "??? ?? ????? approval ???"
  ],
  [
    "Root",
    "?????"
  ],
  [
    "Upload and create",
    "??? ? ?????"
  ],
  [
    "Sharing and links",
    "?????? ? ?????"
  ],
  [
    "Version history",
    "Version ?????"
  ],
  [
    "Quota governance",
    "Quota ???????"
  ],
  [
    "Analytics and oversight",
    "Analytics ? oversight"
  ],
  [
    "Cross-department access",
    "Cross-????? ??????"
  ],
  [
    "Upload",
    "???"
  ],
  [
    "Move",
    "???"
  ],
  [
    "Create Folder",
    "????? ????"
  ],
  [
    "Unknown",
    "??? ?????"
  ],
  [
    "Executed",
    "Executed"
  ],
  [
    "Action completed successfully",
    "??????? ????? ?????"
  ],
  [
    "Rejected",
    "?????"
  ],
  [
    "Rejected by manager",
    "????? ?????? ??????"
  ],
  [
    "Cancelled by requester",
    "???? ?????? requester"
  ],
  [
    "You do not have write permission in the target folder.",
    "??? do ??? have ????? ???????? ?? ????? ????"
  ],
  [
    "One or more selected items cannot be moved due to permission restrictions.",
    "???? ?? ?????? ????ed ??????? cannot be moved due ??? ???????? restrictions."
  ],
  [
    "You do not have permission to upload files.",
    "??? do ??? have ???????? ??? ??? ?????"
  ],
  [
    "You do not have permission to create folders.",
    "??? do ??? have ???????? ??? ????? ??????"
  ],
  [
    "You do not have write permission in this folder.",
    "??? do ??? have ????? ???????? ?? ??? ????"
  ],
  [
    "Please enter a valid folder name.",
    "???? ???? ????? ???? name."
  ],
  [
    "Failed to create folder.",
    "??? ?? ????? ????"
  ],
  [
    "Please select a file first.",
    "???? ???? ??? ?????"
  ],
  [
    "Your upload permission is blocked by drive administrator.",
    "????? ?? ??? ???????? is ????? ?????? ??????? administrator."
  ],
  [
    "Max upload size is",
    "???? ?????? ??? ????? is"
  ],
  [
    "Upload exceeds your allocated storage quota.",
    "??? exceeds ????? ?? allocated ??????? quota."
  ],
  [
    "Failed to upload file.",
    "??? ?? ??? ???"
  ],
  [
    "Upload completed.",
    "??? ?????"
  ],
  [
    "Failed to convert this file to a native Office format.",
    "??? ?? convert ??? ??? ??? native Office format."
  ],
  [
    "Unable to launch desktop Office app for this file.",
    "???? launch desktop Office app ?? ??? ???"
  ],
  [
    "You do not have permission to create files.",
    "??? do ??? have ???????? ??? ????? ?????"
  ],
  [
    "Failed to create file.",
    "??? ?? ????? ???"
  ],
  [
    "You do not have permission to upload a new version for this file.",
    "??? do ??? have ???????? ??? ??? ???? version ?? ??? ???"
  ],
  [
    "Failed to upload new version.",
    "??? ?? ??? ???? version."
  ],
  [
    "You do not have permission to restore versions.",
    "??? do ??? have ???????? ??? ??????? versions."
  ],
  [
    "Failed to restore selected version.",
    "??? ?? ??????? ????ed version."
  ],
  [
    "You do not have permission to create shared links.",
    "??? do ??? have ???????? ??? ????? ????? ?????"
  ],
  [
    "Shared links are supported for files only.",
    "????? ????? are ????? ?? ????? ???"
  ],
  [
    "Shared link created, but resolver URL is missing.",
    "????? ???? ?? ???????, but resolver URL is ?????"
  ],
  [
    "Shared link created.",
    "????? ???? ?? ???????"
  ],
  [
    "Failed to create shared link.",
    "??? ?? ????? ????? ????"
  ],
  [
    "You do not have permission to revoke shared links.",
    "??? do ??? have ???????? ??? ????? ????? ?????"
  ],
  [
    "Failed to revoke shared link.",
    "??? ?? ????? ????? ????"
  ],
  [
    "Preview is not available for this file.",
    "?????? is ??? ???? ?? ??? ???"
  ],
  [
    "Failed to download file.",
    "??? ?? ????? ???"
  ],
  [
    "You do not have permission to move files.",
    "??? do ??? have ???????? ??? ??? ?????"
  ],
  [
    "You do not have update permission for this item.",
    "??? do ??? have ????? ???????? ?? ??? ????"
  ],
  [
    "Move to folder path (empty for root):",
    "??? ??? ???? path (???? ?? ?????):"
  ],
  [
    "Failed to move file.",
    "??? ?? ??? ???"
  ],
  [
    "You do not have permission to delete this item.",
    "??? do ??? have ???????? ??? ??? ??? ????"
  ],
  [
    "Failed to delete item.",
    "??? ?? ??? ????"
  ],
  [
    "You do not have permission to restore files.",
    "??? do ??? have ???????? ??? ??????? ?????"
  ],
  [
    "Failed to restore file.",
    "??? ?? ??????? ???"
  ],
  [
    "You do not have permission to manage storage quotas.",
    "??? do ??? have ???????? ??? manage ??????? quotas."
  ],
  [
    "Please choose a user.",
    "???? ?????? ????????"
  ],
  [
    "Quota write verification failed. Please retry.",
    "Quota ????? verification ??? ???? ????? ????????"
  ],
  [
    "Storage quota updated.",
    "??????? quota ?? ???????"
  ],
  [
    "Failed to update storage quota.",
    "??? ?? ????? ??????? quota."
  ],
  [
    "You do not have permission to manage department drives.",
    "??? do ??? have ???????? ??? manage ????? drives."
  ],
  [
    "Please choose a department.",
    "???? ?????? ?????."
  ],
  [
    "Department drive saved.",
    "????? ??????? ?? ?????"
  ],
  [
    "Failed to save department drive.",
    "??? ?? ??? ????? ???????"
  ],
  [
    "Selected user was not found in the directory.",
    "????ed ???????? was ??? ?? ?????? ?? directory."
  ],
  [
    "You do not have permission to share this item.",
    "??? do ??? have ???????? ??? share ??? ????"
  ],
  [
    "You do not have permission to update sharing on this item.",
    "??? do ??? have ???????? ??? ????? ?????? ??? ??? ????"
  ],
  [
    "Sharing permissions updated.",
    "?????? ????????? ?? ???????"
  ],
  [
    "Failed to update sharing permissions.",
    "??? ?? ????? ?????? ?????????."
  ],
  [
    "You do not have permission to rename this item.",
    "??? do ??? have ???????? ??? ????? ????? ??? ????"
  ],
  [
    "Please enter a valid file or folder name.",
    "???? ???? ????? ??? ?? ???? name."
  ],
  [
    "Failed to rename item.",
    "??? ?? ????? ????? ????"
  ],
  [
    "Move selected items to folder path (empty for root):",
    "??? ????ed ??????? ??? ???? path (???? ?? ?????):"
  ],
  [
    "Failed to move selected items.",
    "??? ?? ??? ????ed ???????"
  ],
  [
    "Failed to move dragged items.",
    "??? ?? ??? dragged ???????"
  ],
  [
    "Failed to reorder dragged items.",
    "??? ?? reorder dragged ???????"
  ],
  [
    "You do not have permission to delete selected items.",
    "??? do ??? have ???????? ??? ??? ????ed ???????"
  ],
  [
    "Failed to delete selected items.",
    "??? ?? ??? ????ed ???????"
  ],
  [
    "Failed to update starred items.",
    "??? ?? ????? starred ???????"
  ],
  [
    "Select at least one file to create shared links.",
    "???? at ????? ???? ??? ??? ????? ????? ?????"
  ],
  [
    "Shared links created and copied.",
    "????? ????? ?? ??????? ? ?? ?????"
  ],
  [
    "Shared links created.",
    "????? ????? ?? ???????"
  ],
  [
    "Failed to create shared links for selected files.",
    "??? ?? ????? ????? ????? ?? ????ed ?????"
  ],
  [
    "No access",
    "?? ???? ????"
  ],
  [
    "&#x2715;",
    "&#x2715;"
  ],
  [
    "Opening in Microsoft Word",
    "Opening ?? Microsoft Word"
  ],
  [
    "Opening in Microsoft Excel",
    "Opening ?? Microsoft Excel"
  ],
  [
    "This document will open in Microsoft Word on your computer.",
    "??? ????? will ??? ?? Microsoft Word ??? ????? ?? computer."
  ],
  [
    "This spreadsheet will open in Microsoft Excel on your computer.",
    "??? ???? ?????? will ??? ?? Microsoft Excel ??? ????? ?? computer."
  ],
  [
    "Open in Word",
    "??? ?? Word"
  ],
  [
    "Open in Excel",
    "??? ?? Excel"
  ],
  [
    "Share",
    "Share"
  ],
  [
    "Untitled",
    "Untitled"
  ],
  [
    "Add people, groups, spaces",
    "????? people, groups, ????????"
  ],
  [
    "People with access",
    "People ?? ??????"
  ],
  [
    "No explicit users yet. Add users above.",
    "?? explicit ?????????? yet. ????? ?????????? above."
  ],
  [
    "Read",
    "?????"
  ],
  [
    "Write",
    "?????"
  ],
  [
    "Remove",
    "?????"
  ],
  [
    "General access",
    "General ??????"
  ],
  [
    "Restricted",
    "Restricted"
  ],
  [
    "Department",
    "?????"
  ],
  [
    "Organization",
    "???????"
  ],
  [
    "Saving sharing permissions...",
    "???? ????? ?????? ?????????..."
  ],
  [
    "Search in Drive",
    "??? ?? ???????"
  ],
  [
    "Folder",
    "????"
  ],
  [
    "Admin console",
    "??????? ???? ??????"
  ],
  [
    "Upload, organize, share, and govern files from one workspace while keeping quota and permission control in admin hands.",
    "???, organize, share, ? govern ????? ?? ???? ????? ????? ????? keeping quota ? ???????? control ?? ??????? hands."
  ],
  [
    "items",
    "???????"
  ],
  [
    "active links",
    "??? ?????"
  ],
  [
    "Grid",
    "Grid"
  ],
  [
    "List",
    "?????"
  ],
  [
    "Custom order",
    "Custom ?????"
  ],
  [
    "Last modified",
    "??? modified"
  ],
  [
    "Name",
    "Name"
  ],
  [
    "Size",
    "?????"
  ],
  [
    "My storage",
    "My ???????"
  ],
  [
    "Uploads are currently blocked for your account.",
    "???s are currently ????? ?? ????? ?? account."
  ],
  [
    "New",
    "????"
  ],
  [
    "New folder",
    "???? ????"
  ],
  [
    "File upload",
    "??? ???"
  ],
  [
    "Folder upload",
    "???? ???"
  ],
  [
    "Docs",
    "?????"
  ],
  [
    "Sheets",
    "????"
  ],
  [
    "Slides",
    "?????"
  ],
  [
    "Forms",
    "???????"
  ],
  [
    "Home",
    "Home"
  ],
  [
    "My Drive",
    "My ???????"
  ],
  [
    "Shared with me",
    "????? ?? me"
  ],
  [
    "Recent",
    "????"
  ],
  [
    "Starred",
    "Starred"
  ],
  [
    "Trash",
    "????????"
  ],
  [
    "Drive Admin",
    "??????? ???????"
  ],
  [
    "Workspaces",
    "????? ?????"
  ],
  [
    "Department Drive",
    "????? ???????"
  ],
  [
    "Folders",
    "??????"
  ],
  [
    "Drive Workspace",
    "??????? ????? ?????"
  ],
  [
    "Welcome to Drive",
    "Welcome ??? ???????"
  ],
  [
    "Find your recent and suggested content quickly.",
    "Find ????? ?? ???? ? suggested content quickly."
  ],
  [
    "Files, folders, sharing, versioning, and governance in one place.",
    "?????, ??????, ??????, versioning, ? ??????? ?? ???? place."
  ],
  [
    "Active items",
    "??? ???????"
  ],
  [
    "My usage",
    "My usage"
  ],
  [
    "My quota",
    "My quota"
  ],
  [
    "Quick access",
    "???? ??????"
  ],
  [
    "Recent files and folders ready to open",
    "???? ????? ? ?????? ???? ??? ???"
  ],
  [
    "Items from other users you can open now",
    "??????? ?? other ?????????? ??? can ??? now"
  ],
  [
    "Department spaces",
    "????? ????????"
  ],
  [
    "Shared team areas available in your workspace",
    "????? ?????? areas ???? ?? ????? ?? ????? ?????"
  ],
  [
    "Active links",
    "??? ?????"
  ],
  [
    "External shares currently live",
    "External shares currently live"
  ],
  [
    "Moving selected items...",
    "Moving ????ed ???????"
  ],
  [
    "Sharing selected items...",
    "?????? ????ed ???????"
  ],
  [
    "Updating stars...",
    "???? ??????? stars..."
  ],
  [
    "Star",
    "Star"
  ],
  [
    "Deleting selected items...",
    "???? ????? ????ed ???????"
  ],
  [
    "Create folder",
    "????? ????"
  ],
  [
    "Upload to Drive",
    "??? ??? ???????"
  ],
  [
    "Drop files here or click to upload",
    "Drop ????? here ?? click ??? ???"
  ],
  [
    "Max",
    "???? ??????"
  ],
  [
    "per file",
    "??? ???"
  ],
  [
    "Display name (optional)",
    "Display name (???????)"
  ],
  [
    "Description (optional)",
    "Description (???????)"
  ],
  [
    "Private",
    "Private"
  ],
  [
    "Selected users",
    "????ed ??????????"
  ],
  [
    "Selected departments",
    "????ed ???????"
  ],
  [
    "New folder name",
    "???? ???? name"
  ],
  [
    "Add files",
    "????? ?????"
  ],
  [
    "Add folder",
    "????? ????"
  ],
  [
    "Uploading...",
    "Up???? ???????..."
  ],
  [
    "No quick access items yet",
    "?? ???? ?????? ??????? yet"
  ],
  [
    "Suggested folders",
    "Suggested ??????"
  ],
  [
    "No folders to suggest yet",
    "?? ?????? ??? suggest yet"
  ],
  [
    "Suggested files",
    "Suggested ?????"
  ],
  [
    "No recent files yet",
    "?? ???? ????? yet"
  ],
  [
    "folders",
    "??????"
  ],
  [
    "files",
    "?????"
  ],
  [
    "Open workspace",
    "??? ????? ?????"
  ],
  [
    "No department spaces available yet",
    "?? ????? ???????? ???? yet"
  ],
  [
    "Drive items",
    "??????? ???????"
  ],
  [
    "No items found",
    "?? ??????? ?? ??????"
  ],
  [
    "Owner / visibility",
    "Owner / visibility"
  ],
  [
    "No department",
    "?? ?????"
  ],
  [
    "Open",
    "???"
  ],
  [
    "More actions",
    "?????? ???????"
  ],
  [
    "More",
    "??????"
  ],
  [
    "Folder download can be exported from admin tools.",
    "???? ????? can be ?????ed ?? ??????? tools."
  ],
  [
    "Open folder",
    "??? ????"
  ],
  [
    "Upload in folder",
    "??? ?? ????"
  ],
  [
    "Create subfolder",
    "????? subfolder"
  ],
  [
    "Rename",
    "????? ?????"
  ],
  [
    "Organize",
    "Organize"
  ],
  [
    "Folder information",
    "???? ???????"
  ],
  [
    "Ask Gemini integration will be enabled for this workspace.",
    "??? Gemini integration will be ?????? ?? ??? ????? ?????"
  ],
  [
    "Ask Gemini",
    "??? Gemini"
  ],
  [
    "Links",
    "?????"
  ],
  [
    "Versions",
    "Versions"
  ],
  [
    "Upload version",
    "??? version"
  ],
  [
    "Restore",
    "???????"
  ],
  [
    "Delete folder",
    "??? ????"
  ],
  [
    "Move to trash",
    "??? ??? ????????"
  ],
  [
    "Shared links",
    "????? ?????"
  ],
  [
    "Expiry hours",
    "Expiry hours"
  ],
  [
    "Max downloads (optional)",
    "???? ?????? ?????s (???????)"
  ],
  [
    "Generate",
    "Generate"
  ],
  [
    "Revoked",
    "Revoked"
  ],
  [
    "Expired",
    "Expired"
  ],
  [
    "Expires",
    "Expires"
  ],
  [
    "Link copied",
    "???? ?? ?????"
  ],
  [
    "Unable to copy this shared link.",
    "???? ??? ??? ????? ????"
  ],
  [
    "Copy",
    "???"
  ],
  [
    "Revoke",
    "?????"
  ],
  [
    "No saved versions yet",
    "?? ?? ????? versions yet"
  ],
  [
    "Total storage",
    "???????? ???????"
  ],
  [
    "Across all visible owners",
    "Across ?? ???? owners"
  ],
  [
    "Users near quota",
    "?????????? near quota"
  ],
  [
    "Above 85% of their allocation",
    "Above 85% ?? their allocation"
  ],
  [
    "Blocked uploads",
    "????? ???s"
  ],
  [
    "Accounts currently prevented from uploading",
    "Accounts currently prevented ?? up???? ???????"
  ],
  [
    "Pending approvals",
    "??? ???????? approvals"
  ],
  [
    "Manager decisions waiting in queue",
    "?????? decisions ?????? ?? queue"
  ],
  [
    "Live shared links",
    "Live ????? ?????"
  ],
  [
    "External sharing links still active",
    "External ?????? ????? still ???"
  ],
  [
    "Storage governance",
    "??????? ???????"
  ],
  [
    "Allocate storage, block uploads, and watch usage before departments hit capacity.",
    "Allocate ???????, block ???s, ? watch usage ??? ??????? hit capacity."
  ],
  [
    "Quota target",
    "Quota ?????"
  ],
  [
    "Default policy",
    "Default ?????"
  ],
  [
    "Quota GB",
    "Quota GB"
  ],
  [
    "Block uploads",
    "Block ???s"
  ],
  [
    "Admin notes",
    "??????? ???????"
  ],
  [
    "Save quota policy",
    "??? quota ?????"
  ],
  [
    "Hide advanced",
    "Hide ?????"
  ],
  [
    "Show advanced",
    "Show ?????"
  ],
  [
    "Advanced controls are hidden to keep this page easy to manage. Use Show advanced when needed.",
    "????? controls are hidden ??? keep ??? ???? easy ??? manage. Use Show ????? when needed."
  ],
  [
    "Department drives",
    "????? ???????"
  ],
  [
    "Select department",
    "???? ?????"
  ],
  [
    "Drive name",
    "??????? name"
  ],
  [
    "Drive description",
    "??????? description"
  ],
  [
    "Add manager",
    "????? ??????"
  ],
  [
    "Upload bypass MB",
    "??? bypass MB"
  ],
  [
    "Require manager approval for uploads",
    "????? ?????? approval ?? ???s"
  ],
  [
    "Require manager approval for moves",
    "????? ?????? approval ?? ???"
  ],
  [
    "Require manager approval for deletes",
    "????? ?????? approval ?? ???"
  ],
  [
    "Require manager approval for folder creation",
    "????? ?????? approval ?? ???? creation"
  ],
  [
    "Save department drive",
    "??? ????? ???????"
  ],
  [
    "Admin capabilities",
    "??????? capabilities"
  ],
  [
    "Enabled",
    "??????"
  ],
  [
    "Disabled",
    "Disabled"
  ],
  [
    "Detailed role permissions remain controlled from Roles & Policies Admin, while this console focuses on storage governance and operational oversight.",
    "Detailed ????? ????????? remain controlled ?? ??????? & ???????? ???????, ????? ??? ???? ?????? focuses ??? ??????? ??????? ? operational oversight."
  ],
  [
    "Usage matrix",
    "Usage matrix"
  ],
  [
    "Usage trends (14 days)",
    "Usage trends (14 ????)"
  ],
  [
    "Uploads",
    "???s"
  ],
  [
    "Downloads",
    "?????s"
  ],
  [
    "Deletes",
    "???"
  ],
  [
    "No file activity in the last 14 days",
    "?? ??? ?????? ?? ??? 14 ????"
  ],
  [
    "Alert center",
    "Alert center"
  ],
  [
    "Approval queue and execution status",
    "Approval queue ? execution ??????"
  ],
  [
    "Approving and executing request...",
    "???? ???????? ? executing ???"
  ],
  [
    "Approve & Execute",
    "?????? & ?????"
  ],
  [
    "Approving request...",
    "???? ???????? ???"
  ],
  [
    "Approve",
    "??????"
  ],
  [
    "Rejecting request...",
    "Rejecting ???"
  ],
  [
    "Reject",
    "???"
  ],
  [
    "Cancelling request...",
    "Cancelling ???"
  ],
  [
    "No approval requests yet",
    "?? approval ????? yet"
  ],
  [
    "Department quotas",
    "????? quotas"
  ],
  [
    "User quota overrides",
    "???????? quota overrides"
  ],
  [
    "Override",
    "Override"
  ],
  [
    "Set",
    "Set"
  ],
  [
    "Active shared links",
    "??? ????? ?????"
  ],
  [
    "No active shared links right now",
    "?? ??? ????? ????? right now"
  ],
  [
    "Open / Preview",
    "??? / ??????"
  ],
  [
    "Create link",
    "????? ????"
  ],
  [
    "Config saved successfully",
    "Config ?? ????? ?????"
  ],
  [
    "Key:",
    "???????:"
  ],
  [
    "default",
    "default"
  ],
  [
    "Version:",
    "Version:"
  ],
  [
    "Inspection Config Admin",
    "????? Config ???????"
  ],
  [
    "Validate JSON",
    "Validate JSON"
  ],
  [
    "Active record:",
    "??? ???:"
  ],
  [
    "Updated By:",
    "?? ??????? ??????:"
  ],
  [
    "• Updated At:",
    "• ?? ??????? At:"
  ],
  [
    "JSON Error:",
    "JSON ???:"
  ],
  [
    "Exterior",
    "???????"
  ],
  [
    "Interior",
    "???????"
  ],
  [
    "Complete Inspection",
    "Complete ?????"
  ],
  [
    "Finish Inspection",
    "????? ?????"
  ],
  [
    "Download failed:",
    "????? ???:"
  ],
  [
    "Search by any inspection details",
    "???? ??? ?? ????? ????????"
  ],
  [
    "Track incoming inspections, move active vehicles forward, and keep the queue review-ready.",
    "Track incoming ?????, ??? ??? ???????? forward, ? keep queue review-ready."
  ],
  [
    "Working...",
    "???? ?????"
  ],
  [
    "Paused",
    "Paused"
  ],
  [
    "Save & Pause",
    "??? & Pause"
  ],
  [
    "Resume",
    "Resume"
  ],
  [
    "Not Required",
    "??? ?????"
  ],
  [
    "Progress:",
    "??????:"
  ],
  [
    "Sending message...",
    "Sending message..."
  ],
  [
    "Refreshing conversation...",
    "?????ing conversation..."
  ],
  [
    "Enter a valid serial range. Start and end serials must share the same prefix and differ only in the last three digits.",
    "???? ????? ????? ???????? ?????? ??? ? end ????? ???????? must share same prefix ? differ ??? ?? ??? three digits."
  ],
  [
    "Added serial range",
    "Added ????? ???????? ??????"
  ],
  [
    "for",
    "??"
  ],
  [
    "Quick add failed",
    "???? ????? ???"
  ],
  [
    "Quantity must be at least 1.",
    "?????? must be at ????? 1."
  ],
  [
    "Inventory Management",
    "??????? ???????"
  ],
  [
    "Manage inventory structure, stock, and checkout with Customer-style visual parity",
    "Manage ??????? ??????, stock, ? checkout ?? ??????-style visual parity"
  ],
  [
    "Quantity",
    "??????"
  ],
  [
    "By",
    "??????"
  ],
  [
    "Checkout",
    "Checkout"
  ],
  [
    "Description",
    "Description"
  ],
  [
    "Edit Subcategory",
    "Edit ????? ???????"
  ],
  [
    "Create Subcategory",
    "????? ????? ???????"
  ],
  [
    "Number",
    "?????"
  ],
  [
    "Product name",
    "?????? name"
  ],
  [
    "Quantity to Add",
    "?????? ??? ?????"
  ],
  [
    "Quantity is automatically calculated from the serial range.",
    "?????? is automatically calculated ?? ????? ???????? ??????"
  ],
  [
    "You can add multiple units at once (e.g. 100).",
    "??? can ????? multiple units at ????? (????: 100)."
  ],
  [
    "First Serial Number",
    "????? ????? ???????? ?????"
  ],
  [
    "Optional serial or range start",
    "??????? ????? ???????? ?? ?????? ???"
  ],
  [
    "Last Serial Number",
    "??? ????? ???????? ?????"
  ],
  [
    "Optional range end",
    "??????? ?????? end"
  ],
  [
    "Barcode / QR",
    "???????? / QR"
  ],
  [
    "Range rule",
    "?????? rule"
  ],
  [
    "If you enter both first and last serials, products will be created by incrementing the last three digits.",
    "If ??? ???? both ????? ? ??? ????? ????????, ???????? will be ?? ??????? ?????? incrementing ??? three digits."
  ],
  [
    "— Select —",
    "— ???? —"
  ],
  [
    "Yes",
    "Yes"
  ],
  [
    "No",
    "??"
  ],
  [
    "Any additional notes…",
    "?? additional ???????…"
  ],
  [
    "Scan or Enter Serial / Barcode",
    "Scan ?? ???? ????? ???????? / ????????"
  ],
  [
    "Use a USB barcode scanner or type the code manually. Press Enter to add each item.",
    "Use USB ???????? scanner ?? ??? ????? manually. Press ???? ??? ????? each ????"
  ],
  [
    "Scan or type serial / barcode…",
    "Scan ?? ??? ????? ???????? / ????????…"
  ],
  [
    "item",
    "????"
  ],
  [
    "scanned — add a product name (optional):",
    "scanned — ????? ?????? name (???????):"
  ],
  [
    "Product name (optional)",
    "?????? name (???????)"
  ],
  [
    "Adding…",
    "Adding…"
  ],
  [
    "Unit",
    "Unit"
  ],
  [
    "Processing…",
    "Processing…"
  ],
  [
    "Scanned Item",
    "Scanned ????"
  ],
  [
    "Receipt generation failed",
    "Receipt generation ???"
  ],
  [
    "Loading job cards...",
    "???? ??????? ?????? ?????..."
  ],
  [
    "Saving services...",
    "???? ????? ???????"
  ],
  [
    "Add services failed",
    "????? ??????? ???"
  ],
  [
    "Cancel failed",
    "????? ???"
  ],
  [
    "Order not found in the current list. Please refresh and try again.",
    "????? ??? ?? ?????? ?? ?????? ????? ???? ????? ? try again."
  ],
  [
    "Already cancelled",
    "?????? ????"
  ],
  [
    "Job Order",
    "??? ?????"
  ],
  [
    "is already cancelled.",
    "is ?????? ????"
  ],
  [
    "Create job order failed",
    "????? ??? ????? ???"
  ],
  [
    "Order Created",
    "????? ?? ???????"
  ],
  [
    "Your action was successful",
    "????? ?? ??????? was successful"
  ],
  [
    "Your job order has been created successfully",
    "????? ?? ??? ????? has been ?? ??????? ?????"
  ],
  [
    "Order Marked as Cancelled",
    "????? Marked ?? ????"
  ],
  [
    "Job Order ID",
    "??? ????? ID"
  ],
  [
    "Successfully Created",
    "????? ?? ???????"
  ],
  [
    "Your order has been added to the system and is ready for processing.",
    "????? ?? ????? has been added ??? system ? is ???? ?? processing."
  ],
  [
    "Print Receipt",
    "????? Receipt"
  ],
  [
    "Services Added",
    "??????? Added"
  ],
  [
    "Services have been added to the job order",
    "??????? have been added ??? ??? ?????"
  ],
  [
    "Services Added Successfully",
    "??????? Added ?????"
  ],
  [
    "Order ID",
    "????? ID"
  ],
  [
    "Invoice ID",
    "???????? ID"
  ],
  [
    "Unknown error",
    "??? ????? ???"
  ],
  [
    "Search by any job order details",
    "???? ??? ?? ??? ????? ????????"
  ],
  [
    "Add New Job Order",
    "????? ???? ??? ?????"
  ],
  [
    "Loading job orders...",
    "???? ??????? ??? ?????s..."
  ],
  [
    "Back to Job Cards",
    "Back ??? ?????? ?????"
  ],
  [
    "Print",
    "?????"
  ],
  [
    "Generated",
    "?? ???????"
  ],
  [
    "Creating Job Order",
    "???? ??????? ??? ?????"
  ],
  [
    "Please wait while we process your order",
    "???? wait ????? ??? process ????? ?? ?????"
  ],
  [
    "Select...",
    "????..."
  ],
  [
    "Save Customer",
    "??? ??????"
  ],
  [
    "License Plate",
    "License ??????"
  ],
  [
    "Select from previously completed services for this vehicle",
    "???? ?? previously ????? ??????? ?? ??? ???????"
  ],
  [
    "Completed Job Orders for this Vehicle",
    "????? ??? ?????s ?? ??? ???????"
  ],
  [
    "Services from the selected completed order are included for free (QAR 0)",
    "??????? ?? ????ed ????? ????? are ??????? ?? free (QAR 0)"
  ],
  [
    "Specification required",
    "???????? ?????"
  ],
  [
    "Previously completed",
    "Previously ?????"
  ],
  [
    "QAR 0",
    "QAR 0"
  ],
  [
    "Add Other Paid Services",
    "????? Other ????? ???????"
  ],
  [
    "Packages & Services:",
    "??????? & ???????:"
  ],
  [
    "Back to Job Order",
    "Back ??? ??? ?????"
  ],
  [
    "Submit Order",
    "????? ?????"
  ],
  [
    "Action",
    "???????"
  ],
  [
    "Acceptable",
    "Acceptable"
  ],
  [
    "Result",
    "???????"
  ],
  [
    "Expected Date",
    "????? ???????"
  ],
  [
    "Expected Time",
    "????? ?????"
  ],
  [
    "Estimated Duration",
    "Estimated ?????"
  ],
  [
    "Step",
    "Step"
  ],
  [
    "History Details",
    "????? ????????"
  ],
  [
    "One-time Package Repair Completed",
    "One-time ?????? Repair ?????"
  ],
  [
    "Scanned",
    "Scanned"
  ],
  [
    "records. Repaired",
    "??????? Repaired"
  ],
  [
    ". Failed",
    ". ???"
  ],
  [
    "Loading payment details...",
    "???? ??????? ????? ????????"
  ],
  [
    "Saving payment...",
    "???? ????? ?????"
  ],
  [
    "Please enter a valid refund amount.",
    "???? ???? ????? ??????? ??????"
  ],
  [
    "Refund could not be fully applied (insufficient payments).",
    "??????? could ??? be fully applied (insufficient ?????????)."
  ],
  [
    "batches",
    "batches"
  ],
  [
    "Max batch:",
    "???? ?????? ????:"
  ],
  [
    "📥",
    "📥"
  ],
  [
    "📤",
    "📤"
  ],
  [
    "📬",
    "📬"
  ],
  [
    "Confirm SMS send",
    "Confirm SMS ?????"
  ],
  [
    "Retry Failed SMS",
    "????? ???????? ??? SMS"
  ],
  [
    "Confirm SMS Send",
    "Confirm SMS ?????"
  ],
  [
    "recipient(s)",
    "recipient(s)"
  ],
  [
    "Retry now",
    "????? ???????? now"
  ],
  [
    "Send now",
    "????? now"
  ],
  [
    "You don’t have permission to approve or reject Quality Check.",
    "??? don’t have ???????? ??? ?????? ?? ??? ??? ??????."
  ],
  [
    "Returned to Service Execution",
    "Returned ??? ????? ??????"
  ],
  [
    "quality check jobs",
    "??? ?????? ???????"
  ],
  [
    "Quality Check Details",
    "??? ?????? ????????"
  ],
  [
    "Only completed services are shown",
    "??? ????? ??????? are shown"
  ],
  [
    "No completed services to evaluate",
    "?? ????? ??????? ??? evaluate"
  ],
  [
    "Finish",
    "?????"
  ],
  [
    "Quality Check Evaluation Complete. Please select an action:",
    "??? ?????? Evaluation Complete. ???? ???? ???????:"
  ],
  [
    "Approve Quality Check",
    "?????? ??? ??????"
  ],
  [
    "Approving quality check...",
    "???? ???????? ??? ??????..."
  ],
  [
    "Rejecting quality check...",
    "Rejecting ??? ??????..."
  ],
  [
    "Processing...",
    "Processing..."
  ],
  [
    "Reject Quality Check",
    "??? ??? ??????"
  ],
  [
    "Loading quotation services...",
    "???? ??????? quotation ???????"
  ],
  [
    "Failed to open quotation from history.",
    "??? ?? ??? quotation ?? ?????"
  ],
  [
    "Failed to download quotation from history.",
    "??? ?? ????? quotation ?? ?????"
  ],
  [
    "Delete this quotation history entry?",
    "??? ??? quotation ????? entry?"
  ],
  [
    "Quotation history entry deleted.",
    "Quotation ????? entry ?????"
  ],
  [
    "Failed to delete quotation history entry.",
    "??? ?? ??? quotation ????? entry."
  ],
  [
    "Quotation generated but history record failed to save.",
    "Quotation ?? ??????? but ????? ??? ??? ?? ???"
  ],
  [
    "View Quotation History",
    "??? Quotation ?????"
  ],
  [
    "Quotation History",
    "Quotation ?????"
  ],
  [
    "Search quotations...",
    "??? quotations..."
  ],
  [
    "Date from",
    "??????? ??"
  ],
  [
    "Date to",
    "??????? ???"
  ],
  [
    "Loading quotation history...",
    "???? ??????? quotation ?????"
  ],
  [
    "No quotations found yet.",
    "?? quotations ?? ?????? yet."
  ],
  [
    "Click to open quotation",
    "Click ??? ??? quotation"
  ],
  [
    "Service Category",
    "?????? ?????"
  ],
  [
    "Search Services",
    "??? ???????"
  ],
  [
    "Type service name or code",
    "??? ?????? name ?? ?????"
  ],
  [
    "Clear search",
    "??? ???"
  ],
  [
    "No services match this filter/search.",
    "?? ??????? ?????? ??? ????/???"
  ],
  [
    "Discount Amount",
    "????? ??????"
  ],
  [
    "Service / Package",
    "?????? / ??????"
  ],
  [
    "Included services are listed below without prices.",
    "??????? ??????? are listed below ???? prices."
  ],
  [
    "Generating PDF…",
    "???? ??????? PDF…"
  ],
  [
    "Create New Role",
    "????? ???? ?????"
  ],
  [
    "Policies saved successfully",
    "???????? ?? ????? ?????"
  ],
  [
    "Roles:",
    "???????:"
  ],
  [
    "Modules:",
    "Modules:"
  ],
  [
    "Active:",
    "???:"
  ],
  [
    "modules ·",
    "modules ·"
  ],
  [
    "options",
    "options"
  ],
  [
    "Resetting changes...",
    "Resetting changes..."
  ],
  [
    "Saving role policies...",
    "???? ????? ????? ????????"
  ],
  [
    "Creating role...",
    "???? ??????? ?????..."
  ],
  [
    "Only admins can run the processor manually.",
    "??? ??????? can run processor manually."
  ],
  [
    "Manual trigger is not available yet. Please deploy backend changes.",
    "Manual trigger is ??? ???? yet. ???? deploy backend changes."
  ],
  [
    "Processor run completed.",
    "Processor run ?????"
  ],
  [
    "Due",
    "Due"
  ],
  [
    "Errors",
    "?????"
  ],
  [
    "Failed to run processor manually.",
    "??? ?? run processor manually."
  ],
  [
    "Scheduled Report",
    "????? ?????"
  ],
  [
    "Generated at",
    "?? ??????? at"
  ],
  [
    "You do not have access to view this page.",
    "??? do ??? have ?????? ??? ??? ??? ????"
  ],
  [
    "Reports & Delivery",
    "Reports & ???????"
  ],
  [
    "Build a report, keep the filters simple, and send it by email on a schedule.",
    "Build report, keep ??????? simple, ? ????? ?? ?????? ?????? ?????????? ??? ?????"
  ],
  [
    "Scheduled",
    "?????"
  ],
  [
    "Manage report filters, exports, and scheduled email delivery in one place.",
    "Manage report ???????, ?????s, ? ????? ?????? ?????????? ??????? ?? ???? place."
  ],
  [
    "Start with the model, then use the optional filters if you need to narrow the report further.",
    "??? ?? ??????, then use ??????? ??????? if ??? need ??? narrow report further."
  ],
  [
    "Advanced filters",
    "????? ???????"
  ],
  [
    "Use these only when the simple search and date range are not enough.",
    "Use ??? ??? when simple ??? ? ??????? ?????? are ??? enough."
  ],
  [
    "Choose columns",
    "?????? ???????"
  ],
  [
    "Search columns",
    "??? ???????"
  ],
  [
    "Type to filter columns",
    "??? ??? ???? ???????"
  ],
  [
    "Clear visible",
    "??? ????"
  ],
  [
    "Select all visible",
    "???? ?? ????"
  ],
  [
    "No columns match your search.",
    "?? ??????? ?????? ????? ?? ???"
  ],
  [
    "Generate PDF",
    "Generate PDF"
  ],
  [
    "The sender must be a verified SES identity in eu-west-1.",
    "sender must be verified SES identity ?? eu-west-1."
  ],
  [
    "Sender Email",
    "Sender ?????? ??????????"
  ],
  [
    "Verified SES identity",
    "Verified SES identity"
  ],
  [
    "Recipient Email",
    "Recipient ?????? ??????????"
  ],
  [
    "Format",
    "Format"
  ],
  [
    "Excel",
    "Excel"
  ],
  [
    "Days of Week",
    "???? ?? ???????"
  ],
  [
    "Last manual run at",
    "??? manual run at"
  ],
  [
    "Run scheduled processor once now",
    "Run ????? processor ????? now"
  ],
  [
    "Running...",
    "Running..."
  ],
  [
    "Run Processor Now",
    "Run Processor Now"
  ],
  [
    "Failed to load service data",
    "??? ?? load ?????? data"
  ],
  [
    "English category name is required.",
    "English ????? name is ?????"
  ],
  [
    "Arabic category name is required.",
    "Arabic ????? name is ?????"
  ],
  [
    "Please select a category.",
    "???? ???? ?????"
  ],
  [
    "Service ID is required.",
    "?????? ID is ?????"
  ],
  [
    "English service name is required.",
    "English ?????? name is ?????"
  ],
  [
    "Arabic service name is required.",
    "Arabic ?????? name is ?????"
  ],
  [
    "SUV price is required and must be valid.",
    "SUV ????? is ????? ? must be ?????"
  ],
  [
    "Sedan price is required and must be valid.",
    "????? ????? is ????? ? must be ?????"
  ],
  [
    "Package ID is required.",
    "?????? ID is ?????"
  ],
  [
    "English package name is required.",
    "English ?????? name is ?????"
  ],
  [
    "Arabic package name is required.",
    "Arabic ?????? name is ?????"
  ],
  [
    "Please include at least one service in the package.",
    "???? include at ????? ???? ?????? ?? ??????"
  ],
  [
    "Category Updated",
    "????? ?? ???????"
  ],
  [
    "Category Created",
    "????? ?? ???????"
  ],
  [
    "Selected category does not exist.",
    "????ed ????? does ??? exist."
  ],
  [
    "Service Updated",
    "?????? ?? ???????"
  ],
  [
    "Service Created Successfully",
    "?????? ?? ??????? ?????"
  ],
  [
    "The service has been added to the catalog.",
    "?????? has been added ??? ??????"
  ],
  [
    "Package Updated",
    "?????? ?? ???????"
  ],
  [
    "Package Created Successfully",
    "?????? ?? ??????? ?????"
  ],
  [
    "The package has been added to the catalog.",
    "?????? has been added ??? ??????"
  ],
  [
    "Cannot delete category that still has services. Move or delete services first.",
    "Cannot ??? ????? ??? still has ??????? ??? ?? ??? ??????? ?????"
  ],
  [
    "Cannot delete a brand specification that is still assigned to services.",
    "Cannot ??? ??????? ???????? ??? is still ?????? ??? ???????"
  ],
  [
    "Brand name is required.",
    "??????? name is ?????"
  ],
  [
    "Brand must include at least one product.",
    "??????? must include at ????? ???? ??????"
  ],
  [
    "Each product must include at least one measurement.",
    "Each ?????? must include at ????? ???? measurement."
  ],
  [
    "Specification Updated",
    "???????? ?? ???????"
  ],
  [
    "Specification Created Successfully",
    "???????? ?? ??????? ?????"
  ],
  [
    "Sedan:",
    "?????:"
  ],
  [
    "Hatchback:",
    "???????:"
  ],
  [
    "Truck:",
    "?????:"
  ],
  [
    "Coupe:",
    "?????:"
  ],
  [
    "Other:",
    "Other:"
  ],
  [
    "Loading service catalog...",
    "???? ??????? ?????? ??????"
  ],
  [
    "Services by Category",
    "??????? ?????? ?????"
  ],
  [
    "Categories",
    "??????"
  ],
  [
    "Total Services",
    "???????? ???????"
  ],
  [
    "Avg Services/Cat",
    "????? ???????/Cat"
  ],
  [
    "Loading services...",
    "???? ??????? ???????"
  ],
  [
    "No service categories found.",
    "?? ?????? ?????? ?? ??????"
  ],
  [
    "Service Packages",
    "?????? ???????"
  ],
  [
    "Add Package",
    "????? ??????"
  ],
  [
    "Total Packages",
    "???????? ???????"
  ],
  [
    "Avg SUV Price",
    "????? SUV ?????"
  ],
  [
    "Avg Sedan Price",
    "????? ????? ?????"
  ],
  [
    "Loading packages...",
    "???? ??????? ???????"
  ],
  [
    "No packages found.",
    "?? ??????? ?? ??????"
  ],
  [
    "Brand & Product Specifications",
    "??????? & ?????? ?????????"
  ],
  [
    "Add New Brand",
    "????? ???? ???????"
  ],
  [
    "Brands",
    "???????"
  ],
  [
    "Services with Specs",
    "??????? ?? Specs"
  ],
  [
    "Loading specifications...",
    "???? ??????? ?????????"
  ],
  [
    "No brand specifications available yet.",
    "?? ??????? ????????? ???? yet."
  ],
  [
    "Products & Sizes",
    "???????? & ?????"
  ],
  [
    "No products configured for this brand yet.",
    "?? ???????? configured ?? ??? ??????? yet."
  ],
  [
    "English Name *",
    "English Name *"
  ],
  [
    "English Description",
    "English Description"
  ],
  [
    "Service Category *",
    "?????? ????? *"
  ],
  [
    "Service ID *",
    "?????? ID *"
  ],
  [
    "Auto-generated if left empty",
    "Auto-generated if left ????"
  ],
  [
    "Brand Specifications",
    "??????? ?????????"
  ],
  [
    "No brand specifications available.",
    "?? ??????? ????????? ????"
  ],
  [
    "Pricing by Vehicle Type",
    "Pricing ?????? ??????? ???"
  ],
  [
    "SUV Price (QAR) *",
    "SUV ????? (QAR) *"
  ],
  [
    "Sedan Price (QAR) *",
    "????? ????? (QAR) *"
  ],
  [
    "Hatchback Price (QAR)",
    "??????? ????? (QAR)"
  ],
  [
    "Truck Price (QAR)",
    "????? ????? (QAR)"
  ],
  [
    "Coupe Price (QAR)",
    "????? ????? (QAR)"
  ],
  [
    "Other Price (QAR)",
    "Other ????? (QAR)"
  ],
  [
    "Package ID *",
    "?????? ID *"
  ],
  [
    "Package Pricing",
    "?????? Pricing"
  ],
  [
    "Select Services to Include *",
    "???? ??????? ??? Include *"
  ],
  [
    "(SUV:",
    "(SUV:"
  ],
  [
    "\\| Sedan:",
    "\\| ?????:"
  ],
  [
    "Brand Name",
    "??????? Name"
  ],
  [
    "Brand Color",
    "??????? ?????"
  ],
  [
    "Products & Measurements",
    "???????? & Measurements"
  ],
  [
    "Product Name (e.g., Ceramic Coating)",
    "?????? Name (????:, Ceramic Coating)"
  ],
  [
    "Standard",
    "?????"
  ],
  [
    "Size/Measure",
    "?????/Measure"
  ],
  [
    "Add Size/Measure",
    "????? ?????/Measure"
  ],
  [
    "Saving category...",
    "???? ????? ?????"
  ],
  [
    "Update Category",
    "????? ?????"
  ],
  [
    "Saving service...",
    "???? ????? ??????"
  ],
  [
    "Update Service",
    "????? ??????"
  ],
  [
    "Saving package...",
    "???? ????? ??????"
  ],
  [
    "Update Package",
    "????? ??????"
  ],
  [
    "Saving specification brands...",
    "???? ????? ???????? brands..."
  ],
  [
    "Save Brand",
    "??? ???????"
  ],
  [
    "Deleting item...",
    "???? ????? ????"
  ],
  [
    "Loading service details...",
    "???? ??????? ?????? ????????"
  ],
  [
    "Save failed:",
    "??? ???:"
  ],
  [
    "Added successfully",
    "Added ?????"
  ],
  [
    "Work finished! Status changed to Quality Check.",
    "Work finished! ?????? changed ??? ??? ??????."
  ],
  [
    "Unassigned tasks",
    "Unassigned ??????"
  ],
  [
    "Team tasks",
    "?????? ??????"
  ],
  [
    "Assigned to me",
    "?????? ??? me"
  ],
  [
    "Services & Work Management",
    "??????? & Work ???????"
  ],
  [
    "Track assignments, execution progress, and service operations in one place.",
    "Track assignments, execution ??????, ? ?????? ????? ?? ???? place."
  ],
  [
    "Search by Job ID, Customer, Plate...",
    "???? ??? ????? ID, ??????, ??????"
  ],
  [
    "Assign to me",
    "Assign ??? me"
  ],
  [
    "No tasks in this view",
    "?? ?????? ?? ??? ???"
  ],
  [
    "Assigned Service",
    "?????? ???????"
  ],
  [
    "No active services",
    "?? ??? ???????"
  ],
  [
    "Service Summary crashed",
    "???? ??????? crashed"
  ],
  [
    "Open DevTools Console to see the full stack.",
    "??? ????? ?????? ???? ?????? ??? see ???? stack."
  ],
  [
    "Start time",
    "??? ?????"
  ],
  [
    "End time",
    "End ?????"
  ],
  [
    "Assigned to",
    "?????? ???"
  ],
  [
    "— assign —",
    "— assign —"
  ],
  [
    "Technicians",
    "???????"
  ],
  [
    "Service responsibilities",
    "?????? responsibilities"
  ],
  [
    "No services found in Service Technicians page.",
    "?? ??????? ?? ?????? ?? ?????? ??????? ????"
  ],
  [
    "Service work status",
    "?????? work ??????"
  ],
  [
    "Service_Operation",
    "??????_?????"
  ],
  [
    "Postponed",
    "Postponed"
  ],
  [
    "Enter notes for this service",
    "???? ??????? ?? ??? ??????"
  ],
  [
    "Upload images",
    "??? ????"
  ],
  [
    "Clear selection",
    "??? ????ion"
  ],
  [
    "Selected:",
    "????ed:"
  ],
  [
    "images per service, up to",
    "???? ??? ??????, up ???"
  ],
  [
    "MB each.",
    "MB each."
  ],
  [
    "Open image",
    "??? ????"
  ],
  [
    "No images uploaded.",
    "?? ???? ???ed."
  ],
  [
    "Assigned Technicians",
    "Assigned ???????"
  ],
  [
    "No technicians assigned",
    "?? ??????? assigned"
  ],
  [
    "Add service",
    "????? ??????"
  ],
  [
    "No services assigned yet",
    "?? ??????? assigned yet"
  ],
  [
    "Saved successfully",
    "?? ????? ?????"
  ],
  [
    "No services match the selected filters.",
    "?? ??????? ?????? ????ed ???????"
  ],
  [
    "Service name",
    "?????? name"
  ],
  [
    "e.g. Wheel Protection",
    "????: Wheel Protection"
  ],
  [
    "Price (QAR)",
    "????? (QAR)"
  ],
  [
    "You have unsaved changes. Switch rows and discard current edits?",
    "??? have unsaved changes. ????? ?????? ? discard ?????? edits?"
  ],
  [
    "Search services",
    "??? ???????"
  ],
  [
    "Add Service Technicians",
    "????? ?????? ???????"
  ],
  [
    "Create and manage technician service capabilities in Arabic and English.",
    "????? ? manage ????? ?????? capabilities ?? Arabic ? English."
  ],
  [
    "Unsaved changes",
    "Unsaved changes"
  ],
  [
    "Service Name (English)",
    "?????? Name (English)"
  ],
  [
    "Service Name (Arabic)",
    "?????? Name (Arabic)"
  ],
  [
    "No service technicians found.",
    "?? ?????? ??????? ?? ??????"
  ],
  [
    "Enter service ID",
    "???? ?????? ID"
  ],
  [
    "Enter service name in English",
    "???? ?????? name ?? English"
  ],
  [
    "Enter service name in Arabic",
    "???? ?????? name ?? Arabic"
  ],
  [
    "Enter service description",
    "???? ?????? description"
  ],
  [
    "Create Service",
    "????? ??????"
  ],
  [
    "Set your password",
    "Set ????? ?? password"
  ],
  [
    "First-time setup (temp password)",
    "First-time setup (temp password)"
  ],
  [
    "Reset password (code)",
    "????? ????? ???? ?????? (?????)"
  ],
  [
    "Username",
    "Username"
  ],
  [
    "Temporary password (from email)",
    "Temporary password (?? ?????? ??????????)"
  ],
  [
    "New password",
    "???? password"
  ],
  [
    "Confirm new password",
    "Confirm ???? password"
  ],
  [
    "Email / Username",
    "?????? ?????????? / Username"
  ],
  [
    "Send reset code",
    "????? ????? ????? ?????"
  ],
  [
    "Verification code",
    "Verification ?????"
  ],
  [
    "Loading tickets...",
    "???? ??????? tickets..."
  ],
  [
    "Customer is required.",
    "?????? is ?????"
  ],
  [
    "Ticket created successfully.",
    "Ticket ?? ??????? ?????"
  ],
  [
    "Ticket updated successfully.",
    "Ticket ?? ??????? ?????"
  ],
  [
    "Failed to update ticket.",
    "??? ?? ????? ticket."
  ],
  [
    "Ticket deleted successfully.",
    "Ticket ????? ?????"
  ],
  [
    "Ticket Management",
    "Ticket ???????"
  ],
  [
    "Manage customer support tickets, ownership, priorities, and lifecycle status.",
    "Manage ?????? support tickets, ownership, priorities, ? lifecycle ??????"
  ],
  [
    "Total Tickets",
    "???????? Tickets"
  ],
  [
    "Resolved / Closed",
    "Resolved / Closed"
  ],
  [
    "Create Ticket",
    "????? Ticket"
  ],
  [
    "Use this form to register a new customer support case.",
    "Use ??? ??????? ??? register ???? ?????? support case."
  ],
  [
    "Select customer",
    "???? ??????"
  ],
  [
    "Technician or owner",
    "????? ?? owner"
  ],
  [
    "Short summary of the issue",
    "Short ???? ?? issue"
  ],
  [
    "Priority",
    "Priority"
  ],
  [
    "Describe the customer issue, expected action, and context",
    "Describe ?????? issue, ????? ???????, ? context"
  ],
  [
    "Ticket Records",
    "Ticket ???????"
  ],
  [
    "Search tickets...",
    "??? tickets..."
  ],
  [
    "All statuses",
    "?? statuses"
  ],
  [
    "No tickets found.",
    "?? tickets ?? ??????"
  ],
  [
    "No description provided.",
    "?? description provided."
  ],
  [
    "passwordMustBeAtLeast8Characters",
    "passwordMustBeAtLeast8Characters"
  ],
  [
    "passwordConfirmationDoesNotMatch",
    "passwordConfirmationDoesNotMatch"
  ],
  [
    "Please enter a valid email address.",
    "???? ???? ????? ?????? ?????????? ???????"
  ],
  [
    "A user with this email already exists.",
    "???????? ?? ??? ?????? ?????????? ?????? ?????"
  ],
  [
    "settingPrimaryPassword",
    "settingPrimaryPassword"
  ],
  [
    "failedToSetPrimaryPassword",
    "failedToSetPrimaryPassword"
  ],
  [
    "primaryPasswordUpdatedSuccessfully",
    "primaryPasswordUpdatedSuccessfully"
  ],
  [
    "≡ƒùæ",
    "≡ƒùæ"
  ],
  [
    "edit",
    "edit"
  ],
  [
    "user@example.com",
    "????????@example.com"
  ],
  [
    "Sending reset password...",
    "Sending ????? ????? ???? ??????..."
  ],
  [
    "changePrimaryPasswordForThisUser",
    "changePrimaryPasswordForThisUser"
  ],
  [
    "newPassword",
    "newPassword"
  ],
  [
    "confirmNewPassword",
    "confirmNewPassword"
  ],
  [
    "Updating password...",
    "???? ??????? password..."
  ],
  [
    "updatePrimaryPassword",
    "updatePrimaryPassword"
  ],
  [
    "Saving user changes...",
    "???? ????? ???????? changes..."
  ],
  [
    "Γëí",
    "Γëí"
  ],
  [
    "Γ£ò",
    "Γ£ò"
  ],
  [
    "Create User",
    "????? ????????"
  ],
  [
    "Loading Vehicles",
    "???? ??????? ????????"
  ],
  [
    "Missing Customer ID",
    "????? ?????? ID"
  ],
  [
    "Please enter a customer ID before verifying.",
    "???? ???? ?????? ID ??? verifying."
  ],
  [
    "Loading Vehicle",
    "???? ??????? ???????"
  ],
  [
    "Back to Vehicles",
    "Back ??? ????????"
  ],
  [
    "No related job orders found for this vehicle.",
    "?? related ??? ?????s ?? ?????? ?? ??? ???????."
  ],
  [
    "Related Services",
    "Related ???????"
  ],
  [
    "No services found for this vehicle.",
    "?? ??????? ?? ?????? ?? ??? ???????."
  ],
  [
    "Saving vehicle changes...",
    "???? ????? ??????? changes..."
  ],
  [
    "Manage vehicle information, ownership, and completed services.",
    "Manage ??????? ???????, ownership, ? ????? ???????"
  ],
  [
    "Loading vehicle details...",
    "???? ??????? ??????? ????????"
  ],
  [
    "Creating vehicle...",
    "???? ??????? ???????..."
  ],
  [
    "Deleting vehicle...",
    "???? ????? ???????..."
  ],
  [
    "Failed to open voucher from history.",
    "??? ?? ??? voucher ?? ?????"
  ],
  [
    "Failed to download voucher from history.",
    "??? ?? ????? voucher ?? ?????"
  ],
  [
    "Delete this voucher history entry?",
    "??? ??? voucher ????? entry?"
  ],
  [
    "Voucher history entry deleted.",
    "Voucher ????? entry ?????"
  ],
  [
    "Failed to delete voucher history entry.",
    "??? ?? ??? voucher ????? entry."
  ],
  [
    "Voucher generated but history record failed to save.",
    "Voucher ?? ??????? but ????? ??? ??? ?? ???"
  ],
  [
    "View Voucher History",
    "??? Voucher ?????"
  ],
  [
    "Voucher History",
    "Voucher ?????"
  ],
  [
    "Search vouchers...",
    "??? vouchers..."
  ],
  [
    "Loading voucher history...",
    "???? ??????? voucher ?????"
  ],
  [
    "No vouchers found yet.",
    "?? vouchers ?? ?????? yet."
  ],
  [
    "Voucher #",
    "Voucher #"
  ],
  [
    "Payment Info",
    "????? Info"
  ],
  [
    "Click to open voucher",
    "Click ??? ??? voucher"
  ]
];

function isBrokenArabicTranslation(value: string): boolean {
  const normalized = normalizeSpaces(String(value ?? ""));
  if (!normalized) return true;
  if (/\?{2,}/.test(normalized)) return true;
  if (normalized.includes("\uFFFD") || normalized.includes("�")) return true;
  return false;
}

function isWeakWordRule(source: string, target: string): boolean {
  const src = normalizeSpaces(String(source ?? "")).toLowerCase();
  const dst = normalizeSpaces(String(target ?? ""));
  if (!src || !dst) return true;
  if (["is", "are", "am", "do", "does", "did", "ed", "ing"].includes(src)) return true;
  return false;
}

PHRASES_EN_AR.push(...AUTO_AUDIT_TRANSLATIONS_EN_AR.filter(([, ar]) => !isBrokenArabicTranslation(ar)));

const SAFE_PHRASES_EN_AR = PHRASES_EN_AR.filter(([en, ar]) => {
  const source = normalizeSpaces(String(en ?? ""));
  const target = normalizeSpaces(String(ar ?? ""));
  return Boolean(source) && Boolean(target) && !isBrokenArabicTranslation(target);
});

const EN_TO_AR = new Map<string, string>(SAFE_PHRASES_EN_AR);
const AR_TO_EN = new Map<string, string>(SAFE_PHRASES_EN_AR.map(([en, ar]) => [ar, en]));

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
  
  // ===== ROLE ACCESS CONTROL (RolesPoliciesAdmin.tsx) =====
  ["roleAccessControl", "تحكم الوصول للأدوار"],
  ["manageOptionLevelPermissions", "إدارة الصلاحيات على مستوى الخيارات المخزنة في الخلفية"],
  ["selectRoleToModify", "اختر الدور المراد تعديله:"],
  ["currentlyEditing", "قيد التعديل حالياً: "],
  ["allModules", "جميع الوحدات"],
  ["coreOperations", "العمليات الأساسية"],
  ["financial", "المالي"],
  ["searchPermissionsPlaceholder", "ابحث عن الصلاحيات... (خصم، عرض التفاصيل، إنشاء، إلغاء...)"],
  ["resetDeleteBackendRows", "إعادة تعيين (حذف صفوف الخلفية)"],
  ["saveToBackend", "حفظ في الخلفية"],
  ["savingChanges", "جاري حفظ التغييرات"],
  ["createNewRole", "إنشاء دور جديد"],
  ["roleName", "اسم الدور"],
  ["egCashier", "مثال: أمين الصندوق"],
  ["creating", "جاري الإنشاء"],
  ["failedToLoadRoles", "فشل تحميل الأدوار"],
  ["roleNameIsRequired", "اسم الدور مطلوب."],
  ["roleCreated", "تم إنشاء الدور"],
  ["createRoleFailed", "فشل إنشاء الدور"],
  ["failedToLoadRoleSettings", "فشل تحميل إعدادات الدور"],
  ["savedRolePermissions", "تم حفظ صلاحيات الدور"],
  ["resetOptionPermissionsConfirm", "إعادة تعيين صلاحيات الخيارات لهذا الدور (حذف الإعدادات المخزنة)؟"],
  ["optionPermissionsResetToDefaults", "تم إعادة تعيين صلاحيات الخيارات إلى الافتراضيات (تم حذف الصفوف من الخلفية)."],
  ["resetFailed", "فشل إعادة التعيين"],
  
  // ===== USER ADMIN (UserAdmin.tsx) =====
  ["youDontHaveAccessToThisPage", "لا يمكنك الوصول إلى هذه الصفحة."],
  ["User Management System", "نظام إدارة المستخدمين"],
  ["userDetails", "تفاصيل المستخدم"],
  ["editUserDetails", "تعديل تفاصيل المستخدم"],
  ["viewAndManageUserAccountSettings", "عرض وإدارة إعدادات حساب المستخدم"],
  ["backToUsers", "العودة إلى المستخدمين"],
  ["Back to Users List", "العودة إلى قائمة المستخدمين"],
  ["employeeID", "معرف الموظف"],
  ["firstName", "الاسم الأول"],
  ["lastName", "اسم العائلة"],
  ["mobileNumber", "رقم الهاتف"],
  ["department", "القسم"],
  ["role", "الدور"],
  ["lineManager", "مدير التقارير"],
  ["isActive", "نشط"],
  ["dashboardAccess", "الوصول للوحة البيانات"],
  ["cancelEdit", "إلغاء التعديل"],
  ["viewDetails", "عرض التفاصيل"],
  ["sendPasswordReset", "إرسال إعادة تعيين كلمة المرور"],
  ["deleteUserAccount", "حذف حساب المستخدم"],
  ["deleteUser", "حذف المستخدم"],
  ["keepUser", "الاحتفاظ بالمستخدم"],
  ["youAreAboutToDelete", "أنت على وشك حذف"],
  ["thisActionIsPermanent", "هذا الإجراء دائم ولا يمكن التراجع عنه."],
  ["inviteSuccessSent", "تم إرسال بريد الدعوة إلى"],
  ["passwordResetEmailSent", "تم إرسال بريد إعادة تعيين كلمة المرور إلى"],
  ["resetPasswordEmailSentTo", "تم إرسال بريد إعادة تعيين كلمة المرور إلى"],
  ["userUpdatedSuccessfully", "تم تحديث المستخدم بنجاح!"],
  ["failedToDeleteUser", "فشل حذف المستخدم."],
  ["setPasswordLink", "تم نسخ رابط تعيين كلمة المرور."],
  ["inviteUser", "دعوة مستخدم"],
  ["accountPassword", "كلمة مرور الحساب"],
  ["sendTemporaryPasswordEmail", "إرسال كلمة مرور مؤقتة عبر البريد الإلكتروني"],
  ["setPrimaryPasswordNow", "تعيين كلمة مرور أساسية الآن"],
  ["primaryPasswordOptional", "كلمة المرور الأساسية (اختياري)"],
  ["leaveBlankForTemporaryPassword", "اتركها فارغة لإرسال كلمة مرور مؤقتة."],
  ["employeeIdIsRequired", "معرف الموظف مطلوب."],
  ["emailFirstNameLastNameRequired", "البريد الإلكتروني والاسم الأول والأخير مطلوبة."],
  ["selectDepartment", "اختر قسماً."],
  ["selectRole", "اختر دوراً للقسم."],
  ["employeeIDExists", "معرف الموظف موجود بالفعل."],
  ["departmentIsRequired", "القسم مطلوب لإرسال إعادة تعيين كلمة المرور."],
  ["resetPasswordEmail", "تم إرسال بريد إعادة تعيين كلمة المرور إلى"],
  ["userEmail", "بريد المستخدم الإلكتروني"],
  ["selectDepartmentFirst", "اختر قسماً أولاً."],
  ["selectRoleForDepartment", "اختر دوراً للقسم."],
  ["selectDepartmentFirst", "اختر قسماً أولاً."],
  
  // ===== INVENTORY MANAGEMENT (InventoryManagement.tsx) =====
  ["productInventory", "مخزون المنتجات"],
  ["manageProductCategoriesSubcategoriesAndStock", "إدارة الفئات والفئات الفرعية والمخزون للمنتجات"],
  ["addCategory", "إضافة فئة"],
  ["addSubcategory", "إضافة فئة فرعية"],
  ["addProduct", "إضافة منتج"],
  ["addProducts", "إضافة منتجات"],
  ["products", "المنتجات"],
  ["store", "المتجر"],
  ["loading", "جاري التحميل"],
  ["categoryCreated", "تم إنشاء الفئة."],
  ["categoryUpdated", "تم تحديث الفئة."],
  ["categoryRemoved", "تم إزالة الفئة."],
  ["subcategoryCreated", "تم إنشاء الفئة الفرعية."],
  ["subcategoryUpdated", "تم تحديث الفئة الفرعية."],
  ["subcategoryRemoved", "تم إزالة الفئة الفرعية."],
  ["fieldDefinitionsSaved", "تم حفظ تعريفات الحقول."],
  ["productAdded", "تم إضافة {qty} وحدة(وحدات) من \"{name}\"."],
  ["itemsAddedViaScan", "تم إضافة {qty} عناصر عبر المسح."],
  ["productRemoved", "تم إزالة المنتج."],
  ["checkedOut", "تم فحص {qty} وحدة(وحدات) من \"{product}\"."],
  ["noCategoriesYet", "لا توجد فئات حتى الآن"],
  ["categoryName", "اسم الفئة"],
  ["subcategoryName", "اسم الفئة الفرعية"],
  ["productName", "اسم المنتج"],
  ["serialNumber", "رقم التسلسل"],
  ["barcode", "الرمز الشريطي"],
  ["quantity", "الكمية"],
  ["customFields", "الحقول المخصصة"],
  ["deleteCategory", "حذف الفئة"],
  ["deleteSubcategory", "حذف الفئة الفرعية"],
  ["deleteProduct", "حذف المنتج"],
  ["saveFailed", "فشل الحفظ"],
  ["deleteFailed", "فشل الحذف"],
  ["failedToLoadCategories", "فشل تحميل الفئات"],
  ["failedToLoadSubcategories", "فشل تحميل الفئات الفرعية"],
  ["failedToLoadProducts", "فشل تحميل المنتجات"],
  ["noSubcategoriesYet", "لا توجد فئات فرعية حتى الآن"],
  ["noProductsYet", "لا توجد منتجات حتى الآن"],
  ["enterProductName", "يرجى إدخال اسم المنتج."],
  ["clickAddCategoryToCreate", "انقر على \"إضافة فئة\" لإنشاء الفئة الأولى."],

  // ===== ADDITIONAL ROLES & POLICIES ADMIN KEYS =====
  ["description", "الوصف"],
  ["enableDisable", "تمكين/تعطيل"],
  ["createRole", "إنشاء الدور"],

  // ===== ADDITIONAL USER ADMIN KEYS =====
  ["userInformation", "معلومات المستخدم"],
  ["accountSettings", "إعدادات الحساب"],
  ["userStatus", "حالة المستخدم"],
  ["inactiveUsersBlockedFromAccess", "المستخدمون غير النشطون ممنوعون من الوصول."],
  ["disabledUsersCannotAccessDashboard", "المستخدمون المعطلون لا يمكنهم الوصول إلى لوحة تحكم CRM."],
  ["passwordManagement", "إدارة كلمة المرور"],
  ["resetUserPassword", "إعادة تعيين كلمة مرور المستخدم"],
  ["sendPasswordResetEmailToUser", "إرسال بريد إلكتروني لإعادة تعيين كلمة المرور."],
  ["resetPassword", "إعادة تعيين كلمة المرور"],
  ["selectEllipsis", "اختر..."],
  ["Users List", "قائمة المستخدمين"],
  ["Add New User", "إضافة مستخدم جديد"],
  ["employeeName", "اسم الموظف"],
  ["emailAddress", "عنوان البريد الإلكتروني"],
  ["noUsersFound", "لم يتم العثور على مستخدمين."],
  ["Users list is disabled for your role.", "رؤية قائمة المستخدمين معطلة لدورك."],
  ["Active", "نشط"],
  ["Inactive", "غير نشط"],
  ["allowed", "مسموح"],
  ["blocked", "محظور"],
  ["tipSetInactiveInsteadOfDeleting", "تلميح: إذا كان المستخدم لا يزال بحاجة إلى الوصول لاحقاً، يُفضل تعطيله من تفاصيل المستخدم بدلاً من الحذف."],
  ["searchByEmployeeNameEmailEtc", "ابحث بمعرف الموظف أو الاسم أو البريد الإلكتروني أو الجوال أو القسم أو الدور"],
  ["tipQatarFormat", "تلميح: استخدم صيغة قطر مثل +974 XXXXXXXX"],
  ["employeeIdExample", "EMP001"],
  ["phoneExample", "+974 1234 5678"],
  ["toggleUserActiveStatus", "تبديل حالة المستخدم النشطة"],
  ["toggleDashboardAccess", "تبديل الوصول إلى لوحة التحكم"],
  ["rbacSelfCheckDevOnly", "فحص RBAC الذاتي (للتطوير فقط)"],
  ["loginPage", "صفحة تسجيل الدخول"],
  ["setPasswordLinkLabel", "رابط تعيين كلمة المرور"],
  ["enterEmailToGenerateLink", "أدخل بريدًا إلكترونيًا لإنشاء الرابط."],
  ["copyLink", "نسخ الرابط"],
  ["usersGetAccessHint", "يحصل المستخدمون على الوصول من القسم (المجموعة) ← الأدوار ← السياسات."],
  ["rootAdminReadOnly", "مستخدم المدير الجذر للقراءة فقط في هذه الصفحة."],
  ["firstNameLastNameRequired", "الاسم الأول والأخير مطلوبان."],
  ["departmentRequired", "القسم مطلوب."],
  ["roleRequired", "الدور مطلوب."],
  ["selectedRoleNotValidForDept", "الدور المحدد غير صالح للقسم المختار."],
  ["sendingResetPasswordEmail", "جاري إرسال بريد إعادة تعيين كلمة المرور..."],
  ["userEmailMissing", "بريد المستخدم الإلكتروني مفقود."],
  ["failedToSendResetPasswordEmail", "فشل إرسال بريد إعادة تعيين كلمة المرور."],
  ["failedToUpdateUser", "فشل تحديث المستخدم."],
  ["inviting", "جاري الدعوة..."],
  ["inviteFailed", "فشل الدعوة."],
  ["passwordResetNotDispatched", "لم يُرسَل بريد إعادة تعيين كلمة المرور."],
  ["invitationEmailNotDispatched", "لم يُرسَل بريد الدعوة."],
  ["departmentRequiredForReset", "القسم مطلوب لإرسال بريد إعادة تعيين كلمة المرور."],
  ["mobileNumberRequired", "رقم الجوال مطلوب."],

  // ===== ADDITIONAL INVENTORY MANAGEMENT KEYS =====
  ["inventory", "المخزون"],
  ["subcategories", "الفئات الفرعية"],
  ["clickToExplore", "انقر للاستكشاف ←"],
  ["clickToViewProducts", "انقر لعرض المنتجات ←"],
  ["quickAdd", "إضافة سريعة"],
  ["quickProductName", "اسم المنتج السريع"],
  ["editCategoryTooltip", "تعديل الفئة"],
  ["deleteCategoryTooltip", "حذف الفئة"],
  ["editSubcategoryTooltip", "تعديل الفئة الفرعية"],
  ["deleteSubcategoryTooltip", "حذف الفئة الفرعية"],
  ["manageCustomFieldsTooltip", "إدارة الحقول المخصصة"],
  ["deleteProductTooltip", "حذف المنتج"],
  ["showingProductsIn", "عرض المنتجات في"],
  ["searchByNameSerialOrBarcode", "ابحث بالاسم أو الرقم التسلسلي أو الرمز الشريطي..."],
  ["noProductsMatchSearch", "لا توجد منتجات مطابقة لبحثك"],
  ["clickAddProductsToAddStock", "انقر على \"إضافة منتجات\" لإضافة مخزون."],
  ["noInventoryCategoriesCreated", "لا توجد فئات مخزون تم إنشاؤها."],
  ["serialBarcode", "الرقم التسلسلي / الرمز الشريطي"],
  ["availableHeader", "المتاح"],
  ["totalAdded", "إجمالي المضاف"],
  ["serialPrefix", "رقم ت.:"],
  ["barcodePrefix", "رمز QR:"],
  ["recentTransactions", "المعاملات الأخيرة"],
  ["productHeader", "المنتج"],
  ["typeHeader", "النوع"],
  ["byHeader", "بواسطة"],
  ["addStockBadge", "إضافة مخزون"],
  ["checkoutBadge", "تسليم"],
  ["storeProductCheckout", "المتجر — سحب المنتج"],
  ["selectCategoryThenRetrieve", "اختر فئة منتج، ثم اختر ما تريد استرداده من المخزون"],
  ["startOver", "البدء من جديد"],
  ["selectCategoryStep", "اختر الفئة"],
  ["selectSubcategoryStep", "اختر الفئة الفرعية"],
  ["checkoutProductsStep", "سحب المنتجات"],
  ["whichCategoryToRetrieve", "أي فئة تريد استرداد المنتجات منها؟"],
  ["noInventoryCategories", "لا توجد فئات مخزون"],
  ["askAdminToSetupCategories", "اطلب من المسؤول إعداد فئات المنتجات أولاً."],
  ["whichSubcategoryToRetrieve", "أي فئة فرعية تريد استرداد المنتجات منها؟"],
  ["selectASubcategory", "اختر الفئة الفرعية"],
  ["noSubcategoriesInCategory", "لا توجد فئات فرعية"],
  ["noCategorySubcategoriesWithProducts", "هذه الفئة لا تحتوي على فئات فرعية بها منتجات."],
  ["backToCategories", "العودة إلى الفئات"],
  ["availableProducts", "المنتجات المتاحة"],
  ["selectQuantityToCheckout", "اختر الكمية لتسليمها"],
  ["noProductsAvailableForCheckout", "لا توجد منتجات متاحة للتسليم"],
  ["allProductsOutOfStock", "جميع المنتجات في هذه الفئة الفرعية نفدت أو غير متاحة."],
  ["availableBadge", "متاح"],
  ["qtyLabel", "الكمية:"],
  ["backToSubcategories", "العودة إلى الفئات الفرعية"],
  ["recentStoreActivity", "النشاط الأخير في المتجر"],
  ["checkedOutBy", "استُلم بواسطة"],
  ["newCategory", "فئة جديدة"],
  ["editCategoryTitle", "تعديل الفئة"],
  ["optionalDescriptionPlaceholder", "وصف اختياري..."],
  ["createCategory", "إنشاء فئة"],
  ["saving", "جاري الحفظ..."],
  ["newSubcategory", "فئة فرعية جديدة"],
  ["editSubcategoryTitle", "تعديل الفئة الفرعية"],
  ["insideCategory", "داخل الفئة:"],
  ["canDefineCustomFieldsAfterCreate", "يمكنك تحديد حقول منتج مخصصة لهذه الفئة الفرعية بعد إنشائها."],
  ["createSubcategory", "إنشاء فئة فرعية"],
  ["noCustomFieldsDefined", "لا توجد حقول مخصصة"],
  ["clickAddFieldToCreate", "انقر على \"إضافة حقل\" لإضافة حقلك المخصص الأول."],
  ["fieldLabelPlaceholder", "اسم الحقل (مثل: اللون)"],
  ["textString", "نص (نصي)"],
  ["numberType", "رقم"],
  ["yesNoBoolean", "نعم/لا (منطقي)"],
  ["dateType", "تاريخ"],
  ["emailType", "بريد إلكتروني"],
  ["required", "مطلوب"],
  ["removeField", "حذف الحقل"],
  ["addField", "إضافة حقل"],
  ["saveFieldDefinitions", "حفظ تعريفات الحقول"],
  ["byQuantity", "بالكمية"],
  ["byScanning", "بالمسح"],
  ["categoryLabel", "الفئة"],
  ["subcategoryRequired", "الفئة الفرعية *"],
  ["selectSubcategoryOpt", "اختر الفئة الفرعية..."],
  ["noSubcategoriesFoundCreateFirst", "لم يتم العثور على فئات فرعية. أنشئ فئة فرعية أولاً."],
  ["quantityToAdd", "الكمية المراد إضافتها *"],
  ["canAddMultipleUnitsAtOnce", "يمكنك إضافة وحدات متعددة في وقت واحد (مثل: 100)"],
  ["optionalSerialNumber", "رقم تسلسلي اختياري"],
  ["optionalBarcodeQR", "رمز شريطي اختياري"],
  ["anyAdditionalNotes", "أي ملاحظات إضافية..."],
  ["scanOrEnterSerialBarcode", "مسح أو إدخال الرقم التسلسلي / الرمز الشريطي"],
  ["useScannerOrTypeManually", "استخدم ماسح الرمز الشريطي أو اكتب الرمز يدوياً. اضغط Enter لإضافة كل عنصر."],
  ["scanOrTypePlaceholder", "امسح أو اكتب الرقم التسلسلي / الرمز الشريطي..."],
  ["productNameOptional", "اسم المنتج (اختياري)"],
  ["adding", "جاري الإضافة..."],
  ["processing", "جاري المعالجة..."],
  ["quantityMustBeAtLeastOne", "يجب أن تكون الكمية 1 على الأقل."],
  ["allSubcategoriesProductsWillBeHidden", "ستُخفى جميع الفئات الفرعية والمنتجات بداخلها أيضاً."],
  ["allProductsInsideWillBeHidden", "ستُخفى جميع المنتجات بداخلها أيضاً."],
  ["actionCannotBeUndone", "هذا الإجراء لا يمكن التراجع عنه."],
  ["failedToAddProduct", "فشل إضافة المنتج"],
  ["failedToProcessScan", "فشل معالجة المسح"],
  ["quickAddFailed", "فشل الإضافة السريعة"],
  ["checkoutFailed", "فشل التسليم"],
  ["noItemsToProcess", "لا توجد عناصر لمعالجتها."],
  ["Quotations", "عروض الأسعار"],
  ["Quotation Builder", "منشئ عروض الأسعار"],
  ["Create customer quotations with live service/package pricing and policy-based discount limits.", "أنشئ عروض أسعار العملاء بأسعار خدمات/باقات مباشرة وحدود خصم مبنية على السياسات."],
  ["Failed to load services and packages.", "فشل تحميل الخدمات والباقات."],
  ["Please complete customer info and select at least one service/package.", "يرجى استكمال بيانات العميل واختيار خدمة/باقة واحدة على الأقل."],
  ["Generate Quotation PDF", "إنشاء عرض السعر PDF"],
  ["Quotation PDF generated successfully.", "تم إنشاء ملف عرض السعر PDF بنجاح."],
  ["Quotation opened in a new tab.", "تم فتح عرض السعر في تبويب جديد."],
  ["Popup blocked. Please allow popups and try again.", "تم حظر النافذة المنبثقة. يرجى السماح بالنوافذ المنبثقة والمحاولة مرة أخرى."],
  ["Services & Packages", "الخدمات والباقات"],
  ["Unnamed service", "خدمة بدون اسم"],
  ["Loading services and packages...", "جارٍ تحميل الخدمات والباقات..."],
  ["No active services/packages found.", "لم يتم العثور على خدمات/باقات نشطة."],
  ["Discount %", "نسبة الخصم %"],
  ["Max discount allowed by policy:", "الحد الأقصى للخصم المسموح حسب السياسة:"],
  ["Quotation Summary", "ملخص عرض السعر"],
  ["No selected lines yet.", "لا توجد بنود محددة بعد."],
  ["Net Quotation", "صافي عرض السعر"],
  ["Quotation Validity (days)", "صلاحية عرض السعر (بالأيام)"],
  ["Quotation Valid Until", "صالح حتى تاريخ"],
  ["Remarks (English)", "الملاحظات (بالإنجليزية)"],
  ["Remarks (Arabic)", "الملاحظات (بالعربية)"],
  ["Reset to default", "إعادة التعيين إلى الافتراضي"],
  ["Remarks are view-only for your role.", "الملاحظات للعرض فقط حسب صلاحيات دورك."],
  ["Prepared by", "تم الإعداد بواسطة"],
  ["QUOTATION", "عرض سعر"],
  ["Quotation #", "رقم عرض السعر"],
  ["Issued", "تاريخ الإصدار"],
  ["SERVICE / PACKAGE", "الخدمة / الباقة"],
  ["more line(s)", "بنود إضافية"],
  ["Send SMS messages directly to customers and track the queue fanout pipeline end-to-end.", "أرسل رسائل SMS مباشرة إلى العملاء وتتبع مسار المعالجة الكامل من الإرسال حتى التتبع."],
  ["Failed to load data.", "فشل تحميل البيانات."],
  ["Please wait before sending another batch.", "يرجى الانتظار قبل إرسال دفعة أخرى."],
  ["Batch recipient limit exceeded.", "تم تجاوز الحد الأقصى للمستلمين في الدفعة."],
  ["Maximum allowed:", "الحد الأقصى المسموح:"],
  ["sent,", "تم الإرسال،"],
  ["failed.", "فشل."],
  ["fanout event(s) could not be published.", "تعذر نشر حدث/أحداث التوزيع."],
  ["SMS sent to all", "تم إرسال الرسائل إلى جميع"],
  ["SMS submitted to provider for all", "تم تسليم الرسائل إلى مزود الخدمة لجميع"],
  ["submitted to provider,", "تم التسليم إلى مزود الخدمة،"],
  ["recipients.", "المستلمين."],
  ["failed. See results below.", "فشل. راجع النتائج أدناه."],
  ["All messages failed. Check numbers below.", "فشلت جميع الرسائل. تحقّق من الأرقام أدناه."],
  ["Failed to send SMS.", "فشل إرسال رسالة SMS."],
  ["Please write a message before sending.", "يرجى كتابة رسالة قبل الإرسال."],
  ["Please select at least one recipient.", "يرجى اختيار مستلم واحد على الأقل."],
  ["Send SMS to", "إرسال SMS إلى"],
  ["recipient(s)?", "مستلم/مستلمين؟"],
  ["No failed recipients found for this batch.", "لم يتم العثور على مستلمين فشلوا في هذه الدفعة."],
  ["Retry failed recipients only?", "إعادة المحاولة للمستلمين الفاشلين فقط؟"],
  ["Recipients", "المستلمون"],
  ["Message", "الرسالة"],
  ["No send history available to export.", "لا يوجد سجل إرسال متاح للتصدير."],
  ["SMS send history exported successfully.", "تم تصدير سجل إرسال SMS بنجاح."],
  ["Failed to export SMS send history.", "فشل تصدير سجل إرسال SMS."],
  ["selected", "محدد"],
  ["Search by name, phone, company…", "ابحث بالاسم أو الهاتف أو الشركة…"],
  ["Select all", "تحديد الكل"],
  ["Deselect all", "إلغاء تحديد الكل"],
  ["No contacts found.", "لم يتم العثور على جهات اتصال."],
  ["Employee", "موظف"],
  ["Max batch", "الحد الأقصى للدفعة"],
  ["more", "أكثر"],
  ["Write your SMS message here…", "اكتب رسالة SMS هنا…"],
  ["chars", "حروف"],
  ["SMS parts", "أجزاء SMS"],
  ["Transactional", "معاملاتي"],
  ["Promotional", "ترويجي"],
  ["Sending…", "جارٍ الإرسال…"],
  ["Send SMS", "إرسال SMS"],
  ["Send Results", "نتائج الإرسال"],
  ["fanout failed", "فشل التوزيع"],
  ["Send History", "سجل الإرسال"],
  ["Export CSV", "تصدير CSV"],
  ["Exporting…", "جارٍ التصدير…"],
  ["Retry failed only", "إعادة محاولة الفاشل فقط"],
  ["Submitted to provider", "تم الإرسال إلى مزود الخدمة"],
  ["Submission failed", "فشل الإرسال إلى مزود الخدمة"],
  ["Skipped", "تم التجاوز"],
  ["Pending", "قيد الانتظار"],
  ["Delivered", "تم التسليم"],
  ["Delivery failed", "فشل التسليم"],
  ["Permanent failure", "فشل دائم"],
  ["Transient failure", "فشل مؤقت"],
  ["Undeliverable", "غير قابل للتسليم"],
  ["Opted out", "ألغى الاشتراك"],
  ["Marked as spam", "تم اعتباره رسالة مزعجة"],
  ["Awaiting carrier feedback", "بانتظار تأكيد شركة الاتصالات"],
  ["Unresolved only", "غير المحسوم فقط"],
  ["No matching SMS history found.", "لم يتم العثور على سجل SMS مطابق."],
  ["Setup incomplete: no carrier delivery feedback is being ingested yet.", "الإعداد غير مكتمل: لا يتم حالياً استيعاب أي تغذية راجعة من شركة الاتصالات."],
  ["Enable SNS SMS delivery status logging to CloudWatch and attach the log group subscription to the delivery-status Lambda.", "فعّل تسجيل حالة تسليم SMS في SNS إلى CloudWatch ثم اربط اشتراك مجموعة السجلات مع Lambda الخاص بحالة التسليم."],
  ["loadFailed", "فشل التحميل"],
];

const FRAGMENTS_AR_EN: Array<[string, string]> = FRAGMENTS_EN_AR.map(([en, ar]) => [ar, en]);

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function replaceEvery(text: string, search: string, replacement: string): string {
  return text.split(search).join(replacement);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseWord(word: string): string {
  if (!word) return word;
  const upper = word.toUpperCase();
  // Keep common acronyms fully uppercased.
  if (["ID", "URL", "API", "SMS", "CRM", "VIN", "QAR", "QC", "PDF", "EN", "AR"].includes(upper)) {
    return upper;
  }
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function humanizeEnglishKey(value: string): string {
  const raw = String(value ?? "");
  if (!raw.trim()) return raw;

  // Only humanize identifier-like values (keys), not full phrases/sentences.
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(raw)) return raw;
  if (raw.includes(" ")) return raw;
  const looksLikeKey = /[_-]/.test(raw) || /[a-z][A-Z]/.test(raw);
  if (!looksLikeKey) return raw;

  const withSpaces = raw
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();

  return withSpaces
    .split(" ")
    .map((part) => titleCaseWord(part))
    .join(" ");
}

const WORDS_EN_AR: Array<[string, string]> = [
  ["dashboard", "لوحة التحكم"],
  ["customer", "عميل"],
  ["customers", "العملاء"],
  ["vehicle", "مركبة"],
  ["vehicles", "المركبات"],
  ["ticket", "تذكرة"],
  ["tickets", "التذاكر"],
  ["employee", "موظف"],
  ["employees", "الموظفون"],
  ["service", "خدمة"],
  ["services", "الخدمات"],
  ["inspection", "الفحص"],
  ["quality", "الجودة"],
  ["payment", "الدفع"],
  ["invoice", "فاتورة"],
  ["invoices", "فواتير"],
  ["history", "السجل"],
  ["create", "إنشاء"],
  ["created", "تم الإنشاء"],
  ["update", "تحديث"],
  ["updated", "تم التحديث"],
  ["delete", "حذف"],
  ["search", "بحث"],
  ["save", "حفظ"],
  ["cancel", "إلغاء"],
  ["close", "إغلاق"],
  ["confirm", "تأكيد"],
  ["warning", "تنبيه"],
  ["error", "خطأ"],
  ["success", "نجاح"],
  ["loading", "جاري التحميل"],
  ["active", "نشط"],
  ["inactive", "غير نشط"],
  ["approved", "تمت الموافقة"],
  ["pending", "قيد الانتظار"],
  ["rejected", "مرفوض"],
  ["status", "الحالة"],
  ["date", "التاريخ"],
  ["time", "الوقت"],
  ["phone", "الهاتف"],
  ["email", "البريد الإلكتروني"],
  ["name", "الاسم"],
  ["notes", "ملاحظات"],
  ["admin", "الإدارة"],
  ["user", "مستخدم"],
  ["users", "المستخدمون"],
  ["department", "قسم"],
  ["departments", "الأقسام"],
  ["role", "دور"],
  ["roles", "الأدوار"],
  ["policy", "سياسة"],
  ["policies", "السياسات"],
  ["login", "تسجيل الدخول"],
  ["logout", "تسجيل الخروج"],
  ["sign out", "تسجيل الخروج"],
  ["yes", "نعم"],
  ["no", "لا"],
];

WORDS_EN_AR.push(
  ["name", "الاسم"],
  ["is", ""],
  ["are", ""],
  ["am", ""],
  ["do", ""],
  ["does", ""],
  ["did", ""],
  ["have", "يحتوي"],
  ["has", "يحتوي"],
  ["been", "تم"],
  ["be", "يكون"],
  ["will", "سوف"],
  ["must", "يجب"],
  ["can", "يمكن"],
  ["cannot", "لا يمكن"],
  ["at", "في"],
  ["here", "هنا"],
  ["data", "البيانات"],
  ["info", "المعلومات"],
  ["description", "الوصف"],
  ["manage", "إدارة"],
  ["assigned", "مُعيّن"],
  ["added", "تمت الإضافة"],
  ["append", "إلحاق"],
  ["use", "استخدم"],
  ["edit", "تعديل"],
  ["keep", "احتفاظ"],
  ["back", "عودة"],
  ["related", "مرتبط"],
  ["changes", "التغييرات"],
  ["change", "تغيير"],
  ["text", "النص"],
  ["field", "الحقل"],
  ["fields", "الحقول"],
  ["option", "خيار"],
  ["options", "خيارات"],
  ["checkboxes", "مربعات اختيار"],
  ["dropdown", "قائمة منسدلة"],
  ["choice", "اختيار"],
  ["multiple", "متعدد"],
  ["short", "قصير"],
  ["long", "طويل"],
  ["sum", "المجموع"],
  ["increase", "زيادة"],
  ["decrease", "تقليل"],
  ["decimal", "عشري"],
  ["title", "العنوان"],
  ["content", "المحتوى"],
  ["directory", "الدليل"],
  ["parity", "تطابق"],
  ["visual", "بصري"],
  ["style", "نمط"],
  ["positive", "موجب"],
  ["number", "رقم"],
  ["bypass", "تجاوز"],
  ["bypassed", "تم التجاوز"],
  ["permit", "تصريح"],
  ["reason", "السبب"],
  ["mode", "الوضع"],
  ["person", "الشخص"],
  ["collecting", "استلام"],
  ["collector", "المستلم"],
  ["eligible", "مؤهل"],
  ["standard", "قياسي"],
  ["allowed", "مسموح"],
  ["ready", "جاهز"],
  ["unpaid", "غير مدفوع"],
  ["approval", "الموافقة"],
  ["approvals", "الموافقات"],
  ["queue", "القائمة"],
  ["processor", "المعالج"],
  ["password", "كلمة المرور"],
  ["ticket", "تذكرة"],
  ["tickets", "التذاكر"],
  ["quotation", "عرض السعر"],
  ["quotations", "عروض الأسعار"],
  ["voucher", "القسيمة"],
  ["vouchers", "القسائم"],
  ["english", "الإنجليزية"],
  ["arabic", "العربية"],
  ["now", "الآن"],
  ["run", "تشغيل"],
  ["other", "آخر"],
  ["untitled", "بدون عنوان"],
  ["but", "لكن"],
  ["share", "مشاركة"],
  ["version", "الإصدار"],
  ["usage", "الاستخدام"],
  ["entry", "إدخال"],
  ["include", "تضمين"],
  ["show", "عرض"],
  ["execution", "التنفيذ"],
  ["word", "كلمة"],
  ["currently", "حالياً"],
  ["me", "لي"],
  ["my", "الخاص بي"],
  ["suggested", "مقترح"],
  ["place", "المكان"],
  ["click", "انقر"],
  ["up", "أعلى"],
  ["still", "ما زال"],
  ["end", "النهاية"],
  ["if", "إذا"],
  ["manually", "يدوياً"],
  ["scanned", "تم المسح"],
  ["confirm", "تأكيد"],
  ["report", "تقرير"],
  ["reports", "التقارير"],
  ["work", "العمل"],
  ["logs", "السجلات"],
  ["log", "سجل"],
  ["dataset", "مجموعة البيانات"],
  ["groups", "المجموعات"],
  ["group", "المجموعة"],
  ["removed", "تمت الإزالة"],
  ["skipped", "تم التخطي"],
  ["wait", "انتظر"],
  ["read", "قراءة"],
  ["reading", "جاري القراءة"],
  ["paginated", "مقسمة إلى صفحات"],
  ["means", "يعني"],
  ["contains", "يحتوي"],
  ["age", "العمر"],
  ["older", "أقدم"],
  ["newer", "أحدث"],
  ["over", "عبر"],
  ["upcoming", "قادمة"],
  ["except", "باستثناء"],
  ["erased", "سيتم المسح"],
  ["wiped", "سيتم المسح"],
  ["check", "تحقق"],
  ["dept", "قسم"],
  ["deletion", "الحذف"],
  ["auto", "تلقائي"],
  ["textarea", "مساحة نص"],
  ["ed", ""],
  ["ing", ""],
);

const SAFE_FRAGMENTS_EN_AR: Array<[string, string]> = FRAGMENTS_EN_AR
  .filter(([src, target]) => Boolean(src) && !isBrokenArabicTranslation(target));

const SAFE_WORDS_EN_AR: Array<[string, string]> = WORDS_EN_AR
  .filter(([src, target]) => Boolean(src) && !isBrokenArabicTranslation(target) && !isWeakWordRule(src, target));

const WORDS_AR_EN: Array<[string, string]> = SAFE_WORDS_EN_AR.map(([en, ar]) => [ar, en]);

const FRAGMENT_TRANSLATORS_EN_AR: Array<[RegExp, string]> = SAFE_FRAGMENTS_EN_AR
  .map(([src, target]) => [new RegExp(escapeRegex(src), "gi"), target]);

const WORD_TRANSLATORS_EN_AR: Array<[RegExp, string]> = SAFE_WORDS_EN_AR
  .map(([src, target]) => [new RegExp(`\\b${escapeRegex(src)}\\b`, "gi"), target]);

const TRANSLATION_CACHE_LIMIT = 8000;
const translationCache = new Map<string, string>();
const HAS_LATIN_TEXT = /[A-Za-z]/;
const HAS_ARABIC_TEXT = /[\u0600-\u06FF]/;

function applyEnglishWordTranslations(value: string): string {
  let out = String(value ?? "");
  for (const [pattern, target] of WORD_TRANSLATORS_EN_AR) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, target);
  }
  return out.replace(/\s+/g, " ").trim();
}

function cacheTranslation(language: LanguageCode, text: string, value: string): string {
  if (translationCache.size >= TRANSLATION_CACHE_LIMIT) translationCache.clear();
  translationCache.set(`${language}\u0000${text}`, value);
  return value;
}

export function translateTextValue(input: string, language: LanguageCode): string {
  const raw = String(input ?? "");
  const trimmed = normalizeSpaces(raw);
  if (!trimmed) return raw;

  const normalizedIdentifier = normalizeSpaces(
    trimmed
      .replace(/[_-]+/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
  );
  const translationSeed = normalizedIdentifier || trimmed;

  const leading = raw.match(/^\s*/)?.[0] ?? "";
  const trailing = raw.match(/\s*$/)?.[0] ?? "";

  if (language === "ar" && !HAS_LATIN_TEXT.test(trimmed)) return raw;
  if (language === "en" && !HAS_ARABIC_TEXT.test(trimmed)) return raw;

  const cacheKey = `${language}\u0000${trimmed}`;
  const cached = translationCache.get(cacheKey);
  if (cached !== undefined) return `${leading}${cached}${trailing}`;

  if (language === "ar") {
    if (EN_TO_AR.has(trimmed) || EN_TO_AR.has(translationSeed)) {
      const translated = String(EN_TO_AR.get(trimmed) ?? EN_TO_AR.get(translationSeed) ?? "");
      if (!isBrokenArabicTranslation(translated)) {
        return `${leading}${cacheTranslation(language, trimmed, translated)}${trailing}`;
      }
    }
    let out = translationSeed;
    for (const [pattern, target] of FRAGMENT_TRANSLATORS_EN_AR) {
      pattern.lastIndex = 0;
      out = out.replace(pattern, target);
    }
    out = applyEnglishWordTranslations(out);
    return `${leading}${cacheTranslation(language, trimmed, out)}${trailing}`;
  }

  if (AR_TO_EN.has(trimmed)) {
    const translated = String(AR_TO_EN.get(trimmed) ?? "");
    return `${leading}${cacheTranslation(language, trimmed, translated)}${trailing}`;
  }
  let out = trimmed;
  for (const [src, target] of FRAGMENTS_AR_EN) {
    if (out.includes(src)) out = replaceEvery(out, src, target);
  }
  for (const [src, target] of WORDS_AR_EN) {
    if (src && out.includes(src)) out = replaceEvery(out, src, target);
  }
  return `${leading}${cacheTranslation(language, trimmed, out)}${trailing}`;
}

export function t(language: LanguageCode, englishText: string): string {
  if (language === "ar") return translateTextValue(englishText, "ar");

  const exact = EN_TO_AR.has(englishText) ? englishText : null;
  if (exact) return exact;

  return humanizeEnglishKey(englishText);
}
