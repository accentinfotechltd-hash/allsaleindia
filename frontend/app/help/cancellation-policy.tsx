import { Redirect } from "expo-router";

// Backwards-compat shim — content now lives at /legal/cancellation
// (single source of truth via GET /api/policies/cancellation).
export default function CancellationPolicyRedirect() {
  return <Redirect href="/legal/cancellation" />;
}
