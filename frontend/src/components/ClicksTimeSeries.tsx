/**
 * Lightweight stacked-bar chart for ambassador link clicks over time.
 *
 * Renders B2C clicks (orange) and B2B clicks (blue) per day as stacked
 * vertical bars, with the max-bar labeled and X-axis day-of-week ticks
 * every ~7 bars. No external chart lib required — just react-native-svg.
 */
import React, { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Circle, G, Polyline, Rect, Svg, Text as SvgText } from "react-native-svg";

import { colors, spacing } from "@/src/lib/theme";

export type DailyPoint = { date: string; b2c: number; b2b: number; total: number; uniques: number };

const CHART_HEIGHT = 110;
const PADDING_TOP = 14;
const PADDING_BOTTOM = 24;
const PADDING_X = 6;

export function ClicksTimeSeries({
  data,
  showB2B,
  width,
}: {
  data: DailyPoint[];
  showB2B: boolean;
  width: number;
}) {
  const { maxVal, maxIdx, hasAny } = useMemo(() => {
    let max = 0;
    let idx = -1;
    let any = false;
    for (let i = 0; i < data.length; i += 1) {
      const v = data[i].total;
      if (v > 0) any = true;
      if (v > max) {
        max = v;
        idx = i;
      }
    }
    return { maxVal: max, maxIdx: idx, hasAny: any };
  }, [data]);

  if (data.length === 0) return null;

  const innerW = Math.max(width - PADDING_X * 2, 60);
  const barCount = data.length;
  const barWidth = innerW / barCount;
  const innerBarWidth = Math.max(barWidth - 2, 1);
  const innerH = CHART_HEIGHT - PADDING_TOP - PADDING_BOTTOM;
  const yScale = maxVal > 0 ? innerH / maxVal : 0;

  // Uniques overlay: a polyline using the same y-axis as the bars (uniques
  // are always ≤ total clicks so reusing the click scale keeps the line
  // readable). Computed inline since this branch only runs when data is
  // non-empty — Hooks must always be called unconditionally.
  const uniquesPoints = yScale
    ? data
        .map((d, i) => {
          const cx = i * barWidth + barWidth / 2;
          const cy = PADDING_TOP + innerH - d.uniques * yScale;
          return `${cx.toFixed(1)},${cy.toFixed(1)}`;
        })
        .join(" ")
    : "";

  // Show day-of-week tick every nth bar so X-axis labels don't collide.
  const tickStep = Math.max(1, Math.ceil(barCount / 6));

  return (
    <View>
      <Svg width={width} height={CHART_HEIGHT} testID="ambassadors-clicks-chart">
        <G x={PADDING_X} y={0}>
          {data.map((d, i) => {
            const x = i * barWidth + (barWidth - innerBarWidth) / 2;
            const b2cH = d.b2c * yScale;
            const b2bH = d.b2b * yScale;
            const baseY = PADDING_TOP + innerH;
            return (
              <G key={d.date}>
                {/* baseline tick when no data — render a flat 1px line */}
                {d.total === 0 ? (
                  <Rect
                    x={x}
                    y={baseY - 1}
                    width={innerBarWidth}
                    height={1}
                    fill={colors.border}
                    opacity={0.6}
                  />
                ) : null}
                {b2cH > 0 ? (
                  <Rect
                    x={x}
                    y={baseY - b2cH}
                    width={innerBarWidth}
                    height={b2cH}
                    fill={colors.primary}
                    rx={1}
                  />
                ) : null}
                {showB2B && b2bH > 0 ? (
                  <Rect
                    x={x}
                    y={baseY - b2cH - b2bH}
                    width={innerBarWidth}
                    height={b2bH}
                    fill="#2563EB"
                    rx={1}
                  />
                ) : null}
                {i % tickStep === 0 ? (
                  <SvgText
                    x={x + innerBarWidth / 2}
                    y={CHART_HEIGHT - 6}
                    fontSize={9}
                    fill={colors.textMuted}
                    textAnchor="middle"
                  >
                    {shortDay(d.date)}
                  </SvgText>
                ) : null}
                {i === maxIdx && maxVal > 0 ? (
                  <SvgText
                    x={x + innerBarWidth / 2}
                    y={baseY - b2cH - b2bH - 4}
                    fontSize={9}
                    fontWeight="700"
                    fill={colors.text}
                    textAnchor="middle"
                  >
                    {String(maxVal)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
          {uniquesPoints ? (
            <Polyline
              points={uniquesPoints}
              fill="none"
              stroke="#16A34A"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
          {yScale > 0
            ? data.map((d, i) => {
                if (d.uniques === 0) return null;
                const cx = i * barWidth + barWidth / 2;
                const cy = PADDING_TOP + innerH - d.uniques * yScale;
                return (
                  <Circle key={`u-${d.date}`} cx={cx} cy={cy} r={1.8} fill="#16A34A" />
                );
              })
            : null}
        </G>
      </Svg>
      {!hasAny ? (
        <Text style={styles.empty}>
          No clicks yet. Share your link to start seeing the trend.
        </Text>
      ) : (
        <View style={styles.legend}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: colors.primary }]} />
            <Text style={styles.legendText}>Customer (B2C)</Text>
          </View>
          {showB2B ? (
            <View style={styles.legendItem}>
              <View style={[styles.swatch, { backgroundColor: "#2563EB" }]} />
              <Text style={styles.legendText}>Seller (B2B)</Text>
            </View>
          ) : null}
          <View style={styles.legendItem}>
            <View style={[styles.lineSwatch, { backgroundColor: "#16A34A" }]} />
            <Text style={styles.legendText}>Unique visitors</Text>
          </View>
        </View>
      )}
    </View>
  );
}

function shortDay(isoDate: string): string {
  // isoDate is "YYYY-MM-DD". Use Date parsed as UTC-noon to avoid TZ drift.
  const [y, m, d] = isoDate.split("-").map((s) => parseInt(s, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  // Compact: e.g. "6/21". Keeps the chart legible across narrow widths.
  return `${dt.getUTCMonth() + 1}/${dt.getUTCDate()}`;
}

const styles = StyleSheet.create({
  empty: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: "center",
    paddingTop: 6,
  },
  legend: {
    flexDirection: "row",
    gap: spacing.md,
    paddingTop: 4,
    paddingLeft: PADDING_X,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  lineSwatch: { width: 12, height: 2, borderRadius: 1 },
  legendText: { fontSize: 11, color: colors.textMuted },
});
