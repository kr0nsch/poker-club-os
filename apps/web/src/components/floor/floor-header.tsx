"use client";

import { Button } from "@pcos/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectivityBadge, ConnectivityBanner } from "@/components/connectivity";
import { UserMenu } from "@/components/user-menu";

export function FloorHeader({ back, title, children }: { back: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background">
      <ConnectivityBanner />
      <div className="flex h-14 items-center gap-2 px-3">
        <Button asChild variant="ghost" size="icon">
          <Link href={back} aria-label="Back">
            <ArrowLeft />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2">{title}</div>
        {children}
        <ConnectivityBadge />
        <UserMenu />
      </div>
    </header>
  );
}
