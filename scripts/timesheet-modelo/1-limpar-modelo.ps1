# Passo 1 do modelo XLSX do timesheet (ver docs/brain/modulos/timesheet.md): a partir da planilha oficial da VALE,
# deixa só a aba "timesheet", sem abas ocultas, links externos, nomes quebrados, fórmulas nem dados de exemplo.
# Precisa do Excel instalado (Windows). Uso: .-limpar-modelo.ps1 -Origem <planilha da VALE.xlsx> -Destino <saida.xlsx>
param([string]$Origem, [string]$Destino)
$ErrorActionPreference = "Stop"
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $false; $xl.DisplayAlerts = $false; $xl.AskToUpdateLinks = $false
try {
  $wb = $xl.Workbooks.Open($Origem, 0, $false)
  $ws = $wb.Worksheets.Item("timesheet")


  foreach ($nome in @("dias", "Cálculo", "Cálculo Total", "Hora Extra")) {
    $s = $wb.Worksheets.Item($nome); $s.Visible = -1; $s.Delete()
  }
  $links = $wb.LinkSources(1)
  if ($links) { foreach ($l in $links) { $wb.BreakLink($l, 1) } }
  for ($i = $wb.Names.Count; $i -ge 1; $i--) { $n = $wb.Names.Item($i); if ($n.Name -notmatch "Print_Area|Print_Titles") { try { $n.Delete() } catch { Write-Warning "nome mantido: $($n.Name)" } } }

  # Dados do exemplo saem; os rótulos ficam.
  $limpar = @("K1","M2","K4","A7","J7","M7","M8","A9","B46","K46","J48","N48","A12:N42","F43:I43","O1:AB60")
  foreach ($r in $limpar) { foreach ($c in $ws.Range($r).Cells) { $c.MergeArea.ClearContents() | Out-Null } }
  $ws.Range("J10").Value2 = "PROJETO/PEP"
  $ws.Range("M5").Value2 = "Local:"
  $ws.Range("M3").Value2 = "Doc. N.º:"

  # Cinza dos fins de semana e feriados: regra fixa; a plataforma define as linhas (sqref) na exportação.
  $ws.Cells.FormatConditions.Delete()
  $fc = $ws.Range("A12:N12").FormatConditions.Add(2, 0, "=TRUE")
  $fc.Font.Bold = $true; $fc.Font.Color = 16777215; $fc.Interior.Color = 8421504
  $ws.Range("A12:N42").Validation.Delete()

  # Todas as fórmulas do modelo ficavam nas células de dados limpas acima; nenhuma pode sobrar.
  $sobra = @($ws.UsedRange.Cells | Where-Object { $_.HasFormula } | ForEach-Object { $_.Address(0, 0) })
  if ($sobra.Count) { throw "Fórmulas restantes: $($sobra -join ', ')" }
  $wb.SaveAs($Destino, 51)
  $wb.Close($false)
  "ok"
} finally { $xl.Quit() }
