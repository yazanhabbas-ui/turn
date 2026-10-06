"use client";

import type { ECharts, EChartsCoreOption } from "echarts/core";
import { useTheme } from "next-themes";
import { useEffect, useRef } from "react";
import { darken } from "./echart-theme";
import { loadEcharts } from "./echarts-loader";

export { axisStyle, baseOption, CHART_THEME, type ChartTheme } from "./echart-theme";

/** Thin React wrapper around ECharts (SVG renderer: crisp on 4K screens and in print). The library loads on first use. */
export function EChart({ option, height = 280, ariaLabel }: { option: EChartsCoreOption; height?: number; ariaLabel: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const applied = useRef<{ option: EChartsCoreOption; dark: boolean }>({ option, dark });

  const render = (opt: EChartsCoreOption, asDark: boolean) => {
    // Text must be measured with the real page font (Arabic glyph widths differ a lot from the default sans).
    const fontFamily = ref.current ? getComputedStyle(ref.current).fontFamily : undefined;
    const base = opt as { textStyle?: Record<string, unknown> };
    const full = { ...opt, textStyle: { ...base.textStyle, fontFamily } };
    chart.current?.setOption(asDark ? darken(full) : full, { notMerge: true });
  };

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | undefined;
    loadEcharts().then((echarts) => {
      if (cancelled || !ref.current) return;
      chart.current = echarts.init(ref.current, undefined, { renderer: "svg" });
      ro = new ResizeObserver(() => chart.current?.resize());
      ro.observe(ref.current);
      render(applied.current.option, applied.current.dark);
    });
    return () => {
      cancelled = true;
      ro?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
     
  }, []);

  useEffect(() => {
    applied.current = { option, dark };
    render(option, dark);
     
  }, [option, dark]);

  // Printouts and PDFs stay light whatever the screen theme is.
  useEffect(() => {
    const before = () => render(applied.current.option, false);
    const after = () => render(applied.current.option, applied.current.dark);
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
    };
     
  }, []);

  // Charts keep a left-to-right time/number axis in both languages; labels are localized.
  return <div ref={ref} dir="ltr" role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
}
