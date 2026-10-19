"use client";

import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import {
  api,
  errorMessage,
  refreshSession,
  setAccessToken,
  setSessionExpiredHandler,
  type User,
} from "@/lib/api/client";
import { loginUrl } from "@/lib/auth";

type AuthState =
  | { status: "loading"; user: null }
  | { status: "authenticated"; user: User }
  | { status: "anonymous"; user: null };

type AuthContextValue = AuthState & {
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Restore the session from the refresh cookie on first load.
  useEffect(() => {
    let cancelled = false;
    void refreshSession().then((session) => {
      if (cancelled) return;
      setState(
        session
          ? { status: "authenticated", user: session.user }
          : { status: "anonymous", user: null },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setSessionExpiredHandler(() => {
      setAccessToken(null);
      queryClient.clear();
      setState({ status: "anonymous", user: null });
      router.replace(loginUrl(pathname));
    });
    return () => setSessionExpiredHandler(null);
  }, [pathname, queryClient, router]);

  const login = useCallback(async (username: string, password: string) => {
    const { data, error } = await api.POST("/api/auth/login", { body: { username, password } });
    if (!data) throw new Error(errorMessage(error, "Não foi possível entrar."));
    setAccessToken(data.access);
    setState({ status: "authenticated", user: data.user });
  }, []);

  const logout = useCallback(async () => {
    await api.POST("/api/auth/logout").catch(() => undefined);
    setAccessToken(null);
    queryClient.clear();
    setState({ status: "anonymous", user: null });
    router.replace("/login");
  }, [queryClient, router]);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside <AuthProvider>");
  return context;
}
