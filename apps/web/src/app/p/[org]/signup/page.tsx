"use client";

import { Skeleton } from "@pcos/ui";
import { useParams } from "next/navigation";
import { Suspense } from "react";
import { SignupForm } from "@/components/player/auth-forms";

export default function PlayerSignupPage() {
  const { org } = useParams<{ org: string }>();
  return (
    <Suspense fallback={<Skeleton className="mx-auto h-[36rem] w-full max-w-md" />}>
      <SignupForm org={org} />
    </Suspense>
  );
}
