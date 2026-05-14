"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { rememberLeadAttribution } from "@/lib/leadAttribution";

export default function LeadAttributionTracker() {
  const pathname = usePathname();

  useEffect(() => {
    rememberLeadAttribution();
  }, [pathname]);

  return null;
}
