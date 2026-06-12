"""Country-wise size conversion data for Allsale.

Pure-data module — no DB / HTTP / I/O. Tables follow widely used
international standards (ISO/EN 13402, US/UK/EU women's & men's, ASTM
shoe tables, Indian Standards Institution garment chart, US Ring Size
chart, Indian bangle diameter chart).

All measurements are in centimetres (height/bust/waist/hip), unless the
column name explicitly says inches. Each row groups the equivalent
labels across the supported buyer countries plus the manufacturing
country (India).

Schema returned by `/api/size-guide`:
    {
      "categories": [
        {
          "id": "womens_apparel",
          "label": "Women's Clothing",
          "kind": "apparel",
          "measurement_keys": ["bust_cm", "waist_cm", "hip_cm"],
          "columns": [
              {"key": "label", "label": "Size"},
              {"key": "US", "label": "US"},
              ...
          ],
          "rows": [
              {"label": "XS", "US": "0-2", "UK": "4-6", ..., "bust_cm": "78-83", "waist_cm": "60-65"},
              ...
          ]
        },
        ...
      ],
      "countries": ["US", "UK", "EU", "AU", "NZ", "CA", "IN"]
    }
"""
from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Countries shown in the conversion table. Order matches what we render.
# NZ and CA borrow the US/UK number system but we keep them as explicit
# columns so the seller can override locally if they ever need to.
# ---------------------------------------------------------------------------
COUNTRIES: list[str] = ["US", "UK", "EU", "AU", "NZ", "CA", "IN"]


# ---------------------------------------------------------------------------
# Women's clothing (tops, dresses, kurtis, blouses).
# Bust / Waist / Hip in cm. Source: EN 13402-3 + US/UK retail conventions.
# ---------------------------------------------------------------------------
WOMENS_APPAREL: list[dict[str, str]] = [
    {"label": "XS", "US": "0-2",   "UK": "4-6",   "EU": "32-34", "AU": "6-8",   "NZ": "6-8",   "CA": "0-2",   "IN": "32-34", "bust_cm": "78-83",   "waist_cm": "60-65",   "hip_cm": "85-90",  "g_shoulder_cm": "37", "g_chest_cm": "84",  "g_length_cm": "60", "g_sleeve_cm": "55"},
    {"label": "S",  "US": "4-6",   "UK": "8-10",  "EU": "36-38", "AU": "8-10",  "NZ": "8-10",  "CA": "4-6",   "IN": "36-38", "bust_cm": "84-89",   "waist_cm": "66-71",   "hip_cm": "91-96",  "g_shoulder_cm": "38", "g_chest_cm": "88",  "g_length_cm": "62", "g_sleeve_cm": "56"},
    {"label": "M",  "US": "8-10",  "UK": "12-14", "EU": "40-42", "AU": "12-14", "NZ": "12-14", "CA": "8-10",  "IN": "40-42", "bust_cm": "90-95",   "waist_cm": "72-77",   "hip_cm": "97-102", "g_shoulder_cm": "39", "g_chest_cm": "92",  "g_length_cm": "64", "g_sleeve_cm": "57"},
    {"label": "L",  "US": "12-14", "UK": "16-18", "EU": "44-46", "AU": "16-18", "NZ": "16-18", "CA": "12-14", "IN": "44-46", "bust_cm": "96-101",  "waist_cm": "78-83",   "hip_cm": "103-108","g_shoulder_cm": "40", "g_chest_cm": "97",  "g_length_cm": "66", "g_sleeve_cm": "58"},
    {"label": "XL", "US": "16-18", "UK": "20-22", "EU": "48-50", "AU": "20-22", "NZ": "20-22", "CA": "16-18", "IN": "48-50", "bust_cm": "102-107", "waist_cm": "84-89",   "hip_cm": "109-114","g_shoulder_cm": "41", "g_chest_cm": "102", "g_length_cm": "68", "g_sleeve_cm": "59"},
    {"label": "XXL","US": "20-22", "UK": "24-26", "EU": "52-54", "AU": "24-26", "NZ": "24-26", "CA": "20-22", "IN": "52-54", "bust_cm": "108-113", "waist_cm": "90-96",   "hip_cm": "115-120","g_shoulder_cm": "42", "g_chest_cm": "108", "g_length_cm": "70", "g_sleeve_cm": "60"},
    {"label": "3XL","US": "24-26", "UK": "28-30", "EU": "56-58", "AU": "28-30", "NZ": "28-30", "CA": "24-26", "IN": "56-58", "bust_cm": "114-120", "waist_cm": "97-104",  "hip_cm": "121-128","g_shoulder_cm": "43", "g_chest_cm": "114", "g_length_cm": "72", "g_sleeve_cm": "61"},
]


MENS_APPAREL: list[dict[str, str]] = [
    {"label": "XS", "US": "32-34", "UK": "32-34", "EU": "42-44", "AU": "32-34", "NZ": "32-34", "CA": "32-34", "IN": "36-38", "chest_cm": "81-86",  "waist_cm": "70-74", "g_shoulder_cm": "42", "g_chest_cm": "98",  "g_length_cm": "68", "g_sleeve_cm": "62"},
    {"label": "S",  "US": "35-37", "UK": "35-37", "EU": "46-48", "AU": "35-37", "NZ": "35-37", "CA": "35-37", "IN": "38-40", "chest_cm": "87-93",  "waist_cm": "75-80", "g_shoulder_cm": "44", "g_chest_cm": "104", "g_length_cm": "70", "g_sleeve_cm": "63"},
    {"label": "M",  "US": "38-40", "UK": "38-40", "EU": "50",    "AU": "38-40", "NZ": "38-40", "CA": "38-40", "IN": "40-42", "chest_cm": "94-99",  "waist_cm": "81-86", "g_shoulder_cm": "46", "g_chest_cm": "110", "g_length_cm": "72", "g_sleeve_cm": "64"},
    {"label": "L",  "US": "41-43", "UK": "41-43", "EU": "52-54", "AU": "41-43", "NZ": "41-43", "CA": "41-43", "IN": "42-44", "chest_cm": "100-106","waist_cm": "87-92", "g_shoulder_cm": "48", "g_chest_cm": "116", "g_length_cm": "74", "g_sleeve_cm": "65"},
    {"label": "XL", "US": "44-46", "UK": "44-46", "EU": "56-58", "AU": "44-46", "NZ": "44-46", "CA": "44-46", "IN": "44-46", "chest_cm": "107-113","waist_cm": "93-98", "g_shoulder_cm": "50", "g_chest_cm": "122", "g_length_cm": "76", "g_sleeve_cm": "66"},
    {"label": "XXL","US": "47-49", "UK": "47-49", "EU": "60-62", "AU": "47-49", "NZ": "47-49", "CA": "47-49", "IN": "46-48", "chest_cm": "114-120","waist_cm": "99-104", "g_shoulder_cm": "52", "g_chest_cm": "128", "g_length_cm": "78", "g_sleeve_cm": "67"},
    {"label": "3XL","US": "50-52", "UK": "50-52", "EU": "64-66", "AU": "50-52", "NZ": "50-52", "CA": "50-52", "IN": "48-50", "chest_cm": "121-127","waist_cm": "105-110", "g_shoulder_cm": "54", "g_chest_cm": "134", "g_length_cm": "80", "g_sleeve_cm": "68"},
]


KIDS_APPAREL: list[dict[str, str]] = [
    {"label": "0-3M",   "US": "NB-3M",  "UK": "0-3M",   "EU": "56-62",  "AU": "0000",   "NZ": "0000",   "CA": "NB-3M",  "IN": "0-3M",   "height_cm": "56-61",   "weight_kg": "4-6",   "g_chest_cm": "44", "g_length_cm": "38", "g_sleeve_cm": "20"},
    {"label": "3-6M",   "US": "3-6M",   "UK": "3-6M",   "EU": "62-68",  "AU": "000",    "NZ": "000",    "CA": "3-6M",   "IN": "3-6M",   "height_cm": "62-67",   "weight_kg": "6-8",   "g_chest_cm": "46", "g_length_cm": "40", "g_sleeve_cm": "22"},
    {"label": "6-12M",  "US": "6-12M",  "UK": "6-12M",  "EU": "68-76",  "AU": "00-0",   "NZ": "00-0",   "CA": "6-12M",  "IN": "6-12M",  "height_cm": "68-76",   "weight_kg": "8-10",  "g_chest_cm": "48", "g_length_cm": "42", "g_sleeve_cm": "25"},
    {"label": "12-18M", "US": "12-18M", "UK": "12-18M", "EU": "80-86",  "AU": "1",      "NZ": "1",      "CA": "12-18M", "IN": "12-18M", "height_cm": "77-83",   "weight_kg": "10-12", "g_chest_cm": "50", "g_length_cm": "44", "g_sleeve_cm": "28"},
    {"label": "2-3Y",   "US": "2T-3T",  "UK": "2-3Y",   "EU": "92-98",  "AU": "2-3",    "NZ": "2-3",    "CA": "2T-3T",  "IN": "2-3Y",   "height_cm": "84-95",   "weight_kg": "12-15", "g_chest_cm": "54", "g_length_cm": "48", "g_sleeve_cm": "31"},
    {"label": "3-4Y",   "US": "3T-4T",  "UK": "3-4Y",   "EU": "98-104", "AU": "3-4",    "NZ": "3-4",    "CA": "3T-4T",  "IN": "3-4Y",   "height_cm": "96-105",  "weight_kg": "15-17", "g_chest_cm": "57", "g_length_cm": "51", "g_sleeve_cm": "34"},
    {"label": "4-5Y",   "US": "4-5",    "UK": "4-5Y",   "EU": "104-110","AU": "4-5",    "NZ": "4-5",    "CA": "4-5",    "IN": "4-5Y",   "height_cm": "106-114", "weight_kg": "17-19", "g_chest_cm": "60", "g_length_cm": "54", "g_sleeve_cm": "37"},
    {"label": "6-7Y",   "US": "6-7",    "UK": "6-7Y",   "EU": "116-122","AU": "6-7",    "NZ": "6-7",    "CA": "6-7",    "IN": "6-7Y",   "height_cm": "115-126", "weight_kg": "19-23", "g_chest_cm": "65", "g_length_cm": "58", "g_sleeve_cm": "41"},
    {"label": "8-9Y",   "US": "8-9",    "UK": "8-9Y",   "EU": "128-134","AU": "8-9",    "NZ": "8-9",    "CA": "8-9",    "IN": "8-9Y",   "height_cm": "127-138", "weight_kg": "23-30", "g_chest_cm": "70", "g_length_cm": "62", "g_sleeve_cm": "45"},
    {"label": "10-12Y", "US": "10-12",  "UK": "10-12Y", "EU": "140-152","AU": "10-12",  "NZ": "10-12",  "CA": "10-12",  "IN": "10-12Y", "height_cm": "139-152", "weight_kg": "30-40", "g_chest_cm": "76", "g_length_cm": "68", "g_sleeve_cm": "50"},
]


# ---------------------------------------------------------------------------
# Shoes — women's. Source: ASTM F1166 + retail cross-walks.
# ---------------------------------------------------------------------------
SHOES_WOMENS: list[dict[str, str]] = [
    {"label": "5",  "US": "5",  "UK": "2.5", "EU": "35",    "AU": "4",  "NZ": "4",  "CA": "5",  "IN": "36",  "foot_cm": "22.0"},
    {"label": "6",  "US": "6",  "UK": "3.5", "EU": "36",    "AU": "5",  "NZ": "5",  "CA": "6",  "IN": "37",  "foot_cm": "22.5"},
    {"label": "7",  "US": "7",  "UK": "4.5", "EU": "37",    "AU": "6",  "NZ": "6",  "CA": "7",  "IN": "38",  "foot_cm": "23.5"},
    {"label": "8",  "US": "8",  "UK": "5.5", "EU": "38-39", "AU": "7",  "NZ": "7",  "CA": "8",  "IN": "39",  "foot_cm": "24.0"},
    {"label": "9",  "US": "9",  "UK": "6.5", "EU": "40",    "AU": "8",  "NZ": "8",  "CA": "9",  "IN": "40",  "foot_cm": "25.0"},
    {"label": "10", "US": "10", "UK": "7.5", "EU": "41",    "AU": "9",  "NZ": "9",  "CA": "10", "IN": "41",  "foot_cm": "25.5"},
    {"label": "11", "US": "11", "UK": "8.5", "EU": "42",    "AU": "10", "NZ": "10", "CA": "11", "IN": "42",  "foot_cm": "26.5"},
]

SHOES_MENS: list[dict[str, str]] = [
    {"label": "6",  "US": "6",  "UK": "5",  "EU": "38-39", "AU": "5",  "NZ": "5",  "CA": "6",  "IN": "39",  "foot_cm": "24.0"},
    {"label": "7",  "US": "7",  "UK": "6",  "EU": "40",    "AU": "6",  "NZ": "6",  "CA": "7",  "IN": "40",  "foot_cm": "25.0"},
    {"label": "8",  "US": "8",  "UK": "7",  "EU": "41-42", "AU": "7",  "NZ": "7",  "CA": "8",  "IN": "41",  "foot_cm": "26.0"},
    {"label": "9",  "US": "9",  "UK": "8",  "EU": "42-43", "AU": "8",  "NZ": "8",  "CA": "9",  "IN": "42",  "foot_cm": "27.0"},
    {"label": "10", "US": "10", "UK": "9",  "EU": "43-44", "AU": "9",  "NZ": "9",  "CA": "10", "IN": "43",  "foot_cm": "27.5"},
    {"label": "11", "US": "11", "UK": "10", "EU": "44-45", "AU": "10", "NZ": "10", "CA": "11", "IN": "44",  "foot_cm": "28.5"},
    {"label": "12", "US": "12", "UK": "11", "EU": "45-46", "AU": "11", "NZ": "11", "CA": "12", "IN": "45",  "foot_cm": "29.5"},
]


# ---------------------------------------------------------------------------
# Indian heritage — saree blouse, salwar/kurta and lehenga sizing.
# These are typically labelled with bust (inches) for blouse-stitch.
# ---------------------------------------------------------------------------
HERITAGE_BLOUSE: list[dict[str, str]] = [
    {"label": "XS",  "bust_in": "32", "bust_cm": "81",  "waist_in": "26", "intl_size": "XS"},
    {"label": "S",   "bust_in": "34", "bust_cm": "86",  "waist_in": "28", "intl_size": "S"},
    {"label": "M",   "bust_in": "36", "bust_cm": "91",  "waist_in": "30", "intl_size": "M"},
    {"label": "L",   "bust_in": "38", "bust_cm": "97",  "waist_in": "32", "intl_size": "L"},
    {"label": "XL",  "bust_in": "40", "bust_cm": "102", "waist_in": "34", "intl_size": "XL"},
    {"label": "XXL", "bust_in": "42", "bust_cm": "107", "waist_in": "36", "intl_size": "XXL"},
    {"label": "3XL", "bust_in": "44", "bust_cm": "112", "waist_in": "38", "intl_size": "3XL"},
]

HERITAGE_LEHENGA: list[dict[str, str]] = [
    {"label": "Free Size",   "waist_in": "26-44", "waist_cm": "66-112", "note": "Drawstring & dori adjustable"},
    {"label": "S (26-30)",   "waist_in": "26-30", "waist_cm": "66-76",  "note": "Stitched, fits 26-30 inch waist"},
    {"label": "M (32-34)",   "waist_in": "32-34", "waist_cm": "81-86",  "note": "Stitched, fits 32-34 inch waist"},
    {"label": "L (36-38)",   "waist_in": "36-38", "waist_cm": "91-97",  "note": "Stitched, fits 36-38 inch waist"},
    {"label": "XL (40-42)",  "waist_in": "40-42", "waist_cm": "102-107","note": "Stitched, fits 40-42 inch waist"},
]


# ---------------------------------------------------------------------------
# Jewellery — rings (numeric US scale) + Indian bangle diameter (inches).
# ---------------------------------------------------------------------------
RINGS: list[dict[str, str]] = [
    {"label": "US 5",  "US": "5",  "UK": "J",   "EU": "49",  "IN": "10", "diameter_mm": "15.7"},
    {"label": "US 6",  "US": "6",  "UK": "L",   "EU": "52",  "IN": "12", "diameter_mm": "16.5"},
    {"label": "US 7",  "US": "7",  "UK": "N",   "EU": "54",  "IN": "14", "diameter_mm": "17.3"},
    {"label": "US 8",  "US": "8",  "UK": "P",   "EU": "57",  "IN": "16", "diameter_mm": "18.1"},
    {"label": "US 9",  "US": "9",  "UK": "R",   "EU": "59",  "IN": "18", "diameter_mm": "19.0"},
    {"label": "US 10", "US": "10", "UK": "T",   "EU": "62",  "IN": "20", "diameter_mm": "19.8"},
    {"label": "US 11", "US": "11", "UK": "V",   "EU": "65",  "IN": "22", "diameter_mm": "20.6"},
    {"label": "US 12", "US": "12", "UK": "X",   "EU": "67",  "IN": "24", "diameter_mm": "21.4"},
]

BANGLES: list[dict[str, str]] = [
    {"label": "2.2", "IN": "2-2",  "diameter_cm": "5.6", "fit": "Petite / very slim"},
    {"label": "2.4", "IN": "2-4",  "diameter_cm": "6.1", "fit": "Slim / small wrist"},
    {"label": "2.6", "IN": "2-6",  "diameter_cm": "6.6", "fit": "Medium / regular"},
    {"label": "2.8", "IN": "2-8",  "diameter_cm": "7.1", "fit": "Large / loose fit"},
    {"label": "2.10","IN": "2-10", "diameter_cm": "7.6", "fit": "Extra large"},
    {"label": "2.12","IN": "2-12", "diameter_cm": "8.1", "fit": "Wide / decorative"},
]


# ---------------------------------------------------------------------------
# Master categories list — each entry says which table to render and
# what measurement columns belong to it.
# ---------------------------------------------------------------------------
CATEGORIES: list[dict[str, Any]] = [
    {
        "id": "womens_apparel",
        "label": "Women's Clothing",
        "kind": "apparel",
        "measurement_keys": ["bust_cm", "waist_cm", "hip_cm"],
        "columns": [{"key": k, "label": k} for k in COUNTRIES],
        "extra_columns": [
            {"key": "bust_cm", "label": "Bust (cm)"},
            {"key": "waist_cm", "label": "Waist (cm)"},
            {"key": "hip_cm", "label": "Hip (cm)"},
        ],
        "product_columns": [
            {"key": "g_shoulder_cm", "label": "Shoulder (cm)"},
            {"key": "g_chest_cm", "label": "Chest (cm)"},
            {"key": "g_length_cm", "label": "Length (cm)"},
            {"key": "g_sleeve_cm", "label": "Sleeve (cm)"},
        ],
        "rows": WOMENS_APPAREL,
        "applies_to_categories": ["Women's Clothing", "Ethnic Fashion"],
    },
    {
        "id": "mens_apparel",
        "label": "Men's Clothing",
        "kind": "apparel",
        "measurement_keys": ["chest_cm", "waist_cm"],
        "columns": [{"key": k, "label": k} for k in COUNTRIES],
        "extra_columns": [
            {"key": "chest_cm", "label": "Chest (cm)"},
            {"key": "waist_cm", "label": "Waist (cm)"},
        ],
        "product_columns": [
            {"key": "g_shoulder_cm", "label": "Shoulder (cm)"},
            {"key": "g_chest_cm", "label": "Chest (cm)"},
            {"key": "g_length_cm", "label": "Length (cm)"},
            {"key": "g_sleeve_cm", "label": "Sleeve (cm)"},
        ],
        "rows": MENS_APPAREL,
        "applies_to_categories": ["Men's Clothing"],
    },
    {
        "id": "kids_apparel",
        "label": "Kids' Fashion",
        "kind": "kids",
        "measurement_keys": ["height_cm", "weight_kg"],
        "columns": [{"key": k, "label": k} for k in COUNTRIES],
        "extra_columns": [
            {"key": "height_cm", "label": "Height (cm)"},
            {"key": "weight_kg", "label": "Weight (kg)"},
        ],
        "product_columns": [
            {"key": "g_chest_cm", "label": "Chest (cm)"},
            {"key": "g_length_cm", "label": "Length (cm)"},
            {"key": "g_sleeve_cm", "label": "Sleeve (cm)"},
        ],
        "rows": KIDS_APPAREL,
        "applies_to_categories": ["Kids' Fashion"],
    },
    {
        "id": "shoes_womens",
        "label": "Shoes — Women's",
        "kind": "shoes",
        "measurement_keys": ["foot_cm"],
        "columns": [{"key": k, "label": k} for k in COUNTRIES],
        "extra_columns": [
            {"key": "foot_cm", "label": "Foot (cm)"},
        ],
        "rows": SHOES_WOMENS,
        "applies_to_categories": ["Shoes"],
        "gender_hint": "women",
    },
    {
        "id": "shoes_mens",
        "label": "Shoes — Men's",
        "kind": "shoes",
        "measurement_keys": ["foot_cm"],
        "columns": [{"key": k, "label": k} for k in COUNTRIES],
        "extra_columns": [
            {"key": "foot_cm", "label": "Foot (cm)"},
        ],
        "rows": SHOES_MENS,
        "applies_to_categories": ["Shoes"],
        "gender_hint": "men",
    },
    {
        "id": "heritage_blouse",
        "label": "Saree Blouse / Kurti",
        "kind": "heritage",
        "measurement_keys": ["bust_cm", "bust_in"],
        "columns": [
            {"key": "label", "label": "Indian Size"},
            {"key": "bust_in", "label": "Bust (in)"},
            {"key": "bust_cm", "label": "Bust (cm)"},
            {"key": "waist_in", "label": "Waist (in)"},
            {"key": "intl_size", "label": "Equivalent (Intl)"},
        ],
        "extra_columns": [],
        "rows": HERITAGE_BLOUSE,
        "applies_to_categories": ["Ethnic Fashion"],
        "note": "Sarees ship pre-pleated 5.5m by default. Blouse can be stitched in any of these sizes — request via the seller chat after checkout.",
    },
    {
        "id": "heritage_lehenga",
        "label": "Lehenga / Ghagra",
        "kind": "heritage",
        "measurement_keys": ["waist_cm"],
        "columns": [
            {"key": "label", "label": "Size"},
            {"key": "waist_in", "label": "Waist (in)"},
            {"key": "waist_cm", "label": "Waist (cm)"},
            {"key": "note", "label": "Notes"},
        ],
        "extra_columns": [],
        "rows": HERITAGE_LEHENGA,
        "applies_to_categories": ["Ethnic Fashion"],
    },
    {
        "id": "rings",
        "label": "Rings",
        "kind": "jewelry",
        "measurement_keys": ["diameter_mm"],
        "columns": [
            {"key": "label", "label": "Size"},
            {"key": "US", "label": "US"},
            {"key": "UK", "label": "UK"},
            {"key": "EU", "label": "EU"},
            {"key": "IN", "label": "IN"},
            {"key": "diameter_mm", "label": "Ø (mm)"},
        ],
        "extra_columns": [],
        "rows": RINGS,
        "applies_to_categories": ["Jewelry & Accessories"],
    },
    {
        "id": "bangles",
        "label": "Bangles",
        "kind": "jewelry",
        "measurement_keys": ["diameter_cm"],
        "columns": [
            {"key": "label", "label": "Size"},
            {"key": "IN", "label": "Indian"},
            {"key": "diameter_cm", "label": "Ø (cm)"},
            {"key": "fit", "label": "Fit"},
        ],
        "extra_columns": [],
        "rows": BANGLES,
        "applies_to_categories": ["Jewelry & Accessories"],
    },
]


# ---------------------------------------------------------------------------
# Lookup helpers
# ---------------------------------------------------------------------------
def for_category(category: str) -> list[dict[str, Any]]:
    """Return all size guide tables relevant to a product `category`."""
    return [c for c in CATEGORIES if category in c["applies_to_categories"]]


def by_id(table_id: str) -> dict[str, Any] | None:
    return next((c for c in CATEGORIES if c["id"] == table_id), None)


# ---------------------------------------------------------------------------
# Recommendation: given body measurements + intended kind, return the
# best matching size label.
# ---------------------------------------------------------------------------
def _in_range(value: float, range_str: str) -> bool:
    """Check if `value` falls within a `"min-max"` string (inclusive)."""
    if not range_str:
        return False
    try:
        if "-" in range_str:
            lo, hi = (float(x.strip()) for x in range_str.split("-", 1))
            return lo <= value <= hi
        return value == float(range_str)
    except (TypeError, ValueError):
        return False


def recommend_size(
    kind: str,
    bust_cm: float | None = None,
    chest_cm: float | None = None,
    waist_cm: float | None = None,
    hip_cm: float | None = None,
    foot_cm: float | None = None,
    height_cm: float | None = None,
    gender: str | None = None,  # "women" | "men" — used for shoes
) -> dict[str, Any] | None:
    """Return the single best size match for the given body measurements.

    Strategy: pick the table by `kind` (apparel/shoes/kids), score every row
    by how many provided measurements fall in its range, and return the
    highest-scoring row (ties broken by the first match → smaller size).
    """
    if kind == "apparel" and (
        bust_cm is not None
        or chest_cm is not None
        or hip_cm is not None
        or waist_cm is not None
    ):
        # Determine which apparel table by gender hint
        if gender == "men":
            rows = MENS_APPAREL
            measure_map = {"chest_cm": chest_cm or bust_cm, "waist_cm": waist_cm}
        else:
            rows = WOMENS_APPAREL
            measure_map = {"bust_cm": bust_cm, "waist_cm": waist_cm, "hip_cm": hip_cm}
    elif kind == "shoes" and foot_cm is not None:
        rows = SHOES_MENS if gender == "men" else SHOES_WOMENS
        measure_map = {"foot_cm": foot_cm}
    elif kind == "kids" and height_cm is not None:
        rows = KIDS_APPAREL
        measure_map = {"height_cm": height_cm}
    else:
        return None

    best_row = None
    best_score = -1
    for row in rows:
        score = 0
        for key, value in measure_map.items():
            if value is None:
                continue
            if _in_range(value, row.get(key, "")):
                score += 1
        if score > best_score:
            best_score = score
            best_row = row
    if best_score <= 0:
        return None
    return best_row
