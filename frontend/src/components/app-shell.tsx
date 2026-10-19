"use client";

import { LayoutGrid, LogOut, Settings, User as UserIcon } from "lucide-react";
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
import { SearchButton, SearchProvider } from "@/features/search/search-dialog";
import { loginUrl } from "@/lib/auth";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Cursos", icon: LayoutGrid },
  { href: "/settings", label: "Configurações", icon: Settings },
];

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
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link href="/" className="rounded-md focus-visible:ring-2 focus-visible:ring-ring">
                <Brand />
              </Link>
              <nav aria-label="Principal" className="flex items-center gap-1">
                {NAV.map(({ href, label, icon: Icon }) => {
                  const current =
                    href === "/"
                      ? pathname === "/" || pathname.startsWith("/courses")
                      : pathname.startsWith(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={current ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                        current && "bg-muted font-medium text-foreground",
                      )}
                    >
                      <Icon className="size-4" aria-hidden />
                      <span className="sr-only sm:not-sr-only">{label}</span>
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
        <main id="conteudo" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
          {auth.status === "authenticated" ? (
            <>
              <ReconnectBanner />
              {children}
            </>
          ) : (
            <ShellSkeleton />
          )}
        </main>
      </div>
    </SearchProvider>
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
