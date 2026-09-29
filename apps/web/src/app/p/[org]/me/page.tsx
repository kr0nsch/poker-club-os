"use client";

import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from "@pcos/ui";
import { LogIn, UserRound } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useInbox, usePlayerSession, useProfile } from "@/components/player/api";
import { useFriendlyError } from "@/components/player/labels";
import { Inbox, NotificationPreferences } from "@/components/player/notifications";
import { HistoryList, KioskCodeCard, ProfileForm, ProfileHeader, TelegramCard } from "@/components/player/profile-sections";
import { useI18n, useT } from "@/lib/i18n";

function SignInPrompt({ org, staff }: { org: string; staff: boolean }) {
  const t = useT();
  const next = encodeURIComponent(`/p/${org}/me`);
  return (
    <Card className="mx-auto mt-4 max-w-md text-center">
      <CardHeader className="items-center">
        <span className="grid size-14 place-items-center rounded-full bg-primary/15 text-primary">
          <UserRound className="size-7" />
        </span>
        <CardTitle className="mt-2 text-xl">{t("Your player profile")}</CardTitle>
        <CardDescription>
          {staff ? t("You are signed in with a staff account. Sign in with a player account to see your profile.") : t("Sign in to see your registrations, notifications and tournament history.")}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        <Button asChild size="lg">
          <Link href={`/p/${org}/login?next=${next}`}>
            <LogIn /> {t("Sign in")}
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link href={`/p/${org}/signup?next=${next}`}>{t("Create a player account")}</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function MePage() {
  const { org } = useParams<{ org: string }>();
  const t = useT();
  const { locale } = useI18n();
  const friendly = useFriendlyError();
  const { isPlayer, signedIn, loading } = usePlayerSession(org);
  const profile = useProfile(isPlayer);
  const inbox = useInbox(isPlayer);
  const unread = inbox.data?.filter((n) => !n.readAt).length ?? 0;

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!isPlayer) return <SignInPrompt org={org} staff={signedIn} />;
  if (!profile.data) {
    return profile.isLoading ? (
      <div className="grid gap-4">
        <Skeleton className="h-14 w-2/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    ) : (
      <Alert variant="destructive">{friendly(profile.error).title}</Alert>
    );
  }

  const p = profile.data;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <ProfileHeader profile={p} org={org} />
      <KioskCodeCard />
      <Tabs defaultValue={unread > 0 ? "inbox" : "profile"}>
        {/* Three tabs on a 360 px phone: the inbox tab carries a badge, so it gets the wider column; labels
            truncate rather than pushing the page wider. */}
        <TabsList className="grid w-full grid-cols-[1.35fr_1fr_1fr] [&>button]:min-w-0 [&>button]:px-2">
          <TabsTrigger value="inbox">
            <span className="truncate">{t("Notifications")}</span>
            {unread > 0 && <span className="shrink-0 rounded-full bg-gold px-1.5 text-[10px] font-bold text-gold-foreground">{unread > 99 ? "99+" : unread}</span>}
          </TabsTrigger>
          <TabsTrigger value="profile">
            <span className="truncate">{t("Profile")}</span>
          </TabsTrigger>
          <TabsTrigger value="history">
            <span className="truncate">{t("Results")}</span>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <Inbox org={org} />
        </TabsContent>
        <TabsContent value="profile" className="grid gap-5">
          <ProfileForm key={[p.id, p.marketingConsent, p.publicProfileEnabled, p.nickname, p.phone, locale].join("|")} profile={p} />
          <TelegramCard />
          <section className="grid gap-3">
            <div>
              <h2 className="text-lg font-semibold">{t("Notification settings")}</h2>
              <p className="text-sm text-muted-foreground">{t("Choose where the club may notify you.")}</p>
            </div>
            <NotificationPreferences />
          </section>
        </TabsContent>
        <TabsContent value="history">
          <HistoryList profile={p} org={org} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
