import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/terms
// (single source of truth via GET /api/policies/terms).
export default function TermsConditionsRedirect() {
  return <Redirect href="/legal/terms" />;
}
