"use client";

import { useTranslations } from "next-intl";
import { PageHeader } from "@/components/admin/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChannelsTab } from "./channels-tab";
import { EventsTab } from "./events-tab";
import { LogTab } from "./log-tab";
import { TemplatesTab } from "./templates-tab";

/**
 * Admin → Notifications: which channels can send, which events go out on which channel, the wording of every message,
 * and the delivery log. City and branch admins see the branch-scoped parts; provider status, limits and templates
 * belong to the organization.
 */
export function NotificationsPage({ canOrganization, canTemplates }: { canOrganization: boolean; canTemplates: boolean }) {
  const t = useTranslations("notifications");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs defaultValue="channels">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="channels">{t("tabs.channels")}</TabsTrigger>
          <TabsTrigger value="events">{t("tabs.events")}</TabsTrigger>
          {canTemplates && <TabsTrigger value="templates">{t("tabs.templates")}</TabsTrigger>}
          <TabsTrigger value="log">{t("tabs.log")}</TabsTrigger>
        </TabsList>
        <TabsContent value="channels" className="mt-4">
          <ChannelsTab canTest={canOrganization} />
        </TabsContent>
        <TabsContent value="events" className="mt-4">
          <EventsTab organization={canOrganization} />
        </TabsContent>
        {canTemplates && (
          <TabsContent value="templates" className="mt-4">
            <TemplatesTab />
          </TabsContent>
        )}
        <TabsContent value="log" className="mt-4">
          <LogTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
