import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/privacy
// (single source of truth via GET /api/policies/privacy).
export default function PrivacyPolicyRedirect() {
  return <Redirect href="/legal/privacy" />;
}
