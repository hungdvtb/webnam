"use client";

import { useEffect } from "react";
import { rememberLeadAttribution } from "@/lib/leadAttribution";

export default function LeadAttributionTracker() {
  useEffect(() => {
    rememberLeadAttribution();
  }, []);

  return null;
}
