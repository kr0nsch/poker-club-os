"use client";

import type { PublicLiveSnapshot } from "@pcos/types";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Spinner } from "@pcos/ui";
import { useQuery } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Brand, LanguageSwitch } from "@/components/brand";
import { get } from "@/lib/api";
import { useFormat, useT } from "@/lib/i18n";
import { useMe } from "@/lib/queries";

/**
 * Links in notification messages point to /p/t/{slug} (without the club
 * slug). Resolve the club from the session and forward to the club page.
 */
export default function OrglessTournamentLink() {
  const { slug } = useParams<{ slug: string }>();
  const t = useT();
  const f = useFormat();
  const router = useRouter();
  const me = useMe();
  const org = me.data?.organization?.slug ?? null;
  const live = useQuery({
    queryKey: ["live", slug, "orgless"],
    queryFn: () => get<PublicLiveSnapshot>(`/api/v1/public/tournaments/${encodeURIComponent(slug)}/live`),
    enabled: me.isFetched && !org,
    retry: false,
  });

  useEffect(() => {
    if (org) router.replace(`/p/${org}/t/${slug}`);
  }, [org, slug, router]);

  const waiting = !me.isFetched || !!org || live.isLoading;
  return (
    <main className="felt flex min-h-dvh flex-col items-center justify-center gap-6 p-4">
      <Brand className="text-lg" />
      {waiting ? (
        <Spinner label={t("Loading…")} />
      ) : (
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle className="text-xl">{live.data?.tournament.name ?? t("Tournament")}</CardTitle>
            <CardDescription>
              {live.data ? `${live.data.tournament.organizationName} · ${f.dateTime(live.data.tournament.startAt)}` : t("Sign in to open this page.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild size="lg" className="w-full">
              <Link href={`/login?next=${encodeURIComponent(`/p/t/${slug}`)}`}>
                <LogIn /> {t("Sign in")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
      <LanguageSwitch />
    </main>
  );
}
