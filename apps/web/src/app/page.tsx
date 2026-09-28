"use client";

import { Spinner } from "@pcos/ui";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { get } from "@/lib/api";
import { useMe } from "@/lib/queries";

/** Entry point: route each person to their surface. */
export default function Home() {
  const router = useRouter();
  const setup = useQuery({ queryKey: ["setup"], queryFn: () => get<{ needsSetup: boolean }>("/api/v1/auth/setup") });
  const me = useMe();
  useEffect(() => {
    if (setup.data?.needsSetup) return router.replace("/setup");
    if (!me.data || setup.isLoading) return;
    if (me.data.permissions.length > 0) router.replace("/admin");
    else if (me.data.player && me.data.organization) router.replace(`/p/${me.data.organization.slug}`);
    else router.replace("/login");
  }, [setup.data, setup.isLoading, me.data, router]);
  return (
    <main className="felt grid min-h-dvh place-items-center">
      <Spinner label="Poker Club OS" />
    </main>
  );
}
