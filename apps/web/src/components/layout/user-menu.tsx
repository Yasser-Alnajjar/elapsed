"use client";

import { signOut } from "next-auth/react";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { LogOut } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { IUser } from "@/lib/types/user";
import { ThemeToggle } from "../ui/theme-toggle";
import Link from "next/link";
import { initialsOf } from "@/lib/format";
export function UserMenu({ user }: { user: IUser }) {
  const initials = initialsOf(user.name, user.email);
  const isMobile = useIsMobile();
  const displayName = user.name || user.email?.split("@")[0] || "User";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="cursor-pointer">
        <Avatar size="default">
          <AvatarImage
            src={user.image ?? undefined}
            alt={user.name ?? user.email}
          />
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side={isMobile ? "bottom" : "top"}
        align="end"
        sideOffset={8}
        className="w-56"
      >
        <div className="flex items-center gap-2 px-2 py-2">
          <Avatar size="default">
            <AvatarImage src={user.image ?? undefined} alt="" />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>

          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{displayName}</p>
            <p className="text-muted-foreground truncate text-xs">
              {user.email}
            </p>
          </div>
        </div>

        <DropdownMenuSeparator />

        <div className="flex items-center justify-between gap-3 px-2 py-1.5">
          <span className="text-sm">Theme</span>
          <ThemeToggle />
        </div>

        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/">Home</Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings/profile">Profile</Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => signOut({ callbackUrl: "/sign-in" })}>
          <LogOut className="size-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
