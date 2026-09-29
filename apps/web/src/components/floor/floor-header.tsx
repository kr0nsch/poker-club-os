"use client";

import { Button, cn } from "@pcos/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { ConnectivityBadge, ConnectivityBanner } from "@/components/connectivity";
import { UserMenu } from "@/components/user-menu";

/** `width` matches the page's content column so the header edges line up with it on wide screens. */
export function FloorHeader({ back, title, children, width = "max-w-[120rem]" }: { back: string; title: ReactNode; children?: ReactNode; width?: string }) {
  return (
    <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-background/80 backdrop-blur-xl">
      <ConnectivityBanner />
      <div className={cn("mx-auto flex h-14 w-full items-center gap-2 px-3 md:px-4 2xl:px-6", width)}>
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
