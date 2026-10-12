"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { apiSend } from "@/lib/client/api";
import { keys, useCollections } from "@/lib/client/queries";
import type { ItemDetail } from "@/lib/items/types";

/** Manual collections only — AI placements are managed by the analyzer. */
export function AddToCollection({ item }: { item: ItemDetail }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { data: collections = [] } = useCollections();
  const qc = useQueryClient();
  const manual = collections.filter((c) => c.kind === "manual");
  const memberOf = new Set(item.collections.map((c) => c.id));

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.item(item.id) });
    void qc.invalidateQueries({ queryKey: keys.collections });
  };

  const toggle = async (collectionId: string) => {
    try {
      await apiSend(`/api/collections/${collectionId}/items`, "POST", { itemId: item.id, member: !memberOf.has(collectionId) });
      refresh();
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    try {
      const { id } = await apiSend<{ id: string }>("/api/collections", "POST", { name });
      await apiSend(`/api/collections/${id}/items`, "POST", { itemId: item.id, member: true });
      setQuery("");
      refresh();
      toast.success(`Added to ${name}`);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground transition-colors hover:border-solid hover:text-foreground"
        >
          <Plus className="size-3" aria-hidden /> Add to collection
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder="Find or create…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty className="py-2">
              {query.trim() ? (
                <button type="button" onClick={create} className="w-full px-3 py-1.5 text-left text-sm hover:bg-accent">
                  Create “{query.trim()}”
                </button>
              ) : (
                <span className="block px-3 py-1.5 text-sm text-muted-foreground">Type a name to create a collection.</span>
              )}
            </CommandEmpty>
            {manual.length > 0 && (
              <CommandGroup heading="Your collections">
                {manual.map((c) => (
                  <CommandItem key={c.id} value={c.name} onSelect={() => toggle(c.id)}>
                    <Check className={memberOf.has(c.id) ? "opacity-100" : "opacity-0"} aria-hidden />
                    {c.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {query.trim() && manual.some((c) => c.name.toLowerCase().includes(query.toLowerCase())) && (
              <CommandItem value={`create ${query}`} onSelect={create}>
                <Plus aria-hidden /> Create “{query.trim()}”
              </CommandItem>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
