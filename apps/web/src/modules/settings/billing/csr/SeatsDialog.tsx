"use client";

import { CircleAlert, Users } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SeatUsage } from "@/lib/types/billing";
import { useBillingActions } from "./billing-actions-context";

/**
 * Changes how many seats are licensed: at least the seats in use, at most the
 * plan's limit. Plans are flat-priced, so this never changes the price; it
 * caps how many members and invitations the organization can have.
 */
export function SeatsDialog({ open, onOpenChange, seats, planName }: { open: boolean; onOpenChange: (open: boolean) => void; seats: SeatUsage; planName: string }) {
  const { run, busy, version } = useBillingActions();
  const id = useId();
  const [value, setValue] = useState(String(seats.licensed ?? seats.min));
  const [error, setError] = useState<string | null>(null);
  const quantity = Number(value);
  const valid = value.trim() !== "" && Number.isInteger(quantity) && quantity >= seats.min && quantity <= seats.max;
  const unchanged = quantity === seats.licensed;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || unchanged || version === null) return;
    setError(null);
    const result = await run({ action: "change_seats", seatQuantity: quantity, expectedVersion: version }, `${quantity} seats licensed`);
    if (result.ok) onOpenChange(false);
    else setError(result.error ?? null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Users aria-hidden className="text-primary size-5" />
              Manage licensed seats
            </DialogTitle>
            <DialogDescription>
              {seats.used} in use (members and pending invitations). The {planName} plan allows {seats.planLimit === null ? "unlimited seats" : `up to ${seats.planLimit}`}. Seats do
              not change the price.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-foreground text-sm font-medium">
              Licensed seats
            </label>
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={seats.min}
              max={seats.max}
              step={1}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setError(null);
              }}
              aria-invalid={!valid}
              aria-describedby={`${id}-hint`}
              className="font-mono"
            />
            <p id={`${id}-hint`} className={valid ? "text-foreground-subtle text-xs" : "text-error text-xs"}>
              Between {seats.min} and {seats.max}.{" "}
              <Link href="/settings/members" className="text-primary hover:underline">
                Manage members
              </Link>
            </p>
          </div>

          {error && (
            <p role="alert" className="border-error/35 bg-error/10 text-error flex items-start gap-2 rounded-lg border p-3 text-sm">
              <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="surface" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || unchanged || busy}>
              {busy ? "Saving…" : "Update seats"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
