/**
 * Buyer ticket detail — reuses the existing seller-side ticket viewer.
 *
 * The `/seller/support/[id]` screen drives the same backend endpoint
 * (`GET /api/support/tickets/{id}`) which the backend authorises on
 * ticket ownership, not role. Redirecting here keeps maintenance to a
 * single screen instead of duplicating the chat thread UI.
 */
import { Redirect, useLocalSearchParams } from "expo-router";
import React from "react";

export default function TicketDetailRedirect() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!id) return <Redirect href="/help/my-tickets" />;
  return <Redirect href={`/seller/support/${id}`} />;
}
