"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { relativeTime } from "@/lib/client/format";
import { useFeedback, useNotifications, useNotificationUpdate } from "@/lib/client/queries";
import type { NotificationView } from "@/lib/execution/types";
import { useLocale, useT } from "@/lib/i18n/client";

/** Follow-up answers right inside the notification: the point is to learn whether you used it. */
function FollowUpButtons({ n }: { n: NotificationView }) {
  const t = useT();
  const feedback = useFeedback(n.itemId!);
  const opts =
    n.kind === "follow_up_d3"
      ? ([["used", "Used it"], ["remind_later", "Remind me later"]] as const)
      : ([["useful", "Useful"], ["not_using", "Not using it"], ["rolled_back", "Rolled back"]] as const);
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {opts.map(([kind, label]) => (
        <Button key={kind} size="xs" variant="outline" onClick={() => feedback.mutate({ kind, jobId: n.jobId ?? undefined })}>
          {t(label)}
        </Button>
      ))}
    </div>
  );
}

export function NotificationList({ notifications, onNavigate }: { notifications: NotificationView[]; onNavigate?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const update = useNotificationUpdate();
  if (notifications.length === 0) return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t("You’re all caught up.")}</p>;
  return (
    <ul className="flex flex-col divide-y">
      {notifications.map((n) => (
        <li key={n.id} className="px-3 py-3">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => {
              update.mutate({ id: n.id, read: true });
              onNavigate?.();
              router.push(n.jobId && n.itemId && ["approval_required", "user_action", "execution_result"].includes(n.kind) ? `/items/${n.itemId}/setup` : `/inbox?item=${n.itemId}`);
            }}
          >
            <span className="flex items-start justify-between gap-3">
              <span className={n.read ? "text-[13.5px] text-foreground/80" : "text-[13.5px] font-medium"}>{t(n.title)}</span>
              <time className="shrink-0 text-xs text-muted-foreground">{relativeTime(n.createdAt, locale)}</time>
            </span>
            {n.body && <span className="mt-0.5 line-clamp-2 block text-[13px] text-muted-foreground">{t(n.body)}</span>}
          </button>
          {n.itemId && (n.kind === "follow_up_d3" || n.kind === "follow_up_d7") && <FollowUpButtons n={n} />}
        </li>
      ))}
    </ul>
  );
}

export function NotificationBell() {
  const t = useT();
  const { data = [] } = useNotifications();
  const unread = data.filter((n) => !n.read).length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={unread ? t("Notifications, {n} unread", { n: unread }) : t("Notifications")} className="relative text-muted-foreground">
          <Bell />
          {unread > 0 && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-signal" aria-hidden />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="max-h-[70dvh] w-80 overflow-y-auto p-0">
        <p className="border-b px-3 py-2 text-[13px] font-medium">{t("Waiting for you")}</p>
        <NotificationList notifications={data} />
      </PopoverContent>
    </Popover>
  );
}
