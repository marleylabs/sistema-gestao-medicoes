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


def make_pdf_cnpj_teste(name: str, cnpj: str, prestador_razao: str) -> None:
    """Fixture textual (não-imagem) para validar a extração/comparação de CNPJ do prestador contra
    o cadastro administrativo — mesmo layout PRESTADOR/TOMADOR usado por `make_pdf` (comprovadamente
    reconhecido por `validateNfDocumentAgainstCadastro`), com avisos explícitos de documento de
    teste sem valor fiscal."""
    pdf = canvas.Canvas(str(OUT / name), pagesize=A4, pageCompression=0)
    pdf.setTitle("Fixture NF de teste — sem valor fiscal")
    pdf.setFont("Helvetica-Bold", 12)
    pdf.drawString(50, 800, "DOCUMENTO DE TESTE - SEM VALOR FISCAL")
    pdf.setFont("Helvetica", 11)
    lines = [
        "NOTA FISCAL DE TESTE",
        "PRESTADOR DO SERVICO",
        "Nome / Nome Empresarial",
        prestador_razao,
        "CNPJ",
        cnpj,
        "TOMADOR DO SERVICO",
        "Nome / Nome Empresarial",
        "PROJETA CONSULTORIA E SERVICOS LTDA",
        "CNPJ",
        "04.892.580/0001-20",
        "SERVICO PRESTADO",
        "Numero da NF: 999999",
        "Serie: TESTE",
        "Data de emissao: 03/09/2026",
        "Descricao dos servicos: Servicos tecnicos de engenharia - arquivo destinado",
        "exclusivamente a validacao automatizada do sistema En Passant.",
        "Valor dos servicos: R$ 1.000,00",
        "Valor total: R$ 1.000,00",
    ]
    y = 770
    for line in lines:
        pdf.drawString(50, y, line)
        y -= 22
    pdf.setFont("Helvetica-Bold", 10)
    y -= 10
    pdf.drawString(50, y, "DOCUMENTO GERADO EXCLUSIVAMENTE PARA TESTES AUTOMATIZADOS. SEM VALOR FISCAL.")
    y -= 16
    pdf.drawString(50, y, "NAO UTILIZAR PARA FINS CONTABEIS, TRIBUTARIOS OU COMERCIAIS.")
    pdf.save()


make_pdf_cnpj_teste("nf-teste-cnpj-21701545000103.pdf", "21.701.545/0001-03", "Fornecedor Teste En Passant LTDA")

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
