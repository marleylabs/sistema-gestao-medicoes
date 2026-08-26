from pathlib import Path

from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = Path(__file__).parent / "fixtures" / "nf"
OUT.mkdir(parents=True, exist_ok=True)


def make_pdf(name: str, prestador_cnpj: str, prestador_razao: str, tomador_cnpj: str = "04.892.580/0001-20", tomador_razao: str = "PROJETA CONSULTORIA E SERVICOS LTDA", multiline: bool = False) -> None:
    pdf = canvas.Canvas(str(OUT / name), pagesize=A4, pageCompression=0)
    pdf.setTitle("Fixture NF anonima")
    pdf.setFont("Helvetica", 11)
    lines = [
        "PRESTADOR DO SERVICO",
        "Nome / Nome Empresarial",
        prestador_razao,
        "CNPJ",
        prestador_cnpj,
        "TOMADOR DO SERVICO",
        "Nome / Nome Empresarial",
        tomador_razao,
        "CNPJ",
        tomador_cnpj,
        "SERVICO PRESTADO",
        "Documento sintetico sem valor fiscal para teste automatizado.",
    ]
    y = 790
    for line in lines:
        if multiline and line == prestador_razao:
            parts = line.split(" ", 2)
            pdf.drawString(50, y, " ".join(parts[:2]))
            y -= 18
            pdf.drawString(50, y, parts[2])
        else:
            pdf.drawString(50, y, line)
        y -= 24
    pdf.save()


make_pdf("valida-a.pdf", "11.222.333/0001-81", "TESTE A SERVICOS LTDA")
make_pdf("valida-b.pdf", "11.222.333/0001-81", "TESTE B SERVICOS LTDA")
make_pdf("cnpj-errado.pdf", "99.999.999/0001-99", "TESTE B SERVICOS LTDA")
make_pdf("razao-errada.pdf", "11.222.333/0001-81", "OUTRA EMPRESA LTDA")
make_pdf("tomador-errado.pdf", "11.222.333/0001-81", "TESTE B SERVICOS LTDA", "99.999.999/0001-99", "OUTRO TOMADOR LTDA")
make_pdf("quebras-alternativas.pdf", "11.222.333/0001-81", "TESTE B SERVICOS LTDA", multiline=True)

blank = canvas.Canvas(str(OUT / "sem-texto.pdf"), pagesize=A4)
blank.rect(50, 500, 400, 200)
blank.save()

(OUT / "arquivo-falso.pdf").write_bytes(b"NAO E PDF")
(OUT / "corrompido.pdf").write_bytes((OUT / "valida-b.pdf").read_bytes()[:300])

reader = PdfReader(OUT / "valida-b.pdf")
writer = PdfWriter()
writer.clone_document_from_reader(reader)
with (OUT / "xref-regravado.pdf").open("wb") as output:
    writer.write(output)

print(f"Fixtures geradas em {OUT}")
