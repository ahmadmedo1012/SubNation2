import { useEffect, useState } from "react";

/**
 * R115-A6 #7 — ONE chart color map for every recharts surface.
 *
 * dashboard.tsx / system.tsx used to hardcode theme-blind hexes
 * (#e11d48 rose, #10b981 emerald, #f59e0b amber, #3b82f6 blue,
 * #22d3ee cyan, #f87171 red, #22d3ee…) plus #6b7280 axis ticks,
 * rgba(255,255,255,0.04) grid lines and a near-black tooltip — none of
 * them follow the light theme (the grid literally vanished on white;
 * the tooltip stayed black).
 *
 * Colors are read from the document's CSS custom properties via
 * getComputedStyle and composed into concrete `hsl(...)` strings —
 * recharts passes stroke/fill straight to SVG presentation attributes,
 * where `var()` references do NOT resolve. The fallbacks are the :root
 * dark values so the map is safe in jsdom / pre-mount contexts.
 *
 * `useChartColors()` recomputes when the theme class flips on <html>
 * (MutationObserver — no ThemeProvider dependency), so a light/dark
 * toggle recolors mounted charts.
 */

export interface ChartColors {
  /** Primary series (revenue / request-rate) — was #e11d48. */
  primary: string;
  /** Success series — was #10b981. */
  success: string;
  /** Warning series — was #f59e0b. */
  warning: string;
  /** Info series — was #3b82f6 / #22d3ee. */
  info: string;
  /** Error series — was #f87171. */
  error: string;
  /** Axis tick text — was #6b7280. */
  muted: string;
  /** CartesianGrid lines — was rgba(255,255,255,0.04). */
  grid: string;
  /** Tooltip surface (system.tsx inline contentStyle) — was rgb(20 20 20/0.95). */
  tooltipBg: string;
  tooltipBorder: string;
}

function channelTriplet(varName: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  // HSL-channel tokens ("348 80% 48%"); empty in jsdom or unknown names.
  return raw || fallback;
}

export function readChartColors(): ChartColors {
  return {
    primary: `hsl(${channelTriplet("--primary", "348 80% 48%")})`,
    success: `hsl(${channelTriplet("--status-success", "152 65% 50%")})`,
    warning: `hsl(${channelTriplet("--status-warning", "38 92% 56%")})`,
    info: `hsl(${channelTriplet("--status-info", "211 90% 58%")})`,
    error: `hsl(${channelTriplet("--status-error", "0 80% 62%")})`,
    muted: `hsl(${channelTriplet("--muted-foreground", "215 16% 68%")})`,
    grid: `hsl(${channelTriplet("--border", "215 20% 17%")} / 0.6)`,
    tooltipBg: `hsl(${channelTriplet("--card", "220 20% 8%")} / 0.95)`,
    tooltipBorder: `hsl(${channelTriplet("--border", "215 20% 17%")} / 0.4)`,
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(readChartColors);

  useEffect(() => {
    // Theme flips are a class change on <html> (lib/theme.tsx) — watch
    // that attribute and recompute the resolved palette.
    const root = document.documentElement;
    const observer = new MutationObserver(() => setColors(readChartColors()));
    observer.observe(root, { attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
