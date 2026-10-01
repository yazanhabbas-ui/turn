"use client";

import { MonitorOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { T } from "./text";

/** First screen on a new TV: enter the code an administrator generated under Admin → Screens. */
export function Pairing({
  t,
  onPaired,
  endpoint = "/api/v1/public/display/pair",
}: {
  t: T;
  onPaired: (token: string) => void;
  /** Where the code is exchanged: the display's endpoint by default, the kiosk's for the self check-in tablet. */
  endpoint?: string;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tried = useRef(false);

  async function submit(value: string) {
    if (busy || value.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ token: string }>(endpoint, { body: { code: value } });
      onPaired(res.token);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? t("tooMany")
          : err instanceof ApiError && err.code === "not_found"
            ? t("invalidCode")
            : t("pairFailed"),
      );
      setBusy(false);
    }
  }

  // `/display?code=ABC123` (or `/kiosk?code=ABC123`) pairs without typing (handy when setting up a TV remotely).
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    const fromUrl = new URLSearchParams(window.location.search).get("code");
    if (fromUrl) {
      setCode(fromUrl.toUpperCase());
      void submit(fromUrl.toUpperCase());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="grid min-h-dvh place-items-center p-8 text-center">
      <form
        className="w-full max-w-xl"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(code);
        }}
      >
        <MonitorOff className="mx-auto size-24 text-neutral-500" aria-hidden />
        <h1 className="mt-8 text-5xl font-bold">{t("notPaired")}</h1>
        <p className="mt-4 text-2xl text-neutral-400">{t("pairHint")}</p>
        <label htmlFor="pair-code" className="mt-10 block text-xl text-neutral-300">
          {t("codeLabel")}
        </label>
        <input
          id="pair-code"
          dir="ltr"
          autoFocus
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={12}
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          className="mt-3 w-full rounded-2xl border-2 border-neutral-700 bg-neutral-900 px-6 py-5 text-center font-mono text-6xl tracking-[0.4em] text-white outline-none focus:border-amber-400"
        />
        {error && (
          <p role="alert" className="mt-4 text-xl text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || code.length < 4}
          className="bg-brand mt-8 w-full rounded-2xl px-8 py-5 text-3xl font-bold text-white disabled:opacity-50"
        >
          {busy ? t("pairing") : t("pair")}
        </button>
      </form>
    </div>
  );
}
