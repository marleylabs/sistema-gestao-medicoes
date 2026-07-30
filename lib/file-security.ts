const IMAGE_MIME_BY_MAGIC = [
  { mime: "image/jpeg", matches: (buffer: Buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  { mime: "image/png", matches: (buffer: Buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/gif", matches: (buffer: Buffer) => buffer.subarray(0, 6).toString("ascii") === "GIF87a" || buffer.subarray(0, 6).toString("ascii") === "GIF89a" },
  { mime: "image/webp", matches: (buffer: Buffer) => buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP" },
] as const;

export function detectAllowedImageMime(buffer: Buffer) {
  return IMAGE_MIME_BY_MAGIC.find((entry) => entry.matches(buffer))?.mime ?? null;
}

export function detectAllowedDocumentMime(buffer: Buffer) {
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";
  return detectAllowedImageMime(buffer);
}

export function safeDownloadName(value: string | null | undefined, fallback: string) {
  const cleaned = (value ?? fallback)
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/:*?<>|]+/g, "-")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}
