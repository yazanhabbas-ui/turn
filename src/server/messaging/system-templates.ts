type Loc = Record<string, string>;
export type SystemTemplate = { subject: Loc; body: Loc };

/**
 * Built-in wording for staff account emails. An organization's own template for the same event (Admin → Notifications)
 * wins; these only apply when none exists, so a new installation can send activation emails without any setup.
 */
export const SYSTEM_EMAIL_TEMPLATES: Record<string, SystemTemplate> = {
  activation: {
    subject: { ar: "فعّل حسابك في {company}", en: "Activate your {company} account" },
    body: {
      ar: "مرحباً {name}،\nتم إنشاء حساب لك في {company}. لتفعيل حسابك وتعيين كلمة المرور استخدم الرابط التالي (صالح حتى {expires}):\n{link}",
      en: "Hello {name},\nAn account has been created for you at {company}. To activate it and set your password, use this link (valid until {expires}):\n{link}",
    },
  },
  invite: {
    subject: { ar: "دعوة للانضمام إلى {company}", en: "Invitation to join {company}" },
    body: {
      ar: "مرحباً {name}،\nتمت دعوتك للانضمام كـ {role}. أنشئ كلمة المرور من الرابط التالي (صالح حتى {expires}):\n{link}",
      en: "Hello {name},\nYou have been invited to join as {role}. Set your password using this link (valid until {expires}):\n{link}",
    },
  },
  password_reset: {
    subject: { ar: "إعادة تعيين كلمة المرور", en: "Reset your password" },
    body: {
      ar: "مرحباً {name}،\nلتعيين كلمة مرور جديدة استخدم الرابط التالي (صالح حتى {expires}):\n{link}\nإذا لم تطلب ذلك فتواصل مع مسؤول النظام.",
      en: "Hello {name},\nUse this link to set a new password (valid until {expires}):\n{link}\nIf you did not expect this, contact your administrator.",
    },
  },
  signup_approved: {
    subject: { ar: "تمت الموافقة على حسابك في {company}", en: "Your {company} account was approved" },
    body: {
      ar: "مرحباً {name}،\nتمت الموافقة على طلبك للانضمام إلى {company}. يمكنك الآن تسجيل الدخول:\n{link}",
      en: "Hello {name},\nYour request to join {company} was approved. You can sign in now:\n{link}",
    },
  },
  signup_rejected: {
    subject: { ar: "بخصوص طلب حسابك في {company}", en: "About your {company} account request" },
    body: {
      ar: "مرحباً {name}،\nنأسف، لم تتم الموافقة على طلبك للانضمام إلى {company}.\nللاستفسار تواصل مع مسؤول النظام.",
      en: "Hello {name},\nWe are sorry, your request to join {company} was not approved.\nPlease contact your administrator if you have questions.",
    },
  },
};
