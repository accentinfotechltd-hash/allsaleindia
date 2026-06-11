import React from "react";
import PolicyScreen from "@/src/components/PolicyScreen";

export default function CancellationPolicy() {
  return (
    <PolicyScreen
      testID="policy-cancel"
      title="Cancellation Policy"
      effective="Effective June 2026"
      intro="You can cancel any paid order for a full refund within 12 hours of placing it, provided the seller has not yet dispatched the parcel. After that window the order moves into preparation and standard returns rules apply."
      sections={[
        {
          heading: "12-hour cancellation window",
          bullets: [
            "You have 12 hours from the moment your payment is confirmed to cancel",
            "The exact deadline is shown on the order screen as a live countdown",
            "Once the courier has picked up the parcel (status \u201cShipped\u201d), cancellation is no longer possible \u2014 please request a return instead",
          ],
        },
        {
          heading: "How to cancel",
          bullets: [
            "Open the order under My Orders",
            "Tap \u201cCancel order\u201d while the countdown is still running",
            "Choose a reason (optional) and confirm",
            "You\u2019ll receive an in-app notification immediately, and the seller and Allsale support are notified too",
          ],
        },
        {
          heading: "Refunds for cancellations",
          body: "Cancellations within the 12-hour window receive a full refund to your original Stripe payment method in NZD. Most refunds appear on your statement within 5\u201310 business days.",
        },
        {
          heading: "Seller-initiated cancellations",
          bullets: [
            "If a seller is unable to fulfil an order (out of stock, NZ MPI compliance failure, etc.) they may cancel it within 24 hours of receiving it",
            "You will be notified instantly and refunded in full",
            "Allsale credits the seller a strike against their service-level rating",
          ],
        },
        {
          heading: "What if I miss the window?",
          body: "Once the 12-hour window passes the order cannot be cancelled. If it has not yet shipped, you can email support@allsale.co.nz \u2014 we will try our best, but cannot guarantee a refund. After dispatch, please wait for delivery and follow the Return Policy.",
        },
        {
          heading: "Subscriptions and pre-orders",
          body: "Pre-ordered items can be cancelled at any time before the seller marks them as dispatched. Allsale does not currently offer subscription products.",
        },
      ]}
    />
  );
}
