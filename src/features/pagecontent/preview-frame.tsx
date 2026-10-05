"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Draws its children inside an iframe of the given size, scaled down to fit the width available. A frame has a
 * viewport of its own, so media queries (the kiosk's portrait layout) and viewport units behave exactly as on the
 * real device whatever the window of the editor looks like. The children are ordinary React children rendered into the
 * frame's document with a portal, so they share the editor's providers (messages, theme); the page's style sheets are
 * copied into the frame.
 */
export function PreviewFrame({
  width,
  height,
  lang,
  dir,
  title,
  children,
}: {
  width: number;
  height: number;
  lang: string;
  dir: "rtl" | "ltr";
  title: string;
  children: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState(width);

  const attach = useCallback(() => {
    const doc = frame.current?.contentDocument;
    if (!doc || !doc.body) return;
    if (doc.head.dataset.dorPreview !== "1") {
      doc.head.dataset.dorPreview = "1";
      for (const node of document.head.querySelectorAll('link[rel="stylesheet"], style'))
        doc.head.appendChild(node.cloneNode(true));
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.setAttribute("style", document.documentElement.getAttribute("style") ?? "");
      doc.body.className = document.body.className;
      doc.body.style.margin = "0";
    }
    setBody(doc.body);
  }, []);

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    attach();
    el.addEventListener("load", attach);
    return () => el.removeEventListener("load", attach);
  }, [attach]);

  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (!doc) return;
    doc.documentElement.lang = lang;
    doc.documentElement.dir = dir;
  }, [lang, dir, body]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setAvailable(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = Math.min(1, available / width || 1);
  return (
    // The frame is laid out left to right whatever the editor's direction; the page inside has its own direction.
    <div ref={box} dir="ltr" className="flex w-full justify-center">
      <div className="overflow-hidden rounded-xl border bg-black/5" style={{ width: width * scale, height: height * scale }}>
        <iframe
          ref={frame}
          title={title}
          tabIndex={-1}
          style={{ width, height, border: 0, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
        {body && createPortal(children, body)}
      </div>
    </div>
  );
}
