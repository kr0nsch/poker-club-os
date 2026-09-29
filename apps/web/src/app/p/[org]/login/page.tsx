"use client";

import { Skeleton } from "@pcos/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { LoginForm } from "@/components/player/auth-forms";

export default function PlayerLoginPage() {
  const { org } = useParams<{ org: string }>();
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-80 w-full max-w-md" />}>
      <LoginForm org={org} />
    </Suspense>
  );
}
