"use client";

import {
  BookmarkCheck,
  Layers,
  LayoutGrid,
  LogOut,
  Settings,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/components/auth/auth-provider";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { ReconnectBanner } from "@/features/google/reconnect-banner";
import { useReview } from "@/features/review/api";
import { SearchButton, SearchProvider } from "@/features/search/search-dialog";
import { loginUrl } from "@/lib/auth";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; short: string; icon: LucideIcon };

const NAV: NavItem[] = [
  { href: "/", label: "Cursos", short: "Cursos", icon: LayoutGrid },
  { href: "/review", label: "Revisar", short: "Revisar", icon: Layers },
  { href: "/marked", label: "Marcadas", short: "Marcadas", icon: BookmarkCheck },
  { href: "/settings", label: "Configurações", short: "Ajustes", icon: Settings },
];

function isCurrent(href: string, pathname: string): boolean {
  return href === "/"
    ? pathname === "/" || pathname.startsWith("/courses")
    : pathname.startsWith(href);
}

/** Due review cards, shown as a badge on "Revisar". Only fetched once signed in. */
function DueBadge({ className }: { className?: string }) {
  const { data } = useReview();
  if (!data?.due) return null;
  return (
    <span
      className={cn(
        "grid h-4 min-w-4 place-items-center rounded-full bg-sky-700 px-1 text-[0.625rem] leading-none font-semibold text-white tabular-nums",
        className,
      )}
    >
      {data.due > 99 ? "99+" : data.due}
      <span className="sr-only"> cartões para hoje</span>
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (auth.status === "anonymous") router.replace(loginUrl(pathname));
  }, [auth.status, pathname, router]);

  return (
    <SearchProvider>
      <div className="flex min-h-dvh flex-col">
        <a
          href="#conteudo"
          className="sr-only z-50 rounded-md bg-background px-3 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
        >
          Pular para o conteúdo
        </a>
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur print:hidden">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
                <Brand />
              </Link>
              {/* Phones use the tab bar at the bottom instead. */}
              <nav aria-label="Principal" className="hidden items-center gap-1 sm:flex">
                {NAV.map(({ href, label, icon: Icon }) => {
                  const current = isCurrent(href, pathname);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={current ? "page" : undefined}
                      title={label}
                      className={cn(
                        "relative flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        current && "bg-muted font-medium text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="sr-only lg:not-sr-only">{label}</span>
                      {href === "/review" && auth.status === "authenticated" && (
                        <DueBadge className="absolute -top-1 -right-1 lg:static" />
                      )}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <div className="flex items-center gap-1">
              {auth.status === "authenticated" && <SearchButton />}
              <ThemeToggle />
              {auth.status === "authenticated" ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" aria-label="Menu da conta">
                      <UserIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-48">
                    <DropdownMenuLabel className="font-normal">
                      <span className="block font-medium">{auth.user.username}</span>
                      {auth.user.email && (
                        <span className="block text-xs text-muted-foreground">
                          {auth.user.email}
                        </span>
                      )}
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => void auth.logout()}>
                      <LogOut className="size-4" /> Sair
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Skeleton className="size-9 rounded-md" />
              )}
            </div>
          </div>
        </header>
        <main
          id="conteudo"
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-8 print:p-0"
        >
          {auth.status === "authenticated" ? (
            <>
              <ReconnectBanner />
              {children}
            </>
          ) : (
            <ShellSkeleton />
          )}
        </main>
        {auth.status === "authenticated" && <BottomNav pathname={pathname} />}
      </div>
    </SearchProvider>
  );
}

/** Thumb-reachable navigation on phones. */
function BottomNav({ pathname }: { pathname: string }) {
  return (
    <nav
      aria-label="Principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden print:hidden"
    >
      <ul className="grid grid-cols-4">
        {NAV.map(({ href, label, short, icon: Icon }) => {
          const current = isCurrent(href, pathname);
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] text-muted-foreground outline-none focus-visible:bg-muted",
                  current && "font-semibold text-foreground",
                )}
              >
                <span
                  className={cn(
                    "relative grid h-7 w-12 place-items-center rounded-full transition-colors",
                    current && "bg-muted",
                  )}
                >
                  <Icon className="size-5" aria-hidden />
                  {href === "/review" && <DueBadge className="absolute -top-1 right-0.5" />}
                </span>
                <span aria-hidden>{short}</span>
                <span className="sr-only">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function ShellSkeleton() {
  return (
    <div className="grid gap-6" aria-busy="true" aria-label="Carregando">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
