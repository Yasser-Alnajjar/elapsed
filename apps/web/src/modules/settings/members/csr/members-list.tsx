"use client";

import { Search, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DataTableCard,
  DataTableEmptyRow,
  DataTableEmpty,
  DataTableFooter,
  DataTableRangeSummary,
  DataTableSearch,
  DataTableSelect,
  DataTableToolbar,
} from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableHead,
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

type RoleFilter = "all" | "owner" | "member";
type JoinedFilter = "any" | "7" | "30";

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All roles" },
  { value: "owner", label: "Owners" },
  { value: "member", label: "Members" },
];

const JOINED_OPTIONS: { value: JoinedFilter; label: string }[] = [
  { value: "any", label: "Joined any time" },
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
];

export function MembersList({
  members,
  currentUserId,
  onSaved,
}: MembersListProps) {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<RoleFilter>("all");
  const [joined, setJoined] = useState<JoinedFilter>("any");

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

  const hasActiveFilters = query !== "" || role !== "all" || joined !== "any";
  const resetFilters = () => {
    setQuery("");
    setRole("all");
    setJoined("any");
  };

  return (
    <DataTableCard>
      <DataTableToolbar
        search={
          <DataTableSearch
            value={query}
            onChange={setQuery}
            placeholder="Search by name or email…"
            ariaLabel="Search members"
          />
        }
        filters={
          <>
            <DataTableSelect
              ariaLabel="Filter by role"
              value={role}
              options={ROLE_OPTIONS}
              onValueChange={setRole}
            />
            <DataTableSelect
              ariaLabel="Filter by join date"
              value={joined}
              options={JOINED_OPTIONS}
              onValueChange={setJoined}
            />
          </>
        }
        onReset={hasActiveFilters ? resetFilters : undefined}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Email address</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Joined</TableHead>
            <TableHead align="end">Actions</TableHead>
          </TableRow>
        </TableHeader>

        <TableBody>
          {filtered.length === 0 && (
            <DataTableEmptyRow colSpan={5}>
              <DataTableEmpty
                icon={hasActiveFilters ? Search : UserX}
                title="No members match these filters"
                action={
                  hasActiveFilters && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </Button>
                  )
                }
              />
            </DataTableEmptyRow>
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

      <DataTableFooter>
        <DataTableRangeSummary
          shown={filtered.length}
          total={members.length}
          label="members"
        />
      </DataTableFooter>
    </DataTableCard>
  );
}
