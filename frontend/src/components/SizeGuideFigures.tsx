/**
 * Body figure & garment illustrations for the size guide modal.
 *
 * Hand-built SVGs (no designer assets needed) that show buyers WHERE on
 * the body / garment each measurement is taken. Two diagrams:
 *
 *   1. BodyFigure  – minimal human silhouette with measurement arrows
 *      and labels. Variants: "women", "men", "kids".
 *
 *   2. GarmentDiagram – a stylised top with Shoulder / Chest / Length /
 *      Sleeve dimension lines (matches what the Product chart shows).
 *
 * Numbers passed via the `values` prop are rendered next to each arrow
 * so buyers see, e.g. their actual bust measurement (cm or inches) on
 * top of the diagram. Pass empty / undefined values to hide labels.
 */
import { memo } from "react";
import { View } from "react-native";
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Rect,
  Text as SvgText,
} from "react-native-svg";

import { colors } from "@/src/lib/theme";

type BodyValues = {
  bust?: string;
  chest?: string;
  waist?: string;
  hip?: string;
  height?: string;
};

const STROKE = "#1F2937";
const ARROW = colors.primary;
const LABEL_BG = "#FFF7ED";
const LABEL_TXT = "#9A3412";

function Arrow({
  x1,
  y1,
  x2,
  y2,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}) {
  return (
    <G>
      <Line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ARROW} strokeWidth={1.5} />
      <Circle cx={x1} cy={y1} r={2.2} fill={ARROW} />
      <Circle cx={x2} cy={y2} r={2.2} fill={ARROW} />
    </G>
  );
}

function Pill({
  x,
  y,
  width,
  text,
}: {
  x: number;
  y: number;
  width: number;
  text: string;
}) {
  return (
    <G>
      <Rect
        x={x}
        y={y - 7}
        width={width}
        height={14}
        rx={7}
        fill={LABEL_BG}
        stroke={ARROW}
        strokeWidth={0.5}
      />
      <SvgText
        x={x + width / 2}
        y={y + 3}
        fill={LABEL_TXT}
        fontSize="8"
        fontWeight="700"
        textAnchor="middle"
      >
        {text}
      </SvgText>
    </G>
  );
}

// ---------------------------------------------------------------------------
// Body figure — three variants
// ---------------------------------------------------------------------------
function WomanFigure({ values }: { values: BodyValues }) {
  return (
    <Svg width={220} height={280} viewBox="0 0 220 280">
      {/* Head */}
      <Circle cx={110} cy={28} r={16} stroke={STROKE} strokeWidth={1.5} fill="#fff" />
      {/* Neck */}
      <Line x1={110} y1={44} x2={110} y2={56} stroke={STROKE} strokeWidth={1.5} />
      {/* Torso (curvy) */}
      <Path
        d="M 92 56 Q 80 65 76 92 Q 74 110 80 130 Q 88 145 86 168 Q 84 195 94 230 L 110 245 L 126 230 Q 136 195 134 168 Q 132 145 140 130 Q 146 110 144 92 Q 140 65 128 56 Z"
        stroke={STROKE}
        strokeWidth={1.5}
        fill="#fff"
      />
      {/* Arms */}
      <Path d="M 80 75 Q 60 110 56 165" stroke={STROKE} strokeWidth={1.5} fill="none" />
      <Path d="M 140 75 Q 160 110 164 165" stroke={STROKE} strokeWidth={1.5} fill="none" />
      {/* Legs */}
      <Line x1={100} y1={245} x2={96} y2={272} stroke={STROKE} strokeWidth={1.5} />
      <Line x1={120} y1={245} x2={124} y2={272} stroke={STROKE} strokeWidth={1.5} />

      {/* Bust line */}
      <Arrow x1={72} y1={92} x2={148} y2={92} />
      {values.bust ? <Pill x={154} y={92} width={50} text={`Bust ${values.bust}`} /> : null}

      {/* Waist */}
      <Arrow x1={78} y1={130} x2={142} y2={130} />
      {values.waist ? <Pill x={150} y={130} width={56} text={`Waist ${values.waist}`} /> : null}

      {/* Hip */}
      <Arrow x1={80} y1={170} x2={140} y2={170} />
      {values.hip ? <Pill x={146} y={170} width={50} text={`Hip ${values.hip}`} /> : null}

      {/* Side guide labels (left of body) */}
      <SvgText x={12} y={94} fill={colors.textMuted} fontSize="8" fontWeight="700">
        Bust
      </SvgText>
      <SvgText x={12} y={132} fill={colors.textMuted} fontSize="8" fontWeight="700">
        Waist
      </SvgText>
      <SvgText x={12} y={172} fill={colors.textMuted} fontSize="8" fontWeight="700">
        Hip
      </SvgText>
    </Svg>
  );
}

function ManFigure({ values }: { values: BodyValues }) {
  return (
    <Svg width={220} height={280} viewBox="0 0 220 280">
      <Circle cx={110} cy={28} r={16} stroke={STROKE} strokeWidth={1.5} fill="#fff" />
      <Line x1={110} y1={44} x2={110} y2={56} stroke={STROKE} strokeWidth={1.5} />
      {/* Wider shoulders, narrower waist */}
      <Path
        d="M 84 56 Q 70 70 70 100 Q 70 130 82 150 Q 80 175 92 210 Q 100 235 110 240 Q 120 235 128 210 Q 140 175 138 150 Q 150 130 150 100 Q 150 70 136 56 Z"
        stroke={STROKE}
        strokeWidth={1.5}
        fill="#fff"
      />
      <Path d="M 70 80 Q 50 115 52 165" stroke={STROKE} strokeWidth={1.5} fill="none" />
      <Path d="M 150 80 Q 170 115 168 165" stroke={STROKE} strokeWidth={1.5} fill="none" />
      <Line x1={104} y1={240} x2={100} y2={272} stroke={STROKE} strokeWidth={1.5} />
      <Line x1={116} y1={240} x2={120} y2={272} stroke={STROKE} strokeWidth={1.5} />

      {/* Chest */}
      <Arrow x1={64} y1={100} x2={156} y2={100} />
      {values.chest ? <Pill x={162} y={100} width={50} text={`Chest ${values.chest}`} /> : null}

      {/* Waist */}
      <Arrow x1={78} y1={148} x2={142} y2={148} />
      {values.waist ? <Pill x={150} y={148} width={56} text={`Waist ${values.waist}`} /> : null}

      <SvgText x={12} y={102} fill={colors.textMuted} fontSize="8" fontWeight="700">
        Chest
      </SvgText>
      <SvgText x={12} y={150} fill={colors.textMuted} fontSize="8" fontWeight="700">
        Waist
      </SvgText>
    </Svg>
  );
}

function KidsFigure({ values }: { values: BodyValues }) {
  return (
    <Svg width={220} height={280} viewBox="0 0 220 280">
      <Circle cx={110} cy={28} r={17} stroke={STROKE} strokeWidth={1.5} fill="#fff" />
      <Line x1={110} y1={45} x2={110} y2={58} stroke={STROKE} strokeWidth={1.5} />
      <Path
        d="M 90 58 Q 76 75 78 110 Q 80 145 90 175 L 110 195 L 130 175 Q 140 145 142 110 Q 144 75 130 58 Z"
        stroke={STROKE}
        strokeWidth={1.5}
        fill="#fff"
      />
      <Path d="M 80 82 Q 60 110 60 150" stroke={STROKE} strokeWidth={1.5} fill="none" />
      <Path d="M 140 82 Q 160 110 160 150" stroke={STROKE} strokeWidth={1.5} fill="none" />
      <Line x1={100} y1={195} x2={94} y2={245} stroke={STROKE} strokeWidth={1.5} />
      <Line x1={120} y1={195} x2={126} y2={245} stroke={STROKE} strokeWidth={1.5} />

      {/* Height arrow on the left */}
      <Line x1={28} y1={12} x2={28} y2={245} stroke={ARROW} strokeWidth={1} strokeDasharray="3 3" />
      <Path d="M 24 12 L 28 6 L 32 12 Z" fill={ARROW} />
      <Path d="M 24 245 L 28 251 L 32 245 Z" fill={ARROW} />
      {values.height ? <Pill x={40} y={128} width={56} text={`Ht ${values.height}`} /> : null}

      {/* Chest reference */}
      <Arrow x1={78} y1={108} x2={142} y2={108} />
      {values.chest ? <Pill x={150} y={108} width={56} text={`Chest ${values.chest}`} /> : null}
    </Svg>
  );
}

export const BodyFigure = memo(function BodyFigure({
  kind,
  gender,
  values,
}: {
  kind: "apparel" | "shoes" | "kids";
  gender?: "women" | "men";
  values: BodyValues;
}) {
  return (
    <View style={{ alignItems: "center", marginVertical: 12 }}>
      {kind === "kids" ? (
        <KidsFigure values={values} />
      ) : gender === "men" ? (
        <ManFigure values={values} />
      ) : (
        <WomanFigure values={values} />
      )}
    </View>
  );
});


// ---------------------------------------------------------------------------
// Garment diagram (line drawing of a generic top with dimension arrows)
// ---------------------------------------------------------------------------
type GarmentValues = {
  shoulder?: string;
  chest?: string;
  length?: string;
  sleeve?: string;
};

export const GarmentDiagram = memo(function GarmentDiagram({
  values,
}: {
  values: GarmentValues;
}) {
  return (
    <View style={{ alignItems: "center", marginTop: 8, marginBottom: 4 }}>
      <Svg width={250} height={210} viewBox="0 0 250 210">
        {/* Body of T-shirt */}
        <Path
          d="M 60 28 L 70 18 L 100 8 L 150 8 L 180 18 L 190 28 L 210 60 L 188 78 L 178 60 L 178 180 L 72 180 L 72 60 L 62 78 L 40 60 Z"
          stroke={STROKE}
          strokeWidth={1.6}
          fill="#fff"
        />
        {/* Neckline */}
        <Path
          d="M 100 8 Q 125 28 150 8"
          stroke={STROKE}
          strokeWidth={1.6}
          fill="#fff"
        />

        {/* Shoulder arrow (top, between sleeve seams) */}
        <Arrow x1={70} y1={20} x2={180} y2={20} />
        <Pill x={108} y={4} width={64} text={`Shoulder ${values.shoulder ?? "—"}`} />

        {/* Chest arrow */}
        <Arrow x1={72} y1={70} x2={178} y2={70} />
        <Pill x={108} y={88} width={64} text={`Chest ${values.chest ?? "—"}`} />

        {/* Length arrow on right */}
        <Line x1={220} y1={20} x2={220} y2={180} stroke={ARROW} strokeWidth={1.5} />
        <Circle cx={220} cy={20} r={2.5} fill={ARROW} />
        <Circle cx={220} cy={180} r={2.5} fill={ARROW} />
        <Pill x={224} y={100} width={26} text={values.length ?? "—"} />
        <SvgText x={224} y={92} fill={LABEL_TXT} fontSize="7.5" fontWeight="700">
          Length
        </SvgText>

        {/* Sleeve arrow (left side) */}
        <Line x1={20} y1={60} x2={62} y2={60} stroke={ARROW} strokeWidth={1.5} />
        <Circle cx={20} cy={60} r={2.5} fill={ARROW} />
        <Circle cx={62} cy={60} r={2.5} fill={ARROW} />
        <Pill x={6} y={48} width={50} text={`Sleeve ${values.sleeve ?? "—"}`} />
      </Svg>
    </View>
  );
});
