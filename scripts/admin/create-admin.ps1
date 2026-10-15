param(
  [Parameter(Mandatory = $true)]
  [string]$Email,

  [Parameter(Mandatory = $true)]
  [string]$Senha,

  [string]$Nome = 'Administrador'
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
node .\admin\create-admin.js $Email $Senha $Nome
