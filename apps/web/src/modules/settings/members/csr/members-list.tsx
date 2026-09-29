"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableHead,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { OrganizationMemberSummary } from "@/lib/types/members";

import { MemberRow } from "./member-row";

interface MembersListProps {
  members: OrganizationMemberSummary[];
  currentUserId: string;
  onSaved: () => void;
}

export function MembersList({
  members,
  currentUserId,
  onSaved,
}: MembersListProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<"all" | "owner" | "member">("all");
  const [joined, setJoined] = useState<"any" | "7" | "30">("any");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    const cutoff =
      joined === "any" ? 0 : Date.now() - Number(joined) * 86_400_000;

    return members.filter(
      (m) =>
        (role === "all" || m.role === role) &&
        new Date(m.createdAt).getTime() >= cutoff &&
        (!q ||
          m.email.toLowerCase().includes(q) ||
          (m.name ?? "").toLowerCase().includes(q)),
    );
  }, [members, query, role, joined]);

  return (
    <Card className="bg-surface-container-low overflow-hidden rounded-xl border-0 shadow-sm">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="text-outline pointer-events-none absolute inset-s-3 top-1/2 size-4 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search members"
            className="ps-9"
          />
        </div>

        <Select
          value={role}
          onValueChange={(value) => setRole(value as typeof role)}
        >
          <SelectTrigger className="w-full sm:w-40" aria-label="Filter by role">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="owner">Owners</SelectItem>
            <SelectItem value="member">Members</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={joined}
          onValueChange={(value) => setJoined(value as typeof joined)}
        >
          <SelectTrigger
            className="w-full sm:w-40"
            aria-label="Filter by join date"
          >
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="any">Joined any time</SelectItem>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-on-surface-variant font-mono text-xxs uppercase sm:ms-2">
          {filtered.length} of {members.length}
        </span>
      </div>

      <Table>
        <TableHeader className="[&_tr]:border-0">
          <TableRow className="bg-surface-container-lowest hover:bg-surface-container-lowest border-0">
            {["User", "Email Address", "Role", "Joined", "Actions"].map(
              (label, i) => (
                <TableHead
                  key={label}
                  className={`text-outline p-4 font-mono text-xxs font-semibold ${i === 4 ? "text-end" : ""}`}
                >
                  <div className="px-4">{label}</div>
                </TableHead>
              ),
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {filtered.length === 0 && (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-on-surface-variant p-6 text-center text-sm"
              >
                No members match these filters.
              </TableCell>
            </TableRow>
          )}

          {filtered.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isSelf={member.id === currentUserId}
              onSaved={onSaved}
            />
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
