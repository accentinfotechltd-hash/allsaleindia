import { api } from "@/src/lib/api";

export type TaxonomyNode = {
  key: string;
  name: string;
  blurb: string;
  subcategories: string[];
};

export type DutyEstimate = {
  goods_nzd: number;
  shipping_nzd: number;
  gst_nzd: number;
  duty_nzd: number;
  customs_total_nzd: number;
  grand_total_nzd: number;
  threshold_nzd: number;
  over_threshold: boolean;
};

export type ProhibitedResult = {
  allowed: boolean;
  matched_term?: string | null;
  reason?: string | null;
  advice: string;
};

export const NZ_FAQS = [
  {
    q: "Can I send homemade food to NZ?",
    a: "No. NZ MPI bans all homemade, fresh, dairy, meat, seeds, and honey. Only sealed, branded, commercial food is allowed.",
  },
  {
    q: "Do I pay NZ customs duty?",
    a: "Orders under NZD 1000 pay 15% GST only. Over NZD 1000 pay GST + 10% duty. We calculate this at checkout.",
  },
  {
    q: "What if NZ customs blocks my parcel?",
    a: "We pre-screen all items against MPI rules before shipping. If NZ rejects it, we help with appeal or refund shipping cost.",
  },
];

export const TRUST_POINTS = [
  "NZ Biosecurity checked",
  "GST & duty calculated",
  "Insured shipping",
];

export async function fetchTaxonomy(): Promise<TaxonomyNode[]> {
  return api<TaxonomyNode[]>("/taxonomy", { auth: false });
}

export async function estimateDuty(items: { price_nzd: number; quantity: number }[], shippingNzd: number): Promise<DutyEstimate> {
  return api<DutyEstimate>("/duty/estimate", {
    method: "POST",
    auth: false,
    body: { items, shipping_nzd: shippingNzd },
  });
}

export async function checkProhibited(text: string): Promise<ProhibitedResult> {
  return api<ProhibitedResult>("/prohibited/check", {
    method: "POST",
    auth: false,
    body: { text },
  });
}
