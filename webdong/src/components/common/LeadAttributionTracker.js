"use client";

import { useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { rememberLeadAttribution } from "@/lib/leadAttribution";

export default function LeadAttributionTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams?.toString() || "";

  useEffect(() => {
    rememberLeadAttribution();
  }, [pathname, search]);

  return null;
}
