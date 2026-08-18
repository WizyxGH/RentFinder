<#
.SYNOPSIS
  Planifie la collecte RentFinder pour qu'elle tourne automatiquement — et donc
  que les notifications Telegram (§29) arrivent sans rien lancer à la main.

.DESCRIPTION
  Enregistre une tâche planifiée Windows qui exécute `pnpm collect` dans ce
  dépôt, toutes les N minutes. La collecte détecte les nouvelles annonces et,
  si Telegram est configuré dans .env, les pousse sur votre téléphone.

  100 % LOCAL. La tâche tourne sur votre machine, sous votre session ; rien
  n'est déployé dans le cloud. Elle ne s'exécute que quand l'ordinateur est
  allumé (c'est la limite assumée du choix zéro-cloud).

.PARAMETER IntervalMinutes
  Intervalle entre deux collectes (défaut : 30).

.PARAMETER Remove
  Supprime la tâche planifiée au lieu de la créer.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1
  powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1 -IntervalMinutes 15
  powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1 -Remove
#>

param(
  [int]$IntervalMinutes = 30,
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$TaskName = 'RentFinder - Collecte'
# Racine du dépôt = dossier parent de ce script.
$RepoRoot = Split-Path -Parent $PSScriptRoot

if ($Remove) {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    Write-Host "Tache '$TaskName' supprimee."
  } else {
    Write-Host "Aucune tache '$TaskName' a supprimer."
  }
  return
}

# `pnpm` doit être résolvable. ATTENTION : Get-Command peut rendre le wrapper
# PowerShell (pnpm.ps1), que le Planificateur ne sait PAS exécuter — on cherche
# le shim .cmd/.exe, exécutable partout.
$PnpmCommand = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $PnpmCommand) {
  throw "pnpm introuvable dans le PATH. Installez pnpm, puis relancez ce script."
}
$PnpmDir = Split-Path -Parent $PnpmCommand.Source
$Pnpm = @("$PnpmDir\pnpm.cmd", "$PnpmDir\pnpm.exe", $PnpmCommand.Source) |
  Where-Object { Test-Path $_ } | Select-Object -First 1

# La tâche lance `pnpm collect` via cmd.exe (fiable pour les shims .cmd), en
# journalisant dans data\collect.log (gitignoré) pour pouvoir diagnostiquer.
$Action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$Pnpm`" collect >> data\collect.log 2>&1`"" `
  -WorkingDirectory $RepoRoot

# Déclencheur : maintenant, puis toutes les N minutes, indéfiniment.
$Trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) `
  -RepetitionInterval (New-TimeSpan -Minutes $IntervalMinutes)

# Réglages sobres : ne pas réveiller la machine, tolérer la batterie, une seule
# instance à la fois (une collecte lente ne se chevauche pas avec la suivante).
$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger `
  -Settings $Settings -Description 'Collecte RentFinder + notifications Telegram' `
  -Force | Out-Null

Write-Host "Tache '$TaskName' planifiee : toutes les $IntervalMinutes min."
Write-Host "Dossier : $RepoRoot"
Write-Host ""
Write-Host "Verifier      : Get-ScheduledTask -TaskName '$TaskName'"
Write-Host "Lancer maintenant : Start-ScheduledTask -TaskName '$TaskName'"
Write-Host "Supprimer     : powershell -ExecutionPolicy Bypass -File scripts\schedule-collect.ps1 -Remove"
