"use client";

import { Spinner } from "@pcos/ui";
import type { MeView, Permission } from "@pcos/types";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useMe } from "@/lib/queries";

const MeCtx = createContext<MeView | null>(null);

export function useStaff(): MeView {
  const me = useContext(MeCtx);
  if (!me) throw new Error("useStaff outside StaffGuard");
  return me;
}

export function useCan() {
  const me = useContext(MeCtx);
  return (p: Permission) => !!me && (me.user?.isSuperAdmin || me.permissions.includes(p));
}

/** Staff surfaces require a staff session; the API enforces it again on every request. */
export function StaffGuard({ children }: { children: ReactNode }) {
  const me = useMe();
  const router = useRouter();
  const path = usePathname();
  const ok = !!me.data && me.data.permissions.length > 0;
  useEffect(() => {
    if (me.isLoading) return;
    if (!ok) router.replace(`/login?next=${encodeURIComponent(path)}`);
  }, [me.isLoading, ok, router, path]);
  if (!ok) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <Spinner />
      </div>
    );
  }
  return <MeCtx.Provider value={me.data!}>{children}</MeCtx.Provider>;
}
