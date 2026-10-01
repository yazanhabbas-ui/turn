"use client";

import { useQuery } from "@tanstack/react-query";
import { BellRing, Check, Maximize2, Minimize2, Moon, Sun } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApiMutation } from "@/components/admin/use-api";
import { Button } from "@/components/ui/button";
import { pickText } from "@/i18n/locales";
import { brandBackground, logoForTheme } from "@/domain/branding/surface-theme";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { ConnectionPill } from "@/features/queue/bits";
import { useLiveQuery } from "@/features/queue/use-queue";

type L = Record<string, string>;
type Live = {
  now: string;
  branch: { id: string; name: L; timezone: string };
  branding: { companyName: L; logoUrl: string | null; logoDarkUrl?: string | null; primaryColor: string; accentColor: string };
  wallboard: {
    theme: "dark" | "light" | "brand";
    title: L;
    showLogo: boolean;
    showCompanyName: boolean;
    showBranch: boolean;
    showClock: boolean;
    showCsat?: boolean;
    textScale: number;
  };
  tiles: {
    waiting: number;
    longestWaitMin: number;
    called: number;
    serving: number;
    onHold: number;
    agentsAvailable: number;
    agentsBusy: number;
    agentsOnBreak: number;
    agentsOffline: number;
    servedToday: number;
    noShowToday: number;
    avgWaitTodayMin: number;
    slaTodayPct: number;
    visitorsToday: number;
    csat?: { avg: number | null; responses: number; satisfiedPct: number } | null;
  };
  desks: {
    id: string;
    number: string;
    name: L | null;
    zone: string | null;
    agent: { id: string; name: L; status: string; statusSinceMin: number } | null;
    ticket: { displayNumber: string; status: string; reasonId: string; minutes: number } | null;
    tickets: { displayNumber: string; status: string; reasonId: string; minutes: number }[];
  }[];
  /** Halls with their live group (D62); empty when halls are off or the branch has none. */
  halls?: {
    id: string;
    number: string;
    name: L;
    capacity: number;
    state: "free" | "called" | "in_session";
    host: { id: string; name: L; status: string } | null;
    occupied: number;
    visitors: { displayNumber: string; status: "CALLED" | "ENTERED" }[];
    sessionMin: number | null;
  }[];
  reasons: {
    id: string;
    name: L;
    color: string;
    waiting: number;
    longestWaitMin: number;
    slaMinutes: number;
    overSla: boolean;
  }[];
  longWaits: { ticketId: string; displayNumber: string; reasonId: string; waitMin: number }[];
  thresholds: { longWaitMinutes: number; queueLimit: number };
  alerts: { id: string; type: string; severity: string; payload: Record<string, unknown>; createdAt: string }[];
};
type Meta = { meta?: { branches?: { id: string; name: L }[] } };

const KNOWN_ALERTS = ["long_wait", "queue_over_limit", "agent_idle", "no_show_spike", "low_score", "low_satisfaction"];
const LIVE = "/api/v1/reports/live";

/** Palette per theme: the wallboard is dark by default (TV distance) with a light option. */
const THEME = {
  dark: {
    root: "bg-slate-950 text-slate-100",
    card: "bg-slate-900 border-slate-800",
    divider: "border-slate-800",
    muted: "text-slate-400",
    track: "bg-slate-800",
    ok: "text-emerald-400",
    warn: "text-amber-400",
    bad: "text-red-400",
    badBox: "border-red-500/60 bg-red-950/50",
    warnBox: "border-amber-500/60 bg-amber-950/40",
    empty: "border-slate-700 text-slate-500",
  },
  // Dark tinted with the primary brand colour (CSS variable --wb-primary set on the root).
  brand: {
    root: "text-slate-100",
    card: "border-[color-mix(in_srgb,var(--wb-primary)_40%,#1e293b)] bg-[color-mix(in_srgb,var(--wb-primary)_16%,#0a0f1c)]",
    divider: "border-[color-mix(in_srgb,var(--wb-primary)_30%,#1e293b)]",
    muted: "text-slate-300",
    track: "bg-[color-mix(in_srgb,var(--wb-primary)_25%,#0a0f1c)]",
    ok: "text-emerald-300",
    warn: "text-amber-300",
    bad: "text-red-300",
    badBox: "border-red-500/60 bg-red-950/60",
    warnBox: "border-amber-500/60 bg-amber-950/50",
    empty: "border-[color-mix(in_srgb,var(--wb-primary)_40%,#334155)] text-slate-400",
  },
  light: {
    root: "bg-slate-100 text-slate-900",
    card: "bg-white border-slate-200",
    divider: "border-slate-200",
    muted: "text-slate-500",
    track: "bg-slate-200",
    ok: "text-emerald-600",
    warn: "text-amber-600",
    bad: "text-red-600",
    badBox: "border-red-400 bg-red-50",
    warnBox: "border-amber-400 bg-amber-50",
    empty: "border-slate-300 text-slate-400",
  },
};
type Theme = typeof THEME.dark;
const ACCENT = { borderColor: "var(--wb-primary)" } as const;

function Clock({ timezone, locale, tick, muted }: { timezone: string; locale: string; tick: number; muted: string }) {
  const at = new Date(tick);
  const time = new Intl.DateTimeFormat(locale, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(at);
  const date = new Intl.DateTimeFormat(locale, { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(at);
  return (
    <div className="text-end leading-tight">
      <div className="tabular text-xl font-bold 2xl:text-4xl" dir="ltr">
        {time}
      </div>
      <div className={cn("text-xs 2xl:text-lg", muted)}>{date}</div>
    </div>
  );
}
type Level = "ok" | "warn" | "bad";
const level = (value: number, limit: number): Level => (value >= limit ? "bad" : value >= limit * 0.8 ? "warn" : "ok");
const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-emerald-500",
  BUSY: "bg-blue-500",
  ON_BREAK: "bg-amber-500",
  AWAY: "bg-slate-500",
  OFFLINE: "bg-slate-500",
};

function chime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 660].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.25);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.25 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.25 + 0.4);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.25);
      o.stop(ctx.currentTime + i * 0.25 + 0.45);
    });
    setTimeout(() => void ctx.close(), 1200);
  } catch {
    /* audio is optional */
  }
}

export function Wallboard({ canAck }: { canAck: boolean }) {
  const t = useTranslations("wallboard");
  const locale = useLocale();
  const format = useFormatter();
  const rootRef = useRef<HTMLDivElement>(null);
  // A person at the screen can flip dark/light for themselves; otherwise the organization's wallboard theme applies.
  const [pref, setPref] = useState<"dark" | "light" | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  // 0 until mounted: the server render must not depend on the current time (it would differ from the browser).
  const [tick, setTick] = useState(0);
  const name = useCallback((v: L | null | undefined) => pickText(v, locale, ""), [locale]);

  useEffect(() => {
    try {
      const v = localStorage.getItem("wallboard-theme");
      if (v === "light" || v === "dark") setPref(v);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const today = new Date().toISOString().slice(0, 10);
  const branches = useQuery<Meta>({
    queryKey: ["wallboard-branches", today],
    queryFn: () => api<Meta>(`/api/v1/reports/overview?from=${today}&to=${today}`),
    retry: false,
    staleTime: 10 * 60_000,
  });

  const live = useLiveQuery<Live>(["wallboard", branchId], branchId ? `${LIVE}?branchId=${branchId}` : LIVE, branchId);
  const data = live.data;
  const configured = data?.wallboard.theme ?? "dark";
  const theme: keyof typeof THEME =
    pref === "light" ? "light" : pref === "dark" ? (configured === "brand" ? "brand" : "dark") : configured;
  const dark = theme !== "light";
  const th = THEME[theme];
  const wb = data?.wallboard;
  const brand = data?.branding;
  const toggleTheme = () => {
    const next = dark ? "light" : "dark";
    try {
      localStorage.setItem("wallboard-theme", next);
    } catch {
      /* storage unavailable */
    }
    setPref(next);
  };
  useEffect(() => {
    if (!branchId && data) setBranchId(data.branch.id);
  }, [branchId, data]);

  // One-second heartbeat for the "updated Ns ago" indicator and relative alert times.
  useEffect(() => {
    setTick(Date.now());
    const i = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Autoplay policy: only chime once the user has interacted with the page.
  const interacted = useRef(false);
  useEffect(() => {
    const mark = () => {
      interacted.current = true;
    };
    window.addEventListener("pointerdown", mark);
    window.addEventListener("keydown", mark);
    return () => {
      window.removeEventListener("pointerdown", mark);
      window.removeEventListener("keydown", mark);
    };
  }, []);

  // New alert: flash always, chime when allowed.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = new Set(data.alerts.map((a) => a.id));
    if (seen.current && data.alerts.some((a) => !seen.current!.has(a.id))) {
      setFlash(true);
      if (interacted.current) chime();
      setTimeout(() => setFlash(false), 3000);
    }
    seen.current = ids;
  }, [data]);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void rootRef.current?.requestFullscreen?.();
  }, []);
  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const typing = tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA";
      if (e.key.toLowerCase() === "f" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) toggleFullscreen();
    };
    document.addEventListener("fullscreenchange", onFs);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", onFs);
      window.removeEventListener("keydown", onKey);
    };
  }, [toggleFullscreen]);

  const ack = useApiMutation((id: string) => api(`/api/v1/alerts/${id}/ack`, { method: "POST", body: {} }), {
    invalidate: [["wallboard", branchId]],
  });

  const reasonById = useMemo(() => new Map((data?.reasons ?? []).map((r) => [r.id, r])), [data]);
  const secondsAgo = tick && live.dataUpdatedAt ? Math.max(0, Math.round((tick - live.dataUpdatedAt) / 1000)) : 0;
  const branchList = branches.data?.meta?.branches ?? [];
  const waitingReasons = (data?.reasons ?? []).filter((r) => r.waiting > 0);
  const maxWaiting = Math.max(1, ...waitingReasons.map((r) => r.waiting));

  const alertText = (a: Live["alerts"][number]) => {
    const p = a.payload as Record<string, string | number>;
    const type = KNOWN_ALERTS.includes(a.type) ? a.type : "unknown";
    return t(`alertMessages.${type}`, {
      displayNumber: String(p.displayNumber ?? ""),
      waitMin: Math.round(Number(p.waitMin ?? 0)),
      limit: Number(p.limit ?? 0),
      waiting: Number(p.waiting ?? 0),
      idleMin: Math.round(Number(p.idleMin ?? 0)),
      count: Number(p.count ?? 0),
      windowMinutes: Number(p.windowMinutes ?? 0),
      score: Number(p.score ?? 0),
      avg: Number(p.avg ?? 0),
      responses: Number(p.responses ?? 0),
      windowHours: Number(p.windowHours ?? 0),
    });
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "min-h-[calc(100dvh-4rem)] overflow-auto rounded-xl p-3 transition-shadow md:p-5 2xl:p-8",
        th.root,
        theme === "light" ? "" : "bg-slate-950",
        fullscreen && "min-h-dvh rounded-none",
        flash && "ring-4 ring-red-500 ring-inset",
      )}
      style={
        {
          "--wb-primary": brand?.primaryColor ?? "#0f766e",
          "--wb-accent": brand?.accentColor ?? "#b45309",
          zoom: (wb?.textScale ?? 100) / 100,
          ...(theme === "brand" ? { backgroundColor: brandBackground("--wb-primary") } : {}),
        } as React.CSSProperties
      }
    >
      <header className="mb-4 flex flex-wrap items-center gap-3">
        {wb?.showLogo !== false && brand && logoForTheme(theme, brand) && (
          // eslint-disable-next-line @next/next/no-img-element -- the organization's own logo, size unknown
          <img
            src={logoForTheme(theme, brand) ?? undefined}
            alt=""
            className="h-10 max-w-[14rem] object-contain md:h-14 2xl:h-20"
          />
        )}
        <div className="min-w-0">
          {wb?.showCompanyName !== false && brand && (
            <div className={cn("truncate text-sm 2xl:text-xl", th.muted)}>{name(brand.companyName)}</div>
          )}
          <h1 className="text-xl font-bold md:text-2xl 2xl:text-4xl">{name(wb?.title) || t("title")}</h1>
        </div>
        {branchList.length > 1 ? (
          <select
            aria-label={t("branch")}
            value={branchId ?? ""}
            onChange={(e) => setBranchId(e.target.value)}
            className={cn("rounded-md border px-2 py-1 text-sm 2xl:text-lg", th.card)}
          >
            {branchList.map((b) => (
              <option key={b.id} value={b.id}>
                {name(b.name)}
              </option>
            ))}
          </select>
        ) : (
          data &&
          wb?.showBranch !== false && <span className={cn("text-lg 2xl:text-2xl", th.muted)}>{name(data.branch.name)}</span>
        )}
        <div className="ms-auto flex items-center gap-2">
          {data && wb?.showClock !== false && (
            <Clock timezone={data.branch.timezone} locale={locale} tick={tick} muted={th.muted} />
          )}
          <span className={cn("tabular text-sm 2xl:text-lg", th.muted)}>{t("updatedAgo", { seconds: secondsAgo })}</span>
          <ConnectionPill state={live.connection} />
          <Button
            variant="outline"
            size="icon"
            className={
              dark ? "border-neutral-600 bg-transparent text-neutral-100 hover:bg-neutral-800 hover:text-white" : undefined
            }
            onClick={toggleTheme}
            aria-label={dark ? t("lightTheme") : t("darkTheme")}
          >
            {dark ? <Sun aria-hidden /> : <Moon aria-hidden />}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={
              dark ? "border-neutral-600 bg-transparent text-neutral-100 hover:bg-neutral-800 hover:text-white" : undefined
            }
            onClick={toggleFullscreen}
            aria-keyshortcuts="F"
          >
            {fullscreen ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
            {fullscreen ? t("exitFullscreen") : t("fullscreen")}
          </Button>
        </div>
      </header>

      {!data ? (
        <p className={cn("mt-20 text-center text-xl", th.muted)}>{live.isError ? t("loadFailed") : t("loading")}</p>
      ) : (
        <div className="space-y-4">
          <Tiles data={data} th={th} />
          <div className="grid gap-4 xl:grid-cols-3">
            <section className={cn("rounded-xl border p-4 xl:col-span-2", th.card)}>
              <h2 className="mb-3 border-s-4 ps-2 text-lg font-semibold 2xl:text-2xl" style={ACCENT}>
                {t("desks")}
              </h2>
              {data.desks.length === 0 ? (
                <p className={th.muted}>{t("noDesks")}</p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                  {data.desks.map((d) => (
                    <DeskCard key={d.id} desk={d} th={th} reasonById={reasonById} name={name} />
                  ))}
                </div>
              )}
            </section>
            <div className="space-y-4">
              {data.halls && data.halls.length > 0 && (
                <section className={cn("rounded-xl border p-4", th.card)}>
                  <h2 className="mb-3 border-s-4 ps-2 text-lg font-semibold 2xl:text-2xl" style={ACCENT}>
                    {t("halls")}
                  </h2>
                  <div className="space-y-3">
                    {data.halls.map((h) => (
                      <HallCard key={h.id} hall={h} th={th} name={name} />
                    ))}
                  </div>
                </section>
              )}
              <section className={cn("rounded-xl border p-4", th.card)}>
                <div className="mb-3 flex items-center gap-2">
                  <BellRing className="size-5" aria-hidden />
                  <h2 className="text-lg font-semibold 2xl:text-2xl">{t("alerts")}</h2>
                </div>
                {data.alerts.length === 0 ? (
                  <p className={th.muted}>{t("noAlerts")}</p>
                ) : (
                  <ul className="space-y-2">
                    {data.alerts.map((a) => (
                      <li
                        key={a.id}
                        className={cn(
                          "flex items-start gap-3 rounded-lg border p-3",
                          a.severity === "critical" || a.severity === "high" ? th.badBox : th.warnBox,
                        )}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold 2xl:text-xl">{alertText(a)}</p>
                          <p className={cn("text-xs 2xl:text-base", th.muted)}>
                            {format.relativeTime(new Date(a.createdAt), tick)}
                          </p>
                        </div>
                        {canAck && (
                          <Button
                            size="sm"
                            variant="outline"
                            className={
                              dark
                                ? "border-neutral-600 bg-transparent text-neutral-100 hover:bg-neutral-800 hover:text-white"
                                : undefined
                            }
                            disabled={ack.isPending}
                            onClick={() => ack.mutate(a.id)}
                          >
                            <Check aria-hidden />
                            {t("acknowledge")}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className={cn("rounded-xl border p-4", th.card)}>
                <h2 className="mb-3 border-s-4 ps-2 text-lg font-semibold 2xl:text-2xl" style={ACCENT}>
                  {t("byReason")}
                </h2>
                {waitingReasons.length === 0 ? (
                  <p className={th.muted}>{t("nobodyWaiting")}</p>
                ) : (
                  <ul className="space-y-3">
                    {waitingReasons.map((r) => (
                      <li key={r.id}>
                        <div className="mb-1 flex items-baseline justify-between gap-2">
                          <span className="truncate font-medium 2xl:text-xl">{name(r.name)}</span>
                          <span className="tabular shrink-0 text-lg font-bold 2xl:text-3xl">{r.waiting}</span>
                        </div>
                        <div className={cn("h-3 overflow-hidden rounded-full", th.track)}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${(r.waiting / maxWaiting) * 100}%`,
                              backgroundColor: r.overSla ? "#dc2626" : r.color,
                            }}
                          />
                        </div>
                        <div className={cn("mt-1 text-sm 2xl:text-lg", r.overSla ? cn(th.bad, "font-semibold") : th.muted)}>
                          {t("longestWait", { min: Math.round(r.longestWaitMin) })}
                          {r.overSla && ` · ${t("overSla", { min: r.slaMinutes })}`}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              <section className={cn("rounded-xl border p-4", th.card)}>
                <h2 className="mb-3 border-s-4 ps-2 text-lg font-semibold 2xl:text-2xl" style={ACCENT}>
                  {t("longWaits")}
                </h2>
                {data.longWaits.length === 0 ? (
                  <p className={th.muted}>{t("noLongWaits")}</p>
                ) : (
                  <ul className="grid grid-cols-2 gap-2">
                    {data.longWaits.map((w) => (
                      <li
                        key={w.ticketId}
                        className={cn("flex items-baseline justify-between rounded-lg border px-3 py-2", th.badBox)}
                      >
                        <span className="tabular text-xl font-bold 2xl:text-3xl" dir="ltr">
                          {w.displayNumber}
                        </span>
                        <span className={cn("tabular font-semibold 2xl:text-xl", th.bad)}>
                          {t("minutes", { min: Math.round(w.waitMin) })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({
  label,
  value,
  unit,
  tone,
  th,
}: {
  label: string;
  value: string | number;
  unit?: string;
  tone?: Level;
  th: Theme;
}) {
  return (
    <div
      className={cn("rounded-xl border p-3 2xl:p-5", tone === "bad" ? th.badBox : tone === "warn" ? th.warnBox : th.card)}
      style={!tone || tone === "ok" ? { borderTopWidth: 3, borderTopColor: "var(--wb-primary)" } : undefined}
    >
      <div className={cn("text-xs font-medium 2xl:text-lg", th.muted)}>{label}</div>
      <div className={cn("tabular mt-1 text-3xl leading-none font-bold 2xl:text-6xl", tone && tone !== "ok" && th[tone])}>
        {value}
        {unit && <span className={cn("ms-1 text-base font-medium 2xl:text-2xl", th.muted)}>{unit}</span>}
      </div>
    </div>
  );
}

function Tiles({ data, th }: { data: Live; th: Theme }) {
  const t = useTranslations("wallboard");
  const { tiles: x, thresholds } = data;
  const sla = x.slaTodayPct;
  const anyCalled = x.servedToday + x.called + x.serving > 0;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
      <Tile
        th={th}
        label={t("tiles.waiting")}
        value={x.waiting}
        tone={x.waiting >= thresholds.queueLimit ? "bad" : level(x.waiting, thresholds.queueLimit)}
      />
      <Tile
        th={th}
        label={t("tiles.longestWait")}
        value={Math.round(x.longestWaitMin)}
        unit={t("min")}
        tone={level(x.longestWaitMin, thresholds.longWaitMinutes)}
      />
      <Tile th={th} label={t("tiles.agentsAvailable")} value={x.agentsAvailable} />
      <Tile th={th} label={t("tiles.agentsBusy")} value={x.agentsBusy} />
      <Tile th={th} label={t("tiles.agentsOnBreak")} value={x.agentsOnBreak} />
      <Tile th={th} label={t("tiles.agentsOffline")} value={x.agentsOffline} />
      <Tile th={th} label={t("tiles.served")} value={x.servedToday} />
      <Tile th={th} label={t("tiles.noShow")} value={x.noShowToday} />
      <Tile th={th} label={t("tiles.called")} value={x.called + x.serving} />
      <Tile th={th} label={t("tiles.onHold")} value={x.onHold} />
      <Tile th={th} label={t("tiles.avgWait")} value={Math.round(x.avgWaitTodayMin)} unit={t("min")} />
      <Tile
        th={th}
        label={t("tiles.sla")}
        value={Math.round(sla)}
        unit="%"
        tone={!anyCalled ? undefined : sla >= 80 ? "ok" : sla >= 60 ? "warn" : "bad"}
      />
      {x.csat && (
        <Tile
          th={th}
          label={t("tiles.csat")}
          value={x.csat.avg === null ? "–" : x.csat.avg.toFixed(1)}
          unit={x.csat.avg === null ? undefined : "/ 5"}
          tone={x.csat.avg === null ? undefined : x.csat.avg >= 4 ? "ok" : x.csat.avg >= 3 ? "warn" : "bad"}
        />
      )}
    </div>
  );
}

function DeskCard({
  desk,
  th,
  reasonById,
  name,
}: {
  desk: Live["desks"][number];
  th: Theme;
  reasonById: Map<string, Live["reasons"][number]>;
  name: (v: L | null | undefined) => string;
}) {
  const t = useTranslations("wallboard");
  const ts = useTranslations("agentStatus");
  const tt = useTranslations("ticketStatus");
  const { agent } = desk;
  const order: Level[] = ["ok", "warn", "bad"];
  const tone: Level = desk.tickets.reduce<Level>((worst, tk) => {
    const limit = reasonById.get(tk.reasonId)?.slaMinutes;
    const l = limit ? level(tk.minutes, limit) : "ok";
    return order.indexOf(l) > order.indexOf(worst) ? l : worst;
  }, "ok");
  if (!agent) {
    return (
      <div className={cn("flex min-h-28 items-center justify-between rounded-xl border-2 border-dashed p-4", th.empty)}>
        <span className="tabular text-3xl font-bold 2xl:text-5xl">{desk.number}</span>
        <span className="text-sm 2xl:text-xl">{t("deskEmpty")}</span>
      </div>
    );
  }
  return (
    <div className={cn("rounded-xl border p-4", tone === "bad" ? th.badBox : tone === "warn" ? th.warnBox : th.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("text-xs 2xl:text-base", th.muted)}>{t("desk", { number: desk.number })}</div>
          <div className="truncate font-semibold 2xl:text-2xl">{name(agent.name)}</div>
          <div className={cn("mt-0.5 flex items-center gap-1.5 text-xs 2xl:text-lg", th.muted)}>
            <span className={cn("size-2.5 rounded-full", STATUS_DOT[agent.status] ?? "bg-slate-500")} aria-hidden />
            {ts.has(agent.status) ? ts(agent.status) : agent.status} · {t("minutes", { min: Math.round(agent.statusSinceMin) })}
          </div>
        </div>
        <span className="tabular text-3xl font-bold 2xl:text-5xl">{desk.number}</span>
      </div>
      <div className={cn("mt-3 space-y-2 border-t pt-3", th.divider)}>
        {desk.tickets.length ? (
          desk.tickets.map((tk) => {
            const tkSla = reasonById.get(tk.reasonId)?.slaMinutes;
            const tkTone: Level = tkSla ? level(tk.minutes, tkSla) : "ok";
            return (
              <div key={tk.displayNumber} className="flex items-baseline justify-between gap-2">
                <div>
                  <span className="tabular text-2xl font-bold 2xl:text-4xl" dir="ltr">
                    {tk.displayNumber}
                  </span>
                  <span className={cn("ms-2 text-xs 2xl:text-lg", th.muted)}>
                    {tt.has(tk.status) ? tt(tk.status) : tk.status}
                  </span>
                </div>
                <span className={cn("tabular text-lg font-semibold 2xl:text-3xl", tkTone !== "ok" && th[tkTone])}>
                  {t("minutes", { min: Math.round(tk.minutes) })}
                </span>
              </div>
            );
          })
        ) : (
          <span className={cn("text-sm 2xl:text-xl", th.muted)}>{t("noTicket")}</span>
        )}
      </div>
    </div>
  );
}

function HallCard({
  hall,
  th,
  name,
}: {
  hall: NonNullable<Live["halls"]>[number];
  th: Theme;
  name: (v: L | null | undefined) => string;
}) {
  const t = useTranslations("wallboard");
  const pct = hall.capacity > 0 ? Math.min(100, Math.round((hall.occupied / hall.capacity) * 100)) : 0;
  const stateLabel = hall.state === "free" ? t("hallFree") : hall.state === "called" ? t("hallCalled") : t("hallInSession");
  return (
    <div className={cn("rounded-xl border p-4", hall.state === "free" ? th.empty : th.card)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className={cn("text-xs 2xl:text-base", th.muted)}>{t("hall", { number: hall.number })}</div>
          <div className="truncate font-semibold 2xl:text-2xl">{name(hall.name)}</div>
          <div className={cn("mt-0.5 text-xs 2xl:text-lg", th.muted)}>
            {hall.host ? t("hallHost", { name: name(hall.host.name) }) : t("hallNoHost")}
          </div>
        </div>
        <div className="text-end">
          <div className={cn("text-sm font-semibold 2xl:text-xl", hall.state === "in_session" ? th.ok : hall.state === "called" ? th.warn : th.muted)}>
            {stateLabel}
          </div>
          <div className="tabular text-2xl font-bold 2xl:text-4xl">{t("hallOccupancy", { n: hall.occupied, capacity: hall.capacity })}</div>
        </div>
      </div>
      <div className={cn("mt-2 h-2 overflow-hidden rounded-full", th.track)} role="presentation">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--wb-primary)" }} />
      </div>
      {hall.visitors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {hall.visitors.map((v) => (
            <span
              key={v.displayNumber}
              dir="ltr"
              className={cn("tabular rounded-md border px-2 py-0.5 text-lg font-bold 2xl:text-3xl", th.divider, v.status === "CALLED" && th.warn)}
            >
              {v.displayNumber}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
