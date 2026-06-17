import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin";

const ETL_URL = process.env.ETL_SERVER_URL || "http://medicoes-etl:4000";

export async function GET() {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  try {
    const res = await fetch(`${ETL_URL}/status`, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ running: false, lastResult: null, lastError: "ETL server indisponível." });
  }
}

export async function POST(request: NextRequest) {
  const admin = await requireAdmin();
  if (admin.response) return admin.response;

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const ciclo = (formData.get("ciclo") as string | null)?.trim() || "";

  if (!file) {
    return NextResponse.json({ error: "Arquivo não enviado." }, { status: 400 });
  }

  const etlForm = new FormData();
  etlForm.append("file", new Blob([await file.arrayBuffer()]), file.name);
  if (ciclo) etlForm.append("ciclo", ciclo);

  try {
    const res = await fetch(`${ETL_URL}/run`, { method: "POST", body: etlForm });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "Não foi possível conectar ao servidor ETL." }, { status: 502 });
  }
}
