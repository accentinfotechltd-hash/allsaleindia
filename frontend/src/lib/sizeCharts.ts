/**
 * NZ ↔ Indian size conversion charts.
 *
 * All NZ sizes are aligned with AU (which is identical for clothing) and
 * UK (very close, occasionally one notch off — we annotate where it matters).
 * Indian sizes follow the most common retail convention (BIS IS-13578 for
 * footwear).
 *
 * These are static reference tables for buyer guidance only — sellers should
 * still measure carefully against the actual garment.
 */

export type SizeRow = {
  nz: string;
  india: string;
  bust_cm?: string;
  waist_cm?: string;
  hip_cm?: string;
  chest_cm?: string;
  foot_mm?: string;
};

export type SizeChart = {
  key: string;
  title: string;
  subtitle: string;
  headers: { key: keyof SizeRow; label: string }[];
  rows: SizeRow[];
  notes?: string[];
};

export const WOMENS_CLOTHING: SizeChart = {
  key: "womens",
  title: "Women's clothing",
  subtitle: "Tops, dresses, kurtis & sarees",
  headers: [
    { key: "nz", label: "NZ / AU" },
    { key: "india", label: "India" },
    { key: "bust_cm", label: "Bust (cm)" },
    { key: "waist_cm", label: "Waist (cm)" },
    { key: "hip_cm", label: "Hip (cm)" },
  ],
  rows: [
    { nz: "6 (XS)", india: "30 / XS", bust_cm: "78–80", waist_cm: "60–62", hip_cm: "85–87" },
    { nz: "8 (S)", india: "32 / S", bust_cm: "82–84", waist_cm: "64–66", hip_cm: "89–91" },
    { nz: "10 (M)", india: "34 / M", bust_cm: "86–89", waist_cm: "68–71", hip_cm: "93–96" },
    { nz: "12 (L)", india: "36 / L", bust_cm: "91–94", waist_cm: "73–76", hip_cm: "98–101" },
    { nz: "14 (XL)", india: "38 / XL", bust_cm: "96–99", waist_cm: "78–81", hip_cm: "103–106" },
    { nz: "16 (XXL)", india: "40 / XXL", bust_cm: "101–104", waist_cm: "83–86", hip_cm: "108–111" },
    { nz: "18 (3XL)", india: "42 / 3XL", bust_cm: "106–109", waist_cm: "88–91", hip_cm: "113–116" },
    { nz: "20 (4XL)", india: "44 / 4XL", bust_cm: "111–114", waist_cm: "93–96", hip_cm: "118–121" },
  ],
  notes: [
    "Sarees are typically Free Size with a 0.9–1.2m unstitched blouse piece — get it stitched locally to your bust + sleeve length.",
    "Kurtis run small. If between two sizes, size up.",
  ],
};

export const MENS_CLOTHING: SizeChart = {
  key: "mens",
  title: "Men's clothing",
  subtitle: "Shirts, t-shirts, kurtas",
  headers: [
    { key: "nz", label: "NZ / AU" },
    { key: "india", label: "India" },
    { key: "chest_cm", label: "Chest (cm)" },
    { key: "waist_cm", label: "Waist (cm)" },
  ],
  rows: [
    { nz: "XS", india: "36", chest_cm: "86–91", waist_cm: "71–76" },
    { nz: "S", india: "38", chest_cm: "91–96", waist_cm: "76–81" },
    { nz: "M", india: "40", chest_cm: "96–101", waist_cm: "81–86" },
    { nz: "L", india: "42", chest_cm: "101–106", waist_cm: "86–91" },
    { nz: "XL", india: "44", chest_cm: "106–111", waist_cm: "91–96" },
    { nz: "XXL", india: "46", chest_cm: "111–116", waist_cm: "96–101" },
    { nz: "3XL", india: "48", chest_cm: "116–121", waist_cm: "101–106" },
  ],
  notes: [
    "Indian-tailored kurtas often run loose at chest — measure across the widest point.",
    "Slim-fit shirts: size up by one for a comfortable NZ fit.",
  ],
};

export const FOOTWEAR_WOMEN: SizeChart = {
  key: "footwear_women",
  title: "Women's footwear",
  subtitle: "NZ / UK ↔ India",
  headers: [
    { key: "nz", label: "NZ / UK" },
    { key: "india", label: "India" },
    { key: "foot_mm", label: "Foot length" },
  ],
  rows: [
    { nz: "3", india: "3", foot_mm: "220 mm" },
    { nz: "4", india: "4", foot_mm: "229 mm" },
    { nz: "5", india: "5", foot_mm: "237 mm" },
    { nz: "6", india: "6", foot_mm: "246 mm" },
    { nz: "7", india: "7", foot_mm: "254 mm" },
    { nz: "8", india: "8", foot_mm: "263 mm" },
    { nz: "9", india: "9", foot_mm: "271 mm" },
  ],
  notes: ["NZ women's footwear is the same numerical system as UK & India — no conversion needed in most cases."],
};

export const FOOTWEAR_MEN: SizeChart = {
  key: "footwear_men",
  title: "Men's footwear",
  subtitle: "NZ / UK ↔ India",
  headers: [
    { key: "nz", label: "NZ / UK" },
    { key: "india", label: "India" },
    { key: "foot_mm", label: "Foot length" },
  ],
  rows: [
    { nz: "6", india: "6", foot_mm: "246 mm" },
    { nz: "7", india: "7", foot_mm: "254 mm" },
    { nz: "8", india: "8", foot_mm: "263 mm" },
    { nz: "9", india: "9", foot_mm: "271 mm" },
    { nz: "10", india: "10", foot_mm: "279 mm" },
    { nz: "11", india: "11", foot_mm: "288 mm" },
    { nz: "12", india: "12", foot_mm: "297 mm" },
  ],
  notes: ["Indian-made leather mojaris run slightly narrow — size up if you have a wide foot."],
};

export const ALL_CHARTS: SizeChart[] = [
  WOMENS_CLOTHING,
  MENS_CLOTHING,
  FOOTWEAR_WOMEN,
  FOOTWEAR_MEN,
];

/** Which charts to show for a given product category / subcategory. */
export function chartsForCategory(category?: string, subcategory?: string): SizeChart[] {
  const c = (category || "").toLowerCase();
  const s = (subcategory || "").toLowerCase();
  if (c.includes("fashion") || c.includes("apparel") || c.includes("clothing")) {
    if (s.includes("women") || s.includes("saree") || s.includes("kurti") || s.includes("dress")) {
      return [WOMENS_CLOTHING];
    }
    if (s.includes("men") || s.includes("kurta") || s.includes("shirt")) {
      return [MENS_CLOTHING];
    }
    // unknown subcategory — show both clothing charts
    return [WOMENS_CLOTHING, MENS_CLOTHING];
  }
  if (s.includes("footwear") || c.includes("footwear") || c.includes("shoe")) {
    return [FOOTWEAR_WOMEN, FOOTWEAR_MEN];
  }
  return [];
}
