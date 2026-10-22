"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

export function BotaoImprimir() {
  return (
    <Button className="h-10 print:hidden" onClick={() => window.print()}>
      <Printer size={15} aria-hidden />
      Imprimir / salvar PDF
    </Button>
  );
}
