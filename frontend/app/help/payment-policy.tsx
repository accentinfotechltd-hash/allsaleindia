import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/payment
// (single source of truth via GET /api/policies/payment).
export default function PaymentPolicyRedirect() {
  return <Redirect href="/legal/payment" />;
}
