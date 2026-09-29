ALTER TABLE "report_schedules" ADD COLUMN "weekday" integer;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "send_hour" integer DEFAULT 7 NOT NULL;--> statement-breakpoint
ALTER TABLE "report_schedules" ADD COLUMN "last_error" text;--> statement-breakpoint
-- Email templates for scheduled reports and raised alerts, for organizations that already exist (new ones get them from the seed).
INSERT INTO "message_templates" ("organization_id", "channel", "event", "subject", "body")
SELECT o."id", 'email', 'report_scheduled',
  jsonb_build_object('ar', E'التقرير المجدول: {name} ({period})', 'en', E'Scheduled report: {name} ({period})'),
  jsonb_build_object(
    'ar', E'مرحباً،\nمرفق التقرير المجدول «{name}» عن الفترة {period} ({branch}).\nأُرسلت هذه الرسالة تلقائياً من نظام دور.',
    'en', E'Hello,\nAttached is the scheduled report "{name}" for {period} ({branch}).\nThis message was sent automatically by Dor.')
FROM "organizations" o
ON CONFLICT ("organization_id", "channel", "event") DO NOTHING;--> statement-breakpoint
INSERT INTO "message_templates" ("organization_id", "channel", "event", "subject", "body")
SELECT o."id", 'email', 'alert_raised',
  jsonb_build_object('ar', E'تنبيه من الطابور: {type} - {branch}', 'en', E'Queue alert: {type} - {branch}'),
  jsonb_build_object(
    'ar', E'مرحباً،\nتم رصد تنبيه في {branch}: {type}.\n{details}\nنرجو مراجعة العرض المباشر واتخاذ ما يلزم.',
    'en', E'Hello,\nAn alert was raised at {branch}: {type}.\n{details}\nPlease review the live view and take action if needed.')
FROM "organizations" o
ON CONFLICT ("organization_id", "channel", "event") DO NOTHING;
