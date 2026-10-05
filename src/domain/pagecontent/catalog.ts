/**
 * Catalogue of the texts an administrator may reword on the self check-in kiosk and on the visitor's status page
 * (D66). One entry per text: its id, the message path whose translation is the DEFAULT (so defaults can never drift
 * from the message files), the placeholders the page fills in, a length cap, a human label and a context hint in
 * both languages. The page code asks for a text by id; an override stored in the `pageContent` setting wins,
 * otherwise the message-file translation is shown.
 *
 * Rules for maintainers:
 *  - An id is the message path without its namespace (`kiosk.` for the kiosk, `visitorStatus.` for the visitor
 *    page), so `chooseService` is `kiosk.chooseService`.
 *  - Never delete or rename an id that may have been saved: stored overrides are validated against this list, so a
 *    missing id makes the saved value invalid. Retire an id by keeping it in RETIRED_IDS instead.
 *  - A placeholder may be listed only when every place that shows the text fills it in.
 */

export type PageGroup = "kiosk" | "visitor";
export type Bilingual = { ar: string; en: string };

export type CatalogEntry = {
  id: string;
  group: PageGroup;
  /** The screen or block the text appears on (for grouping and for the preview). */
  screen: string;
  /** Dotted path in the message files whose translation is the default. */
  path: string;
  placeholders: readonly string[];
  max: number;
  label: Bilingual;
  hint: Bilingual;
};

/** Message namespace of each group. */
export const NAMESPACE: Record<PageGroup, string> = { kiosk: "kiosk", visitor: "visitorStatus" };

/** The screens of each group, in the order the editor lists them. */
export const SCREENS: Record<PageGroup, { id: string; label: Bilingual }[]> = {
  kiosk: [
    { id: "home", label: { en: "First screen", ar: "الشاشة الأولى" } },
    { id: "form", label: { en: "Details form", ar: "نموذج البيانات" } },
    { id: "result", label: { en: "Ticket screen", ar: "شاشة التذكرة" } },
    { id: "messages", label: { en: "Unavailable and offline", ar: "غير متاح وبلا اتصال" } },
    { id: "errors", label: { en: "Error messages", ar: "رسائل الأخطاء" } },
  ],
  visitor: [
    { id: "page", label: { en: "Page and steps", ar: "الصفحة والخطوات" } },
    { id: "status", label: { en: "Status messages", ar: "رسائل الحالة" } },
    { id: "updates", label: { en: "Phone updates", ar: "التحديثات على الهاتف" } },
    { id: "feedback", label: { en: "Rating card", ar: "بطاقة التقييم" } },
    { id: "stop", label: { en: "Stop messages page", ar: "صفحة إيقاف الرسائل" } },
  ],
};

/** Ids that were once offered and are no longer; stored values for them are accepted and ignored. */
export const RETIRED_IDS: Record<PageGroup, readonly string[]> = { kiosk: [], visitor: [] };

type Row = [id: string, placeholders: string[], labelEn: string, labelAr: string, hintEn: string, hintAr: string, max?: number];

function entries(group: PageGroup, screen: string, rows: Row[]): CatalogEntry[] {
  return rows.map(([id, placeholders, en, ar, hintEn, hintAr, max]) => ({
    id,
    group,
    screen,
    path: `${NAMESPACE[group]}.${id}`,
    placeholders,
    max: max ?? 160,
    label: { en, ar },
    hint: { en: hintEn, ar: hintAr },
  }));
}

const K_HOME: Row[] = [
  [
    "welcome",
    ["branch"],
    "Welcome heading",
    "عنوان الترحيب",
    "The big heading on the first kiosk screen. Empty: the welcome text of Self check-in is used.",
    "العنوان الكبير في أول شاشة. إن تُرك فارغاً يُستخدم نص الترحيب في إعدادات التسجيل الذاتي.",
  ],
  [
    "chooseService",
    ["branch"],
    "Choose-a-service line",
    "سطر اختيار الخدمة",
    "Under the welcome heading on the first screen.",
    "تحت عنوان الترحيب في الشاشة الأولى.",
  ],
  [
    "askStaff",
    [],
    "Ask-staff note on a service",
    "ملاحظة مراجعة الموظف على الخدمة",
    "Shown on a service tile that visitors cannot take alone.",
    "تظهر على بطاقة خدمة لا يمكن للزائر أخذها بنفسه.",
  ],
  [
    "languageNameAr",
    [],
    "Arabic language button",
    "زر اللغة العربية",
    "Label of the Arabic language button (first screen).",
    "نص زر اللغة العربية في الشاشة الأولى.",
    30,
  ],
  [
    "languageNameEn",
    [],
    "English language button",
    "زر اللغة الإنجليزية",
    "Label of the English language button (first screen).",
    "نص زر اللغة الإنجليزية في الشاشة الأولى.",
    30,
  ],
];

const K_FORM: Row[] = [
  ["back", [], "Back button", "زر الرجوع", "Top of the details form.", "أعلى نموذج البيانات.", 40],
  [
    "optional",
    [],
    "Optional marker",
    "علامة اختياري",
    "Next to a field the visitor may leave empty.",
    "بجانب حقل يمكن تركه فارغاً.",
    40,
  ],
  [
    "field_phone",
    [],
    "Phone number label",
    "عنوان حقل رقم الجوال",
    "Label above the phone keypad field.",
    "العنوان فوق حقل رقم الجوال.",
    60,
  ],
  [
    "phonePlaceholder",
    [],
    "Phone number example",
    "مثال رقم الجوال",
    "Grey example shown in the empty phone field.",
    "المثال الرمادي في حقل الجوال الفارغ.",
    30,
  ],
  [
    "consentHeading",
    [],
    "Consent heading",
    "عنوان الموافقة",
    "Short heading above the consent text. The consent text itself is set in Data protection.",
    "عنوان قصير فوق نص الموافقة. نص الموافقة نفسه يُضبط من حماية البيانات.",
    60,
  ],
  [
    "getNumber",
    [],
    "Get-my-number button",
    "زر احصل على رقمي",
    "The big button that issues the ticket.",
    "الزر الكبير الذي يُصدر التذكرة.",
    60,
  ],
  [
    "issuing",
    [],
    "Issuing message",
    "رسالة جارٍ الإصدار",
    "Shown on the big button while the ticket is issued.",
    "تظهر على الزر أثناء إصدار التذكرة.",
    60,
  ],
];

const RESULT = ["number", "branch", "reason"];
const K_RESULT: Row[] = [
  ["yourNumber", RESULT, "Your number caption", "عنوان رقمك", "Above the big ticket number.", "فوق رقم التذكرة الكبير."],
  [
    "ahead",
    ["count", "ahead", "wait", ...RESULT],
    "People ahead of you",
    "عدد من أمامك",
    "Use {count} for the number of people ahead.",
    "استخدم {count} لعدد من أمامك.",
  ],
  [
    "youAreNext",
    ["wait", ...RESULT],
    "You are next",
    "دورك التالي",
    "Shown instead of the count when nobody is ahead.",
    "تظهر بدل العدد حين لا أحد أمامك.",
  ],
  [
    "scanQr",
    ["number"],
    "Scan-the-QR text",
    "نص مسح الرمز",
    "Beside the QR code that opens the visitor page.",
    "بجانب رمز QR الذي يفتح صفحة الزائر.",
  ],
  ["print", [], "Print button", "زر الطباعة", "Shown when the kiosk prints tickets.", "يظهر حين يطبع الجهاز التذاكر.", 60],
  ["done", [], "Done button", "زر تم", "Returns to the first screen.", "يعيد إلى الشاشة الأولى.", 60],
  [
    "returning",
    ["seconds"],
    "Returning-to-start line",
    "سطر العودة إلى البداية",
    "Use {seconds} for the countdown.",
    "استخدم {seconds} للعدّ التنازلي.",
  ],
  [
    "duplicate",
    ["number"],
    "Duplicate ticket notice",
    "تنبيه وجود تذكرة سابقة",
    "Shown when the visitor already has a waiting ticket.",
    "يظهر حين يكون للزائر تذكرة منتظِرة بالفعل.",
  ],
];

const K_MESSAGES: Row[] = [
  ["loading", [], "Loading message", "رسالة التحميل", "While the kiosk loads its services.", "أثناء تحميل الخدمات.", 60],
  [
    "unavailableTitle",
    [],
    "Unavailable title",
    "عنوان غير متاح",
    "When self check-in is off or no service is offered.",
    "حين يكون التسجيل الذاتي متوقفاً أو لا توجد خدمات.",
  ],
  ["unavailableBody", [], "Unavailable text", "نص غير متاح", "Under the unavailable title.", "تحت عنوان غير متاح."],
  [
    "offlineTitle",
    [],
    "Offline title",
    "عنوان انقطاع الاتصال",
    "When the kiosk cannot reach the system.",
    "حين يتعذر الوصول إلى النظام.",
  ],
  ["offlineBody", [], "Offline text", "نص انقطاع الاتصال", "Under the offline title.", "تحت عنوان انقطاع الاتصال."],
  ["retry", [], "Retry button", "زر إعادة المحاولة", "On the offline screen.", "في شاشة انقطاع الاتصال.", 60],
  [
    "offlineBanner",
    [],
    "Unstable connection banner",
    "شريط عدم استقرار الاتصال",
    "Bottom banner on the first screen while the connection is poor.",
    "الشريط السفلي في الشاشة الأولى أثناء ضعف الاتصال.",
  ],
];

const K_ERRORS: Row[] = [
  [
    "networkError",
    [],
    "Network error",
    "خطأ في الاتصال",
    "Shown on the form when the system cannot be reached.",
    "يظهر في النموذج حين يتعذر الوصول إلى النظام.",
  ],
  ["queueFull", [], "Line is full", "الطابور ممتلئ", "Shown when the waiting limit is reached.", "يظهر حين يُبلغ حد الانتظار."],
  [
    "slowDown",
    [],
    "Too many attempts",
    "محاولات كثيرة",
    "Shown when the kiosk is used too quickly.",
    "يظهر عند الاستخدام السريع جداً.",
  ],
  [
    "askStaffError",
    [],
    "Service needs staff",
    "الخدمة تحتاج موظفاً",
    "Shown when a service cannot be taken alone.",
    "يظهر حين لا يمكن أخذ الخدمة بلا موظف.",
  ],
  [
    "invalidPhone",
    [],
    "Invalid phone",
    "رقم الهاتف غير صحيح",
    "Shown when the phone number does not look right.",
    "يظهر حين لا يبدو رقم الهاتف صحيحاً.",
  ],
  [
    "missingField",
    [],
    "Missing details",
    "بيانات ناقصة",
    "Shown when a required detail is empty.",
    "يظهر حين يُترك بيان مطلوب فارغاً.",
  ],
  ["genericError", [], "Other error", "خطأ آخر", "Shown for any other problem.", "يظهر لأي مشكلة أخرى."],
];

const VISIT = ["number", "branch"];
const V_PAGE: Row[] = [
  [
    "title",
    [],
    "Page title",
    "عنوان الصفحة",
    "The browser tab title and the label of the steps.",
    "عنوان تبويب المتصفح واسم الخطوات.",
    60,
  ],
  ["yourNumber", VISIT, "Your number caption", "عنوان رقمك", "Above the big ticket number.", "فوق رقم التذكرة الكبير.", 60],
  [
    "calledAs",
    [],
    "Called-as caption",
    "عنوان سيُنادى عليك بـ",
    "Shown when the branch calls by the last digits of the phone.",
    "يظهر حين ينادي الفرع بآخر أرقام الهاتف.",
    80,
  ],
  ["calledAsHint", [], "Called-as hint", "تلميح النداء بالأرقام", "Under the called-as digits.", "تحت أرقام النداء."],
  [
    "steps.waiting",
    [],
    "Step: waiting",
    "خطوة الانتظار",
    "First of the four progress steps.",
    "الأولى من خطوات التقدم الأربع.",
    30,
  ],
  ["steps.called", [], "Step: called", "خطوة النداء", "Second progress step.", "الخطوة الثانية.", 30],
  ["steps.serving", [], "Step: serving", "خطوة الخدمة", "Third progress step.", "الخطوة الثالثة.", 30],
  ["steps.done", [], "Step: done", "خطوة الانتهاء", "Last progress step.", "الخطوة الأخيرة.", 30],
  [
    "helpTitle",
    [],
    "Help heading",
    "عنوان طلب المساعدة",
    "Above the contact lines and links, when you add any.",
    "فوق وسائل التواصل والروابط إن أضفتها.",
    60,
  ],
  [
    "ahead",
    [],
    "People-ahead caption",
    "عنوان عدد من أمامك",
    "Caption of the number of people ahead.",
    "عنوان عدد من أمامك.",
    60,
  ],
  ["refresh", [], "Refresh button", "زر التحديث", "The small refresh button.", "زر التحديث الصغير.", 30],
  [
    "updatedAt",
    ["time"],
    "Last-updated line",
    "سطر آخر تحديث",
    "Use {time} for the time of the last update.",
    "استخدم {time} لوقت آخر تحديث.",
    60,
  ],
  [
    "refreshes",
    [],
    "Keep-this-page-open hint",
    "تلميح إبقاء الصفحة مفتوحة",
    "Bottom of the page: tells the visitor it updates by itself.",
    "أسفل الصفحة: يخبر الزائر أنها تتحدث تلقائياً.",
  ],
];

const STATUS_VARS = ["number", "branch", "ahead", "wait"];
const V_STATUS: Row[] = [
  ["waiting", STATUS_VARS, "Waiting", "حالة الانتظار", "While the visitor is waiting.", "أثناء انتظار الزائر."],
  [
    "waitingGroup",
    STATUS_VARS,
    "Waiting for a group",
    "الانتظار لمجموعة",
    "Waiting for a hall session with a group.",
    "انتظار جلسة قاعة مع مجموعة.",
  ],
  [
    "called",
    ["number", "branch", "desk"],
    "Called: go to desk",
    "تم النداء: التوجه إلى المكتب",
    "Shown when the turn comes; the desk name follows in large letters.",
    "يظهر عند حلول الدور؛ يليه اسم المكتب بخط كبير.",
  ],
  [
    "calledHall",
    ["number", "branch", "desk"],
    "Called: go to hall",
    "تم النداء: التوجه إلى القاعة",
    "Shown when the visitor's group is called to a hall.",
    "يظهر عند نداء مجموعة الزائر إلى القاعة.",
  ],
  [
    "serving",
    ["number", "desk"],
    "Being served",
    "قيد الخدمة",
    "While the visitor is being served at a desk.",
    "أثناء خدمة الزائر على المكتب.",
  ],
  [
    "servingHall",
    ["number", "hall"],
    "Being served in a hall",
    "قيد الخدمة في قاعة",
    "Use {hall} for the hall.",
    "استخدم {hall} للقاعة.",
  ],
  ["finished", ["number", "branch"], "Visit completed", "اكتملت الزيارة", "After the visit is completed.", "بعد اكتمال الزيارة."],
  [
    "onHold",
    ["number", "branch"],
    "Ticket on hold",
    "التذكرة معلّقة",
    "When an agent put the ticket on hold.",
    "حين يعلّق الموظف التذكرة.",
  ],
  [
    "cancelled",
    ["number", "branch"],
    "Ticket cancelled",
    "التذكرة ملغاة",
    "When the ticket was cancelled.",
    "حين تُلغى التذكرة.",
  ],
  [
    "noShow",
    ["number", "branch"],
    "Did not show up",
    "لم يحضر",
    "When the visitor was called and not there.",
    "حين نودي الزائر ولم يكن موجوداً.",
  ],
  [
    "notFound",
    [],
    "Ticket not found",
    "التذكرة غير موجودة",
    "When the link is wrong or the page is turned off. Uses the organization-wide wording.",
    "حين يكون الرابط خاطئاً أو الصفحة متوقفة. يُستخدم النص العام للمؤسسة.",
  ],
];

const V_UPDATES: Row[] = [
  [
    "updates.title",
    [],
    "Get-updates heading",
    "عنوان استلام التحديثات",
    "Heading of the box that asks for the phone number.",
    "عنوان صندوق طلب رقم الهاتف.",
  ],
  ["updates.phone", [], "Phone field label", "عنوان حقل الهاتف", "Label of the phone field.", "عنوان حقل الهاتف.", 60],
  ["updates.consent", [], "Consent text", "نص الموافقة", "Next to the checkbox the visitor ticks.", "بجانب خانة الموافقة."],
  [
    "updates.submit",
    [],
    "Submit button",
    "زر الإرسال",
    "The button that saves the phone number.",
    "الزر الذي يحفظ رقم الهاتف.",
    60,
  ],
  ["updates.done", [], "Saved message", "رسالة الحفظ", "After the phone number is saved.", "بعد حفظ رقم الهاتف."],
  [
    "updates.invalid",
    [],
    "Invalid phone message",
    "رسالة رقم غير صحيح",
    "When the number does not look right.",
    "حين لا يبدو الرقم صحيحاً.",
  ],
  ["updates.failed", [], "Could-not-save message", "رسالة تعذّر الحفظ", "When saving failed.", "حين يفشل الحفظ."],
];

const V_FEEDBACK: Row[] = [
  [
    "feedback.npsLow",
    [],
    "Recommendation: low end",
    "التوصية: الطرف الأدنى",
    "Under the 0-10 scale, left end. The questions themselves are set in Feedback.",
    "تحت مقياس 0-10 من الطرف الأدنى. الأسئلة نفسها تُضبط من التقييم.",
    60,
  ],
  [
    "feedback.npsHigh",
    [],
    "Recommendation: high end",
    "التوصية: الطرف الأعلى",
    "Under the 0-10 scale, right end.",
    "تحت مقياس 0-10 من الطرف الأعلى.",
    60,
  ],
  ["feedback.submit", [], "Send button", "زر الإرسال", "The button that sends the rating.", "الزر الذي يرسل التقييم.", 60],
  [
    "feedback.failed",
    [],
    "Could-not-send message",
    "رسالة تعذّر الإرسال",
    "When sending the rating failed.",
    "حين يفشل إرسال التقييم.",
  ],
  ["feedback.scores.1", [], "Score 1", "الدرجة 1", "Name of the lowest score.", "اسم أدنى درجة.", 40],
  ["feedback.scores.2", [], "Score 2", "الدرجة 2", "Name of score 2.", "اسم الدرجة 2.", 40],
  ["feedback.scores.3", [], "Score 3", "الدرجة 3", "Name of score 3.", "اسم الدرجة 3.", 40],
  ["feedback.scores.4", [], "Score 4", "الدرجة 4", "Name of score 4.", "اسم الدرجة 4.", 40],
  ["feedback.scores.5", [], "Score 5", "الدرجة 5", "Name of the highest score.", "اسم أعلى درجة.", 40],
];

const V_STOP: Row[] = [
  [
    "stop.title",
    [],
    "Stop heading",
    "عنوان إيقاف الرسائل",
    "Heading of the page behind the stop link in messages.",
    "عنوان الصفحة خلف رابط الإيقاف في الرسائل.",
    80,
  ],
  ["stop.question", [], "Stop question", "سؤال الإيقاف", "Asks the visitor to confirm.", "يطلب من الزائر التأكيد."],
  ["stop.confirm", [], "Confirm button", "زر التأكيد", "The button that stops the messages.", "الزر الذي يوقف الرسائل.", 60],
  ["stop.done", [], "Stopped message", "رسالة تم الإيقاف", "After messages were stopped.", "بعد إيقاف الرسائل."],
  [
    "stop.invalid",
    [],
    "Invalid link message",
    "رسالة رابط غير صالح",
    "When the link is wrong or expired.",
    "حين يكون الرابط خاطئاً أو منتهياً.",
  ],
  ["stop.failed", [], "Error message", "رسالة الخطأ", "When stopping failed.", "حين يفشل الإيقاف."],
];

export const CATALOG: readonly CatalogEntry[] = [
  ...entries("kiosk", "home", K_HOME),
  ...entries("kiosk", "form", K_FORM),
  ...entries("kiosk", "result", K_RESULT),
  ...entries("kiosk", "messages", K_MESSAGES),
  ...entries("kiosk", "errors", K_ERRORS),
  ...entries("visitor", "page", V_PAGE),
  ...entries("visitor", "status", V_STATUS),
  ...entries("visitor", "updates", V_UPDATES),
  ...entries("visitor", "feedback", V_FEEDBACK),
  ...entries("visitor", "stop", V_STOP),
];

const BY_GROUP: Record<PageGroup, Map<string, CatalogEntry>> = {
  kiosk: new Map(CATALOG.filter((e) => e.group === "kiosk").map((e) => [e.id, e])),
  visitor: new Map(CATALOG.filter((e) => e.group === "visitor").map((e) => [e.id, e])),
};

export const catalogEntry = (group: PageGroup, id: string): CatalogEntry | undefined => BY_GROUP[group].get(id);
export const catalogOf = (group: PageGroup): CatalogEntry[] => CATALOG.filter((e) => e.group === group);
export const isRetired = (group: PageGroup, id: string): boolean => RETIRED_IDS[group].includes(id);
