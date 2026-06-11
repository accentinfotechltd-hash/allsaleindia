/**
 * TimeseriesChart — lightweight SVG bar chart for the seller analytics screen.
 *
 * Renders one bar per day across a 7- or 30-day window with a single
 * "metric" selected (views / cart adds / sold / revenue). Tap a bar to
 * highlight it and show its numeric value above the chart.
 *
 * No charting library — pure react-native-svg so we don't add ~250 KB of
 * dependencies for a simple bar chart.
 */
import { useMemo, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { G, Line, Rect, Text as SvgText } from "react-native-svg";

import { colors, radius, spacing } from "@/src/lib/theme";

export type Bucket = {
  date: string; // YYYY-MM-DD (UTC)
  views: number;
  cart_adds: number;
  sold: number;
  revenue_nzd: number;
};

export type Metric = "views" | "cart_adds" | "sold" | "revenue_nzd";

const METRIC_LABEL: Record<Metric, string> = {
  views: "Views",
  cart_adds: "Add to carts",
  sold: "Units sold",
  revenue_nzd: "Revenue (NZD)",
};

const METRIC_COLOR: Record<Metric, string> = {
  views: "#3B82F6",
  cart_adds: "#F59E0B",
  sold: "#10B981",
  revenue_nzd: "#8B5CF6",
};

type Props = {
  buckets: Bucket[];
  metric: Metric;
  height?: number;
};

export function TimeseriesChart({ buckets, metric, height = 180 }: Props) {
  const [tapIdx, setTapIdx] = useState<number | null>(null);

  // Chart dimensions
  const screenW = Dimensions.get("window").width;
  const sidePad = spacing.lg;
  const width = screenW - sidePad * 2;
  const innerPadTop = 28;
  const innerPadBottom = 22;
  const chartH = height - innerPadTop - innerPadBottom;

  const values = useMemo(() => buckets.map((b) => Number(b[metric] || 0)), [buckets, metric]);
  const maxVal = Math.max(1, ...values);

  // Bar geometry
  const gap = buckets.length > 14 ? 1.5 : 3;
  const barW = Math.max(2, (width - gap * (buckets.length - 1)) / Math.max(1, buckets.length));

  // Label every Nth tick to keep them readable.
  const tickEvery = buckets.length > 14 ? Math.ceil(buckets.length / 6) : 1;

  const fmtTickDate = (d: string) => {
    const dt = new Date(d + "T00:00:00Z");
    const day = dt.getUTCDate();
    const mon = dt.toLocaleString("en-NZ", { month: "short", timeZone: "UTC" });
    return `${day} ${mon}`;
  };

  const valLabel = (v: number) =>
    metric === "revenue_nzd" ? `$${v.toFixed(2)}` : v.toLocaleString();

  return (
    <View style={styles.wrap} testID="timeseries-chart">
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>{METRIC_LABEL[metric]}</Text>
        {tapIdx !== null && buckets[tapIdx] ? (
          <Text style={styles.tapHint}>
            <Text style={{ fontWeight: "800", color: colors.text }}>
              {valLabel(values[tapIdx])}
            </Text>
            <Text>  ·  {fmtTickDate(buckets[tapIdx].date)}</Text>
          </Text>
        ) : (
          <Text style={styles.tapHint}>Tap a bar for the day&apos;s total</Text>
        )}
      </View>

      <Svg width={width} height={height}>
        {/* baseline */}
        <Line
          x1={0}
          x2={width}
          y1={innerPadTop + chartH}
          y2={innerPadTop + chartH}
          stroke={colors.border}
          strokeWidth={1}
        />
        <G>
          {buckets.map((b, idx) => {
            const v = values[idx];
            const h = (v / maxVal) * chartH;
            const x = idx * (barW + gap);
            const y = innerPadTop + (chartH - h);
            const isToday = idx === buckets.length - 1;
            const isTapped = tapIdx === idx;
            const fill = isTapped
              ? colors.text
              : isToday
                ? METRIC_COLOR[metric]
                : METRIC_COLOR[metric] + "AA";
            return (
              <G key={b.date}>
                <Rect
                  x={x}
                  y={y}
                  width={barW}
                  height={Math.max(2, h)}
                  rx={Math.min(3, barW / 3)}
                  fill={fill}
                  onPress={() => setTapIdx(isTapped ? null : idx)}
                />
                {isTapped && h >= 14 ? (
                  <SvgText
                    x={x + barW / 2}
                    y={y - 6}
                    fontSize={10}
                    fontWeight="800"
                    fill={colors.text}
                    textAnchor="middle"
                  >
                    {valLabel(v)}
                  </SvgText>
                ) : null}
                {idx % tickEvery === 0 || idx === buckets.length - 1 ? (
                  <SvgText
                    x={x + barW / 2}
                    y={innerPadTop + chartH + 14}
                    fontSize={9}
                    fill={colors.textMuted}
                    textAnchor="middle"
                  >
                    {fmtTickDate(b.date)}
                  </SvgText>
                ) : null}
              </G>
            );
          })}
        </G>
      </Svg>

      {/* invisible tap targets for bars (so taps don't get swallowed on web) */}
      <View style={styles.tapRow} pointerEvents="box-none">
        {buckets.map((b, idx) => (
          <Pressable
            key={"tap-" + b.date}
            testID={`chart-bar-${idx}`}
            onPress={() => setTapIdx(tapIdx === idx ? null : idx)}
            style={{
              position: "absolute",
              left: idx * (barW + gap),
              top: innerPadTop,
              width: barW + gap,
              height: chartH,
            }}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: "#fff",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  headerLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "800", letterSpacing: 0.5, textTransform: "uppercase" },
  tapHint: { fontSize: 11, color: colors.textMuted, flexShrink: 1 },
  tapRow: { position: "absolute", left: spacing.md, right: spacing.md, top: spacing.md },
});
