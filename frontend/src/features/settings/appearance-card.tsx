"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
] as const;

export function AppearanceCard() {
  const { theme, setTheme } = useTheme();
  // The theme is only known on the client; avoid a mismatched first render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Aparência</CardTitle>
        <CardDescription>
          &quot;Sistema&quot; acompanha o tema claro ou escuro do seu computador.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-label="Tema" className="grid grid-cols-3 gap-2 sm:max-w-md">
          {OPTIONS.map(({ value, label, icon: Icon }) => {
            const checked = mounted && theme === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={checked}
                onClick={() => setTheme(value)}
                className={cn(
                  "flex h-11 items-center justify-center gap-2 rounded-lg border text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                  checked && "border-foreground bg-muted font-medium",
                )}
              >
                <Icon className="size-4" aria-hidden /> {label}
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
