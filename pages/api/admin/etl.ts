import type { NextApiRequest, NextApiResponse } from "next";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export const config = {
  api: {
    bodyParser: false,
  },
};

const ETL_URL = process.env.ETL_SERVER_URL || "http://medicoes-etl:4000";
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

function getCookie(req: NextApiRequest, name: string) {
  const cookie = req.headers.cookie;
  if (!cookie) return undefined;

  return cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

async function requireMedicao(req: NextApiRequest, res: NextApiResponse) {
  const user = await verifySessionToken(getCookie(req, SESSION_COOKIE));
  if (!user) {
    res.status(401).json({ error: "Não autenticado." });
    return null;
  }

  if (!["MEDICAO", "ADMIN"].includes(user.perfil)) {
    res.status(403).json({ error: "Acesso restrito ao perfil Medição." });
    return null;
  }

  return user;
}

async function sendEtlJson(res: NextApiResponse, etlResponse: Response) {
  const text = await etlResponse.text();

  try {
    res.status(etlResponse.status).json(JSON.parse(text));
  } catch {
    res.status(etlResponse.status).json({ error: text || "Resposta inválida do servidor ETL." });
  }
}

async function readRequestBody(req: NextApiRequest) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > MAX_UPLOAD_BYTES) {
      throw new Error("UPLOAD_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireMedicao(req, res);
  if (!user) return;

  if (req.method === "GET") {
    try {
      const etlResponse = await fetch(`${ETL_URL}/status`, { cache: "no-store" });
      await sendEtlJson(res, etlResponse);
    } catch {
      res.status(200).json({ running: false, lastResult: null, lastError: "ETL server indisponível." });
    }
    return;
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Método não permitido." });
    return;
  }

  let body: Buffer;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    if (error instanceof Error && error.message === "UPLOAD_TOO_LARGE") {
      res.status(413).json({ error: "Arquivo excede o limite de 100 MB para importação." });
      return;
    }
    res.status(400).json({ error: "Não foi possível ler o arquivo enviado." });
    return;
  }

  const headers: HeadersInit = {};
  const contentType = req.headers["content-type"];
  if (contentType) headers["content-type"] = contentType;
  headers["content-length"] = String(body.length);

  try {
    const etlResponse = await fetch(`${ETL_URL}/run`, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
    });

    await sendEtlJson(res, etlResponse);
  } catch {
    res.status(502).json({ error: "Não foi possível conectar ao servidor ETL." });
  }
}
