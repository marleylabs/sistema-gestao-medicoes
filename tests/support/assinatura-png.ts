import { crc32, deflateSync } from "node:zlib";

/**
 * PNG mínimo válido (tons de cinza, 8 bits, todo branco) para as assinaturas dos testes, sem dependência nova.
 * `largura`/`altura` permitem testar os limites que o servidor confere no cabeçalho IHDR.
 */
export function pngDeTeste(largura = 200, altura = 60) {
  const bloco = (tipo: string, dados: Buffer) => {
    const corpo = Buffer.concat([Buffer.from(tipo, "ascii"), dados]);
    const tamanho = Buffer.alloc(4);
    tamanho.writeUInt32BE(dados.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(corpo));
    return Buffer.concat([tamanho, corpo, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largura, 0);
  ihdr.writeUInt32BE(altura, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 0; // tons de cinza
  const linha = Buffer.concat([Buffer.from([0]), Buffer.alloc(largura, 0xff)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: altura }, () => linha)));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco("IHDR", ihdr), bloco("IDAT", pixels), bloco("IEND", Buffer.alloc(0)),
  ]);
}

export const dataUrlDeTeste = (largura?: number, altura?: number) => `data:image/png;base64,${pngDeTeste(largura, altura).toString("base64")}`;

/** Assinatura já validada, para os testes que só precisam enviar a folha. */
export const assinaturaDeTeste = () => ({ imagem: pngDeTeste(), metodo: "DESENHO" as const });
