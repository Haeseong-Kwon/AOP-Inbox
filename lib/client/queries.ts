"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import type { CollectionNode } from "@/lib/collections/repository";
import type { HomeStats } from "@/lib/items/repository";
import type { CaptureRequest, CaptureResponse, ItemDetail, ItemPage, ItemSummary, ListQuery, UpdateItemRequest } from "@/lib/items/types";
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
 * pending, nudge the job runner now and then. Cheap no-op when the queue is empty.
 */
export function useQueueNudge(active: boolean) {
  const last = useRef(0);
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (Date.now() - last.current < 15_000) return;
      last.current = Date.now();
      void fetch("/api/jobs/run", { method: "POST" }).catch(() => {});
    };
    const timer = setInterval(tick, 5000);
    return () => clearInterval(timer);
  }, [active]);
}
