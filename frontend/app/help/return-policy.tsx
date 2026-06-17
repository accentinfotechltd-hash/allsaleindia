import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/return
// (single source of truth via GET /api/policies/return).
export default function ReturnPolicyRedirect() {
  return <Redirect href="/legal/return" />;
}
