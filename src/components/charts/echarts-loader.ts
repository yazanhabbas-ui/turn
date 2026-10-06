/**
 * Loads ECharts on demand. The library is large (about 250 KB), so it is fetched as its own chunk the first time a
 * chart is shown instead of being part of every page that can contain one.
 */
let loading: Promise<typeof import("echarts/core")> | null = null;

export function loadEcharts() {
  loading ??= (async () => {
    const [core, charts, components, renderers] = await Promise.all([
      import("echarts/core"),
      import("echarts/charts"),
      import("echarts/components"),
      import("echarts/renderers"),
    ]);
    core.use([
      charts.LineChart,
      charts.BarChart,
      charts.HeatmapChart,
      components.GridComponent,
      components.TooltipComponent,
      components.LegendComponent,
      components.VisualMapComponent,
      renderers.SVGRenderer,
    ]);
    return core;
  })();
  return loading;
}
