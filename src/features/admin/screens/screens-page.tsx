"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/admin/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AnnouncementsTab } from "./announcements-tab";
import { ScreensTab } from "./screens-tab";
import { VoiceTab } from "./voice-tab";

export function ScreensPage({
  canAnnouncements,
  canSettings,
  canTemplates,
}: {
  canAnnouncements: boolean;
  canSettings: boolean;
  canTemplates: boolean;
}) {
  const t = useTranslations("screens");
  const showVoice = canSettings || canTemplates;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="screens">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="screens">{t("tabs.screens")}</TabsTrigger>
          {canAnnouncements && <TabsTrigger value="announcements">{t("tabs.announcements")}</TabsTrigger>}
          {showVoice && <TabsTrigger value="voice">{t("tabs.voice")}</TabsTrigger>}
        </TabsList>
        <TabsContent value="screens" className="mt-4">
          <ScreensTab />
        </TabsContent>
        {canAnnouncements && (
          <TabsContent value="announcements" className="mt-4">
            <AnnouncementsTab />
          </TabsContent>
        )}
        {showVoice && (
          <TabsContent value="voice" className="mt-4">
            <VoiceTab canSettings={canSettings} canTemplates={canTemplates} />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
