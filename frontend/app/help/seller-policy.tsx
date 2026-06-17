import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/seller
// (single source of truth via GET /api/policies/seller).
export default function SellerPolicyRedirect() {
  return <Redirect href="/legal/seller" />;
}
