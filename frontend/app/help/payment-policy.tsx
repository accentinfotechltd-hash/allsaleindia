import React from "react";
import PolicyScreen from "@/src/components/PolicyScreen";

export default function PaymentPolicy() {
  return (
    <PolicyScreen
      testID="policy-payment"
      title="Payment Policy"
      effective="Effective June 2026"
      intro="Allsale is a cross-border marketplace connecting verified India-registered sellers with buyers in New Zealand. All prices and charges are shown in NZD (New Zealand Dollars)."
      sections={[
        {
          heading: "Accepted payment methods",
          bullets: [
            "Visa, Mastercard, American Express (via Stripe NZ)",
            "Apple Pay and Google Pay where supported by your device",
            "All payments are processed in NZD with 3D Secure where required by your bank",
          ],
        },
        {
          heading: "Pricing and taxes",
          bullets: [
            "All product prices on Allsale are listed in NZD and include GST where applicable",
            "New Zealand GST (15%) is applied at checkout in line with NZ IRD rules for cross-border supplies",
            "Orders over NZD 1,000 may incur additional NZ Customs duty (10%); see the Duty Calculator before you check out",
            "Shipping is free for orders over NZD 100, otherwise a flat NZD 12 fee applies",
          ],
        },
        {
          heading: "When you are charged",
          body: "You are charged in full at the time of placing the order. Funds are held by Allsale and released to the seller only after the goods are confirmed delivered and the 10-day buyer-protection window has elapsed.",
        },
        {
          heading: "Currency and FX",
          bullets: [
            "You always pay in NZD — Allsale absorbs the FX risk between NZD and INR",
            "Sellers are paid in INR after conversion at the rate prevailing on the payout date",
            "We never charge a hidden FX markup to buyers",
          ],
        },
        {
          heading: "Security",
          body: "We never see or store your full card number. All card data is tokenised by Stripe and held to PCI-DSS Level 1 standards. Your transactions are protected by Stripe Radar fraud detection and 3D Secure 2.",
        },
        {
          heading: "Failed payments and chargebacks",
          bullets: [
            "If a payment fails, no order is created and no funds are captured",
            "If you do not recognise a charge, please contact us first — chargebacks may delay refunds by 30+ days",
            "Allsale cooperates fully with your bank and Stripe on any chargeback case",
          ],
        },
        {
          heading: "Refunds",
          body: "Refunds are always issued in NZD to your original payment method. Most refunds appear on your statement within 5\u201310 business days. See our Return Policy and Cancellation Policy for when refunds apply.",
        },
      ]}
    />
  );
}
