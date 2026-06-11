import React from "react";
import PolicyScreen from "@/src/components/PolicyScreen";

export default function ReturnPolicy() {
  return (
    <PolicyScreen
      testID="policy-return"
      title="Return Policy"
      effective="Effective June 2026"
      intro="Cross-border returns from New Zealand to India are expensive and slow, so please choose carefully. Where the law or our policy entitles you to a return, we make it as simple as we can."
      sections={[
        {
          heading: "7-day return window",
          body: "You can request a return within 7 days of the parcel being delivered. Requests received after this window cannot be accepted, except where required by the NZ Consumer Guarantees Act (e.g. major defects).",
        },
        {
          heading: "Acceptable return reasons",
          bullets: [
            "Damaged on arrival (report within 48 hours with photos)",
            "Wrong item received",
            "Not as described on the listing",
            "Defective or not working as intended",
            "Changed your mind (buyer-paid return shipping + 15% restocking fee)",
          ],
        },
        {
          heading: "Who pays return shipping?",
          bullets: [
            "Defective, damaged or wrong item: the seller pays — we issue a prepaid return label",
            "Change of mind: you pay the return shipping cost back to our NZ consolidation hub",
            "International return courier to India is arranged by Allsale on behalf of the seller",
          ],
        },
        {
          heading: "Restocking fee",
          body: "For change-of-mind returns a 15% restocking fee is deducted from your refund. This covers cross-border re-handling, repackaging and re-listing costs. There is no restocking fee for defective or wrong items.",
        },
        {
          heading: "Items we cannot accept back",
          bullets: [
            "Perishables, food and groceries (sealed or unsealed)",
            "Personal hygiene and intimate apparel",
            "Custom-made or personalised items (e.g. tailored sarees, engraved gifts)",
            "Opened software, digital downloads and activation keys",
            "Gift cards and vouchers",
          ],
        },
        {
          heading: "How to request a return",
          bullets: [
            "Open the order under My Orders",
            "Tap \u201cRequest return\u201d (available while you are within the 7-day window)",
            "Select a reason, attach up to 4 photos and submit",
            "The seller has 48 hours to approve; if not, Allsale Trust & Safety steps in",
          ],
        },
        {
          heading: "When you receive your refund",
          body: "Once the returned item is received at our NZ hub and inspected, your refund is issued to your original Stripe payment method (in NZD) within 5\u201310 business days. For change-of-mind returns the restocking fee and original outbound shipping are non-refundable.",
        },
        {
          heading: "Damaged in transit",
          body: "If the parcel arrives visibly damaged, photograph it before opening, refuse delivery if possible, and contact us within 48 hours. Cross-border parcels are insured via Shiprocket X and you are fully protected.",
        },
      ]}
    />
  );
}
