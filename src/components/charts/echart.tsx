"use client";

import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import * as echarts from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

echarts.use([
  LineChart,
  BarChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  SVGRenderer,
]);

/**
 * Validated categorical palette (fixed order, never cycled) and chart chrome. Values from the data-viz
 * reference palette; first four slots pass CVD / normal-vision checks for adjacent pairs in light and dark.
 */
export const CHART_THEME = {
  light: {
    series: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
    surface: "#fcfcfb",
    text: "#0b0b0b",
    textSecondary: "#52514e",
    muted: "#898781",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
  },
  dark: {
    series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
    surface: "#1a1a19",
    text: "#ffffff",
    textSecondary: "#c3c2b7",
    muted: "#898781",
    grid: "#2c2c2a",
    axis: "#383835",
  },
} as const;

export type ChartTheme = (typeof CHART_THEME)["light"];

/** Base option pieces shared by all charts: recessive grid and axes, text-token ink, tooltip styling. */
export function baseOption(t: ChartTheme, fontFamily = "inherit") {
  return {
    backgroundColor: "transparent",
    textStyle: { fontFamily, color: t.textSecondary },
    grid: { left: 8, right: 16, top: 36, bottom: 8, containLabel: true },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.axis,
      textStyle: { color: t.text, fontFamily },
      extraCssText: "box-shadow: 0 4px 16px rgba(0,0,0,.12); border-radius: 8px;",
    },
    legend: { top: 0, icon: "roundRect", itemWidth: 12, itemHeight: 12, textStyle: { color: t.textSecondary } },
  };
}

export function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted },
    splitLine: { lineStyle: { color: t.grid, width: 1 } },
  };
}

/** Thin React wrapper around ECharts (SVG renderer: crisp on 4K screens and in print). */
export function EChart({
  option,
  height = 280,
  ariaLabel,
}: {
  option: echarts.EChartsCoreOption;
  height?: number;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: "svg" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    // Text must be measured with the real page font (Arabic glyph widths differ a lot from the default sans).
    const fontFamily = ref.current ? getComputedStyle(ref.current).fontFamily : undefined;
    const base = option as { textStyle?: Record<string, unknown> };
    chart.current?.setOption({ ...option, textStyle: { ...base.textStyle, fontFamily } }, { notMerge: true });
  }, [option]);

  // Charts keep a left-to-right time/number axis in both languages; labels are localized.
  return <div ref={ref} dir="ltr" role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
}
