# Passo 2 do modelo XLSX do timesheet: aplica a paleta do PDF (título verde-petróleo, cabeçalho claro, bordas suaves,
# data com dia da semana, total com linha forte, sábado/domingo/feriado em verde) e grava o resultado.
# Antes de rodar: no XML do passo 1, troque <formula>'TRUE'</formula> por <formula>TRUE</formula> (o Excel em português
# grava texto, e a automação não abre o arquivo). Copie o resultado para app-assets/templates/Timesheet_ATO.xlsx.
param([string]$Origem, [string]$Destino)
$ErrorActionPreference = "Stop"
function Cor([int]$r, [int]$g, [int]$b) { return $r + 256 * $g + 65536 * $b }  # Excel usa BGR
$teal = Cor 0 126 122; $slate900 = Cor 15 23 42; $slate600 = Cor 71 85 105; $slate500 = Cor 100 116 139
$slate300 = Cor 203 213 225; $slate100 = Cor 241 245 249; $slate50 = Cor 248 250 252; $slate800 = Cor 30 41 59
$verdeFundo = Cor 230 244 234; $verdeTexto = Cor 20 83 45; $branco = Cor 255 255 255

$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false
try {
  $wb = $xl.Workbooks.Open($Origem, 0, $false)
  $ws = $wb.Worksheets.Item("timesheet")
  $area = $ws.Range("A1:N50")

  # Texto em ardósia e bordas existentes em cinza-claro (nenhuma borda nova é criada).
  $area.Font.Color = $slate900
  foreach ($c in $area.Cells) {
    foreach ($i in 7..12) { $bd = $c.Borders.Item($i); if ($bd.LineStyle -ne -4142) { $bd.Color = $slate300 } }
  }

  # Título: faixa verde-petróleo da VALE.
  $t = $ws.Range("A3:J4"); $t.Interior.Color = $teal; $t.Font.Color = $branco
  # Rótulos pequenos do topo em cinza.
  foreach ($r in @("M1", "K3", "M3")) { $ws.Range($r).Font.Color = $slate500 }
  $ws.Range("A9:N9").Font.Color = $teal

  # Cabeçalho da tabela.
  $h = $ws.Range("A10:N11"); $h.Interior.Color = $slate100; $h.Font.Color = $slate600

  # Data com o dia da semana (ex.: 21/11/2026 sáb) e coluna um pouco mais larga.
  $ws.Range("A12:A42").NumberFormatLocal = "dd/mm/aaaa ddd"; $ws.Range("A12:A42").Interior.ColorIndex = -4142
  $ws.Columns.Item(1).ColumnWidth = 16.5

  # Total: linha forte em cima, fundo claro, total de horas no verde-petróleo.
  $tot = $ws.Range("A43:N43"); $tot.Interior.Color = $slate50
  $topo = $tot.Borders.Item(8); $topo.LineStyle = 1; $topo.Weight = -4138; $topo.Color = $slate800
  $ws.Range("I43").Font.Color = $teal

  # Assinaturas e observações em cinza.
  foreach ($r in @("A46", "I48", "M48", "A50")) { $ws.Range($r).Font.Color = $slate500 }

  # Sábado, domingo e feriado: verde (a exportação define as linhas).
  $fc = $ws.Cells.FormatConditions.Item(1)
  $fc.Interior.Color = $verdeFundo; $fc.Font.Color = $verdeTexto; $fc.Font.Bold = $true

  $wb.SaveAs($Destino, 51)
  $wb.Close($false)
  "ok"
} finally { $xl.Quit() }


