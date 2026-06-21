"""Buyer-side tax & duty calculator.

Allsale ships **from India** to buyers worldwide. The destination country's tax
authority generally requires offshore retailers (above turnover thresholds) to
collect consumption tax for low-value parcels and remit it via a local
registration (NZ IRD, ATO, HMRC, etc.). Parcels above the low-value threshold
are taxed by customs at the border — we surface a clear "no surprise" warning
in that case so the buyer knows what's coming.

This module is a **pure function** so it can be reused by:
  * `services.cart.hydrate_cart()` — show GST line in cart
  * `routers.checkout.create_checkout_session_route()` — add tax to Stripe charge
  * `routers.invoices` — invoice line items
  * unit tests

NEVER call any DB or network here — keep deterministic.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

# ---------------------------------------------------------------------------
# Rule table — base case is "no tax, customs handles it at the border".
#
# Each rule expresses the destination country's policy for offshore retailers
# selling to that country's residents:
#
#   rate                : decimal consumption-tax rate (e.g. 0.15 for NZ GST)
#   label_key           : i18n key for the line label (resolves on frontend)
#   threshold_nzd       : NZ-dollar value of the destination's low-value
#                         goods threshold. Subtotal+shipping must be at or
#                         under this to be collected by us; above it, customs
#                         charges at the border.
#   includes_shipping   : True if tax is computed on (goods + shipping)
#                         rather than just goods (NZ/AU/UK all do this)
#   inclusive           : True if tax is already baked into the seller's
#                         price — we surface a transparency note only
# ---------------------------------------------------------------------------

# Conversion snapshots (NZD basis, Jun 2026). The thresholds are *legal* limits
# in destination currency — we convert them to NZD so the rule fires off the
# same currency as cart totals.
TAX_RULES: dict[str, dict] = {
    "NZ": {
        "rate": 0.15,
        "label_key": "tax.nz_gst",
        "threshold_nzd": 1000.0,        # NZ$1,000 — IRD low-value threshold
        "includes_shipping": True,
        "inclusive": False,
    },
    "AU": {
        "rate": 0.10,
        "label_key": "tax.au_gst",
        "threshold_nzd": 1100.0,        # AU$1,000 ≈ NZ$1,100
        "includes_shipping": True,
        "inclusive": False,
    },
    "GB": {
        "rate": 0.20,
        "label_key": "tax.uk_vat",
        "threshold_nzd": 280.0,         # £135 ≈ NZ$280
        "includes_shipping": True,
        "inclusive": False,
    },
    "US": {
        "rate": 0.0,                    # No federal VAT; states handled later
        "label_key": None,
        "threshold_nzd": 1300.0,        # US$800 de-minimis (CBP)
        "includes_shipping": False,
        "inclusive": False,
    },
    "CA": {
        "rate": 0.0,                    # GST/HST varies by province
        "label_key": None,
        "threshold_nzd": 30.0,          # CAD$20 ≈ NZ$23 (very low)
        "includes_shipping": False,
        "inclusive": False,
    },
    "IN": {
        # India domestic — seller's price already includes 18% IGST.
        "rate": 0.0,
        "label_key": "tax.in_gst_inclusive",
        "threshold_nzd": float("inf"),  # No threshold concept
        "includes_shipping": False,
        "inclusive": True,
    },
    # Pacific tail — no consumer-side import-tax collection scheme exists
    # for offshore retailers; small-value goods clear customs without tax,
    # large parcels are taxed at the border via Customs.
    "FJ": {
        "rate": 0.0, "label_key": None,
        "threshold_nzd": 50.0, "includes_shipping": False, "inclusive": False,
    },
    "PG": {
        "rate": 0.0, "label_key": None,
        "threshold_nzd": 50.0, "includes_shipping": False, "inclusive": False,
    },
    "WS": {
        "rate": 0.0, "label_key": None,
        "threshold_nzd": 50.0, "includes_shipping": False, "inclusive": False,
    },
    "TO": {
        "rate": 0.0, "label_key": None,
        "threshold_nzd": 50.0, "includes_shipping": False, "inclusive": False,
    },
}

_DEFAULT_RULE = {
    "rate": 0.0, "label_key": None,
    "threshold_nzd": 0.0, "includes_shipping": False, "inclusive": False,
}


@dataclass
class TaxResult:
    """All the fields a cart / invoice / order needs to display tax."""
    country: str
    rate: float                          # 0.15 = 15%
    tax_nzd: float                       # actual amount we will charge
    label_key: Optional[str]             # i18n key for the line label
    threshold_nzd: float                 # destination low-value threshold
    over_threshold: bool                 # True → customs collects at border
    at_border: bool                      # True if no tax charged AND duties expected at border
    inclusive: bool                      # True for IN (already in price)

    def to_dict(self) -> dict:
        return {
            "tax_country": self.country,
            "tax_rate": self.rate,
            "tax_nzd": round(self.tax_nzd, 2),
            "tax_label_key": self.label_key,
            "tax_threshold_nzd": self.threshold_nzd,
            "tax_over_threshold": self.over_threshold,
            "tax_at_border": self.at_border,
            "tax_inclusive": self.inclusive,
        }


def compute_tax(
    *,
    subtotal_nzd: float,
    shipping_nzd: float,
    country: str,
) -> TaxResult:
    """Compute consumption tax for a cart total.

    The amount returned is in **NZD** because the rest of the platform
    stores totals in NZD and converts to buyer currency at Stripe time.

    Args:
      subtotal_nzd: Goods subtotal in NZD (BEFORE discounts — tax is
        legally computed on the gross sale price in NZ; we keep it
        simple for now).
      shipping_nzd: Shipping cost in NZD.
      country: ISO-2 destination country (uppercased).

    Returns:
      TaxResult — pure data, easy to attach to CartView / Order.
    """
    country = (country or "NZ").upper()
    rule = TAX_RULES.get(country, _DEFAULT_RULE)
    taxable = subtotal_nzd + (shipping_nzd if rule["includes_shipping"] else 0.0)
    over = taxable > rule["threshold_nzd"]

    # Above the destination's low-value threshold? Tax is collected at the
    # border — we don't charge it.
    if over and not rule["inclusive"]:
        return TaxResult(
            country=country,
            rate=rule["rate"],
            tax_nzd=0.0,
            label_key=rule["label_key"],
            threshold_nzd=rule["threshold_nzd"],
            over_threshold=True,
            at_border=True,
            inclusive=False,
        )

    tax = round(taxable * rule["rate"], 2) if rule["rate"] > 0 else 0.0

    return TaxResult(
        country=country,
        rate=rule["rate"],
        tax_nzd=tax,
        label_key=rule["label_key"],
        threshold_nzd=rule["threshold_nzd"],
        over_threshold=False,
        at_border=(rule["rate"] == 0.0 and not rule["inclusive"]),
        inclusive=rule["inclusive"],
    )
