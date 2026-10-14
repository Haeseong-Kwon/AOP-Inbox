"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toast } from "sonner";
import type { CollectionNode } from "@/lib/collections/repository";
import type { HomeStats } from "@/lib/items/repository";
import type { CaptureRequest, CaptureResponse, ItemDetail, ItemPage, ItemSummary, ListQuery, UpdateItemRequest } from "@/lib/items/types";
import type { ActivityEntry, DeviceView, JobView, NotificationView, SetupView } from "@/lib/execution/types";
import { useT } from "@/lib/i18n/client";
import { apiGet, apiSend, qs } from "./api";

export type ListFilters = Partial<Omit<ListQuery, "cursor" | "limit">>;

export const keys = {
  items: (f: ListFilters) => ["items", f] as const,
  item: (id: string) => ["item", id] as const,
  related: (id: string) => ["related", id] as const,
  home: ["home"] as const,
  collections: ["collections"] as const,
  search: (q: string) => ["search", q] as const,
};

const isProcessing = (i: { processingStatus: string }) => i.processingStatus === "pending" || i.processingStatus === "processing";

/* Polling: while anything on screen is still being analyzed, refresh every few seconds. */
const POLL_MS = 3000;

export function useItems(filters: ListFilters) {
  return useInfiniteQuery({
    queryKey: keys.items(filters),
    queryFn: ({ pageParam, signal }) => apiGet<ItemPage>(`/api/items${qs({ ...filters, cursor: pageParam, limit: 40 })}`, signal),
    initialPageParam: 0,
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some(isProcessing)) ? POLL_MS : false),
  });
}

export function useItem(id: string | null) {
  return useQuery({
    queryKey: keys.item(id ?? ""),
    queryFn: ({ signal }) => apiGet<ItemDetail>(`/api/items/${id}`, signal),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data && isProcessing(q.state.data) ? POLL_MS : false),
  });
}

export function useRelated(id: string | null, ready: boolean) {
  return useQuery({
    queryKey: keys.related(id ?? ""),
    queryFn: ({ signal }) => apiGet<{ items: ItemSummary[] }>(`/api/items/${id}/related`, signal),
    enabled: Boolean(id) && ready,
    select: (d) => d.items,
  });
}

export interface HomeData {
  stats: HomeStats;
  recent: ItemSummary[];
  unread: ItemSummary[];
  highValue: ItemSummary[];
  continueReading: ItemSummary[];
  collections: CollectionNode[];
  readyToApply: ItemSummary[];
  waitingForYou: ItemSummary[];
  recentlyApplied: ItemSummary[];
  notifications: NotificationView[];
}

export function useHome() {
  return useQuery({
    queryKey: keys.home,
    queryFn: ({ signal }) => apiGet<HomeData>("/api/home", signal),
    refetchInterval: (q) => (q.state.data?.stats.processing ? POLL_MS : false),
  });
}

export function useCollections() {
  return useQuery({
    queryKey: keys.collections,
    queryFn: ({ signal }) => apiGet<{ collections: CollectionNode[] }>("/api/collections", signal),
    select: (d) => d.collections,
    staleTime: 30_000,
  });
}

function patchCachedItem(qc: QueryClient, id: string, patch: Partial<ItemSummary>) {
  qc.setQueriesData<InfiniteData<ItemPage>>({ queryKey: ["items"] }, (data) =>
    data ? { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })) } : data,
  );
  qc.setQueryData<ItemDetail>(keys.item(id), (d) => (d ? { ...d, ...patch } : d));
}

export function useUpdateItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateItemRequest }) => apiSend<ItemDetail>(`/api/items/${id}`, "PATCH", patch),
    onMutate: ({ id, patch }) => {
      const { viewed, userNote, ...rest } = patch;
      void viewed;
      void userNote;
      patchCachedItem(qc, id, rest as Partial<ItemSummary>);
    },
    onSuccess: (item) => {
      qc.setQueryData(keys.item(item.id), item);
      patchCachedItem(qc, item.id, item);
    },
    onError: (error) => {
      toast.error(error.message);
      void qc.invalidateQueries({ queryKey: ["items"] });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

export function useDeleteItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<void>(`/api/items/${id}`, "DELETE"),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["items"] });
      void qc.invalidateQueries({ queryKey: keys.home });
      void qc.invalidateQueries({ queryKey: keys.collections });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useReprocess() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiSend<{ ok: true }>(`/api/items/${id}/reprocess`, "POST"),
    onSuccess: (_d, id) => {
      patchCachedItem(qc, id, { processingStatus: "pending", processingError: null });
      void qc.invalidateQueries({ queryKey: keys.item(id) });
    },
    onError: (error) => toast.error(error.message),
  });
}

export function useCapture() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (req: CaptureRequest) => apiSend<CaptureResponse>("/api/capture", "POST", req),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["items"] });
      void qc.invalidateQueries({ queryKey: keys.home });
    },
  });
}

/**
 * After a big import the queue can outlive one request. While items are still
 * pending, keep the job runner going. Cheap no-op when the queue is empty.
 */
export function useQueueNudge(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      let processed = 0;
      try {
        const res = await fetch("/api/jobs/run", { method: "POST" });
        processed = ((await res.json()) as { processed?: number }).processed ?? 0;
      } catch {
        // offline or busy — try again later
      }
      // While there's a backlog, drain back-to-back; otherwise look again in a bit.
      if (!stopped) timer = setTimeout(run, processed > 0 ? 0 : 15_000);
    };
    timer = setTimeout(run, 1_000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [active]);
}

/* ─── Action layer ─────────────────────────────────────────────────────── */


const ACTIVE_JOB = new Set(["planning", "awaiting_approval", "queued", "executing", "verifying", "rolling_back"]);

export function useSetup(itemId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["setup", itemId],
    queryFn: ({ signal }) => apiGet<{ setup: SetupView | null }>(`/api/items/${itemId}/setup`, signal),
    enabled: Boolean(itemId) && enabled,
    select: (d) => d.setup,
    refetchInterval: (q) => (q.state.data?.setup?.job && ACTIVE_JOB.has(q.state.data.setup.job.status) ? 2000 : false),
  });
}

function invalidateActionViews(qc: QueryClient, itemId?: string | null) {
  void qc.invalidateQueries({ queryKey: ["setup"] });
  void qc.invalidateQueries({ queryKey: ["activity"] });
  void qc.invalidateQueries({ queryKey: ["notifications"] });
  void qc.invalidateQueries({ queryKey: keys.home });
  void qc.invalidateQueries({ queryKey: ["items"] });
  if (itemId) void qc.invalidateQueries({ queryKey: keys.item(itemId) });
}

export function useRunSetup(itemId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => apiSend<{ job: JobView }>(`/api/items/${itemId}/setup/run`, "POST"),
    onSuccess: () => invalidateActionViews(qc, itemId),
    onError: (e) => toast.error(e.message),
  });
}

export function useJobAction(itemId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId, action }: { jobId: string; action: "approve" | "reject" | "undo" | "continue" }) => apiSend<{ job: JobView }>(`/api/execution/${jobId}/${action}`, "POST"),
    onSuccess: () => invalidateActionViews(qc, itemId),
    onError: (e) => toast.error(e.message),
  });
}

export function useCheckActions(itemId: string) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: () => apiSend<{ ok: true }>(`/api/items/${itemId}/actions/analyze`, "POST"),
    onSuccess: () => {
      toast(t("Looking for actions…"));
      invalidateActionViews(qc, itemId);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useFeedback(itemId: string) {
  const qc = useQueryClient();
  const t = useT();
  return useMutation({
    mutationFn: (body: { kind: "used" | "useful" | "not_using" | "rolled_back" | "remind_later" | "applied"; jobId?: string }) =>
      apiSend<{ ok: true }>(`/api/items/${itemId}/feedback`, "POST", body),
    onSuccess: (_d, v) => {
      toast(t(v.kind === "remind_later" ? "We'll remind you in two days" : v.kind === "applied" ? "Marked as applied" : "Thanks — noted"));
      invalidateActionViews(qc, itemId);
    },
    onError: (e) => toast.error(e.message),
  });
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: ({ signal }) => apiGet<{ notifications: NotificationView[] }>("/api/notifications", signal),
    select: (d) => d.notifications,
    refetchInterval: 30_000,
  });
}

export function useNotificationUpdate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; read?: true; resolved?: true }) => apiSend(`/api/notifications/${id}`, "PATCH", body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useActivity() {
  return useQuery({
    queryKey: ["activity"],
    queryFn: ({ signal }) =>
      apiGet<{ entries: ActivityEntry[]; applied: { id: string; title: string | null; appliedAt: string | null; sourceType: string }[]; stats: { appliedThisWeek: number; appliedTotal: number } }>(
        "/api/activity",
        signal,
      ),
    refetchInterval: (q) => (q.state.data?.entries.some((e) => ACTIVE_JOB.has(e.status)) ? 3000 : false),
  });
}

export function useDevices() {
  return useQuery({
    queryKey: ["devices"],
    queryFn: ({ signal }) => apiGet<{ devices: DeviceView[]; executionPaused: boolean }>("/api/devices", signal),
    refetchInterval: 15_000,
  });
}
