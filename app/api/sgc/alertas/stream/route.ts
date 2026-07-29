import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    return NextResponse.json({ error: "Acesso restrito ao perfil Medição." }, { status: 403 });
  }

  const ciclo = request.nextUrl.searchParams.get("ciclo")?.trim() || "2605";

  let closed = false;
  let lastSignature = "";
  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
        );
      };

      const check = async () => {
        if (running || closed) return;
        running = true;
        try {
          const alertas = await prisma.sgcAprovacaoMedicao.findMany({
            where: { status: "REVISAO_SOLICITADA", ciclo },
            select: {
              id: true,
              colaboradorCodigo: true,
              revisaoNumero: true,
              revisaoSolicitadaAt: true,
              updatedAt: true,
            },
            orderBy: { revisaoSolicitadaAt: "desc" },
            take: 20,
          });
          const signature = JSON.stringify(alertas);
          if (signature !== lastSignature) {
            lastSignature = signature;
            send("alertas", {
              ciclo,
              count: alertas.length,
              ids: alertas.map((alerta) => alerta.id),
              updatedAt: new Date().toISOString(),
            });
          }
        } catch (error) {
          send("error", { message: error instanceof Error ? error.message : "Erro ao ler alertas." });
        } finally {
          running = false;
        }
      };

      await check();
      interval = setInterval(check, 2000);

      request.signal.addEventListener("abort", () => {
        closed = true;
        if (interval) clearInterval(interval);
        try {
          controller.close();
        } catch {}
      });
    },
    cancel() {
      closed = true;
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
