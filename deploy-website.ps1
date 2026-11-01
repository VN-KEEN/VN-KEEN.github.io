param([string]$WranglerPath='', [string]$NodePath='node')
$ErrorActionPreference='Stop'
Push-Location -LiteralPath $PSScriptRoot
try{
 if($WranglerPath){$output=& $NodePath $WranglerPath pages deploy public --project-name vn-keen --branch main --commit-dirty=true 2>&1}
 else{$output=& wrangler pages deploy public --project-name vn-keen --branch main --commit-dirty=true 2>&1}
 $deployExitCode=$LASTEXITCODE
 $output|ForEach-Object {Write-Output $_}
 if($deployExitCode -ne 0){throw 'Website deploy failed; asset fallback left unchanged'}
 $deploymentMatches=[regex]::Matches(($output|Out-String),'https://[a-f0-9]{8}\.vn-keen\.pages\.dev')
 if(!$deploymentMatches.Count){throw 'Deployment succeeded but immutable asset origin was not found'}
 $origin=$deploymentMatches[$deploymentMatches.Count-1].Value
 $file=Join-Path $PSScriptRoot 'public-assets.json'
 $manifest=Get-Content -LiteralPath $file -Raw|ConvertFrom-Json
 $manifest|Add-Member -NotePropertyName fallbackOrigin -NotePropertyValue $origin -Force
 [IO.File]::WriteAllText($file,($manifest|ConvertTo-Json -Depth 6),[Text.UTF8Encoding]::new($false))
 Write-Output "Pinned asset fallback to $origin. Commit the updated manifest after this deployment."
}finally{Pop-Location}
