"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  CircleHelp,
  CirclePlay,
  FileText,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Settings,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Ticket,
  Workflow,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOut, useSession } from "next-auth/react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BrandMark } from "../shared/brand-mark";
import { useIsMobile } from "@/hooks/use-mobile";

type DocsItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

type DocsSection = {
  title: string;
  items: DocsItem[];
};

const sections: DocsSection[] = [
  {
    title: "Overview",
    items: [
      {
        title: "Getting Started",
        href: "/docs/getting-started",
        icon: CirclePlay,
      },
      {
        title: "How It Works",
        href: "/docs/how-it-works",
        icon: GitBranch,
      },
    ],
  },
  {
    title: "Product",
    items: [
      {
        title: "Cases",
        href: "/docs/cases",
        icon: Ticket,
      },
      {
        title: "SLA & Targets",
        href: "/docs/sla",
        icon: ShieldAlert,
      },
      {
        title: "Dashboard",
        href: "/docs/dashboard",
        icon: LayoutDashboard,
      },
      {
        title: "Notifications",
        href: "/docs/notifications",
        icon: Bell,
      },
    ],
  },
  {
    title: "Integrations",
    items: [
      {
        title: "Zendesk",
        href: "/docs/integrations/zendesk",
        icon: FileText,
      },
      {
        title: "Jira",
        href: "/docs/integrations/jira",
        icon: FileText,
      },
      {
        title: "Slack",
        href: "/docs/integrations/slack",
        icon: FileText,
      },
      {
        title: "Linear",
        href: "/docs/integrations/linear",
        icon: Workflow,
      },
      {
        title: "Intercom",
        href: "/docs/integrations/intercom",
        icon: LifeBuoy,
      },
      {
        title: "GitHub",
        href: "/docs/integrations/github",
        icon: GitPullRequest,
      },
    ],
  },
  {
    title: "Administration",
    items: [
      {
        title: "Configuration",
        href: "/docs/configuration",
        icon: Settings2,
      },
      {
        title: "Security summary",
        href: "/docs/security",
        icon: ShieldCheck,
      },
      {
        title: "Troubleshooting",
        href: "/docs/troubleshooting",
        icon: Wrench,
      },
      {
        title: "FAQ",
        href: "/docs/faq",
        icon: CircleHelp,
      },
    ],
  },
];

function initialsOf(name: string, email: string) {
  const value = name !== "Guest" ? name : email;

  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function DocsSidebar() {
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const { data: session, status } = useSession();

  const isAuthenticated = status === "authenticated";
  const user = session?.user;

  const displayName = user?.name || user?.email?.split("@")[0] || "User";

  const email = user?.email || "";

  const initials = initialsOf(user?.name || "Guest", user?.email || "Guest");
  const router = useRouter();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/docs/getting-started" aria-label="Documentation">
          <BrandMark logoClassName="size-8" />
        </Link>
      </SidebarHeader>

      <SidebarContent>
        {sections.map((section) => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>

            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map((item) => {
                  const Icon = item.icon;

                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(`${item.href}/`);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        tooltip={item.title}
                      >
                        <Link href={item.href}>
                          <Icon />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        {isAuthenticated && user ? (
          <>
            <SidebarSeparator />

            <SidebarMenu>
              <SidebarMenuItem>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                    >
                      <Avatar size="default">
                        <AvatarImage src={user.image ?? undefined} alt="" />
                        <AvatarFallback>{initials}</AvatarFallback>
                      </Avatar>

                      <div className="grid min-w-0 flex-1 text-start text-sm leading-tight group-data-[collapsible=icon]:hidden">
                        <span className="truncate font-medium">
                          {displayName}
                        </span>

                        <span className="text-muted-foreground truncate text-xs">
                          {email}
                        </span>
                      </div>

                      <Settings className="ms-auto size-4 group-data-[collapsible=icon]:hidden" />
                    </SidebarMenuButton>
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
                        <p className="truncate text-sm font-medium">
                          {displayName}
                        </p>

                        <p className="text-muted-foreground truncate text-xs">
                          {email}
                        </p>
                      </div>
                    </div>

                    <DropdownMenuSeparator />

                    <div className="flex items-center justify-between gap-3 px-2 py-1.5">
                      <span className="text-sm">Theme</span>
                      <ThemeToggle />
                    </div>

                    <DropdownMenuSeparator />

                    <DropdownMenuItem
                      onSelect={() => {
                        signOut({ redirect: false });
                        router.refresh();
                      }}
                    >
                      <LogOut className="size-4" />
                      Sign out
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </SidebarMenuItem>
            </SidebarMenu>
          </>
        ) : (
          <div className="border-t p-2">
            <div className="flex items-center justify-end">
              <ThemeToggle />
            </div>
          </div>
        )}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
