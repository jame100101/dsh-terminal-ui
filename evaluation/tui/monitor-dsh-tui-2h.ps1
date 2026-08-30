[CmdletBinding()]
param(
    [ValidateRange(1, 1440)]
    [int]$DurationMinutes = 130,

    [ValidateRange(1, 300)]
    [int]$IntervalSeconds = 5,

    [string]$OutputPath = (Join-Path $env:TEMP (
        'dsh-tui-2h-{0}.csv' -f (Get-Date -Format 'yyyyMMdd-HHmmss')
    )),

    [ValidateRange(0, [int]::MaxValue)]
    [int]$LauncherPid = 0
)

$ErrorActionPreference = 'Stop'

function Find-DshTuiLauncher {
    Get-CimInstance Win32_Process |
        Where-Object {
            $_.Name -eq 'node.exe' -and
            $_.CommandLine -match '[\\/]dsh-tui[\\/]bin[\\/]dsh-tui\.js'
        } |
        Sort-Object CreationDate -Descending |
        Select-Object -First 1
}

if ($LauncherPid -eq 0) {
    $launcher = Find-DshTuiLauncher

    if ($null -eq $launcher) {
        throw 'No dsh-tui launcher was found. Start dsh-tui before this monitor.'
    }

    $LauncherPid = [int]$launcher.ProcessId
} else {
    $launcher = Get-CimInstance Win32_Process -Filter "ProcessId = $LauncherPid"

    if ($null -eq $launcher) {
        throw "Launcher PID $LauncherPid does not exist."
    }
}

$outputDirectory = Split-Path -Parent $OutputPath

if (-not (Test-Path -LiteralPath $outputDirectory -PathType Container)) {
    throw "Output directory does not exist: $outputDirectory"
}

$knownProcessIds = [System.Collections.Generic.HashSet[int]]::new()
[void]$knownProcessIds.Add($LauncherPid)

$start = Get-Date
$deadline = $start.AddMinutes($DurationMinutes)
$firstRow = $true
$sampleCount = 0
$missingTreeSamples = 0

Write-Host "dsh-tui launcher PID: $LauncherPid"
Write-Host "Sampling interval: $IntervalSeconds second(s)"
Write-Host "Monitoring duration: $DurationMinutes minute(s)"
Write-Host "CSV: $OutputPath"
Write-Host 'Press Ctrl+C to stop the monitor. The TUI process is not terminated.'

try {
    while ((Get-Date) -lt $deadline) {
        $now = Get-Date
        $allProcesses = @(Get-CimInstance Win32_Process)

        do {
            $added = 0

            foreach ($process in $allProcesses) {
                $processId = [int]$process.ProcessId
                $parentProcessId = [int]$process.ParentProcessId

                if (
                    $knownProcessIds.Contains($parentProcessId) -and
                    $knownProcessIds.Add($processId)
                ) {
                    $added++
                }
            }
        } while ($added -gt 0)

        $liveProcesses = @(
            foreach ($process in $allProcesses) {
                $processId = [int]$process.ProcessId

                if (-not $knownProcessIds.Contains($processId)) {
                    continue
                }

                try {
                    $runtimeProcess = Get-Process -Id $processId -ErrorAction Stop

                    [pscustomobject]@{
                        Id          = $processId
                        ParentId    = [int]$process.ParentProcessId
                        Name        = [string]$process.Name
                        CommandLine = [string]$process.CommandLine
                        StartTime   = $runtimeProcess.StartTime
                        RssMb       = $runtimeProcess.WorkingSet64 / 1MB
                        PrivateMb   = $runtimeProcess.PrivateMemorySize64 / 1MB
                        CpuSeconds  = if ($null -eq $runtimeProcess.CPU) {
                            0
                        } else {
                            [double]$runtimeProcess.CPU
                        }
                        Handles     = $runtimeProcess.HandleCount
                        Threads     = $runtimeProcess.Threads.Count
                    }
                } catch {
                    # The process exited between the CIM and Get-Process snapshots.
                }
            }
        )

        if ($liveProcesses.Count -eq 0) {
            $missingTreeSamples++
        } else {
            $missingTreeSamples = 0
        }

        $tuiRuntime = $liveProcesses |
            Where-Object {
                $_.Name -eq 'node.exe' -and
                (
                    $_.CommandLine -match '[\\/]runtime[\\/]lib[\\/]bin\.js' -or
                    $_.CommandLine -match '[\\/]apps[\\/]cli[\\/]lib[\\/]bin\.js'
                ) -and
                $_.CommandLine -match '--profile(?:=|\s+)tui'
            } |
            Sort-Object StartTime |
            Select-Object -First 1

        if ($null -eq $tuiRuntime) {
            $tuiRuntime = $liveProcesses |
                Where-Object {
                    $_.Name -eq 'node.exe' -and
                    $_.ParentId -eq $LauncherPid
                } |
                Sort-Object StartTime |
                Select-Object -First 1
        }

        $nodeProcesses = @(
            $liveProcesses | Where-Object Name -eq 'node.exe'
        )

        $treeRss = [double](
            $liveProcesses | Measure-Object RssMb -Sum
        ).Sum
        $treePrivate = [double](
            $liveProcesses | Measure-Object PrivateMb -Sum
        ).Sum
        $treeCpu = [double](
            $liveProcesses | Measure-Object CpuSeconds -Sum
        ).Sum
        $nodeRss = [double](
            $nodeProcesses | Measure-Object RssMb -Sum
        ).Sum
        $handles = [double](
            $liveProcesses | Measure-Object Handles -Sum
        ).Sum
        $threads = [double](
            $liveProcesses | Measure-Object Threads -Sum
        ).Sum

        $row = [pscustomobject]@{
            timestamp       = $now.ToString('o')
            elapsed_s       = [math]::Round(($now - $start).TotalSeconds, 1)
            launcher_pid    = $LauncherPid
            tui_pid         = if ($null -eq $tuiRuntime) { 0 } else { $tuiRuntime.Id }
            tui_rss_mb      = if ($null -eq $tuiRuntime) {
                0
            } else {
                [math]::Round($tuiRuntime.RssMb, 2)
            }
            tui_private_mb  = if ($null -eq $tuiRuntime) {
                0
            } else {
                [math]::Round($tuiRuntime.PrivateMb, 2)
            }
            tui_cpu_s       = if ($null -eq $tuiRuntime) {
                0
            } else {
                [math]::Round($tuiRuntime.CpuSeconds, 2)
            }
            node_processes  = $nodeProcesses.Count
            node_rss_mb     = [math]::Round($nodeRss, 2)
            tree_processes  = $liveProcesses.Count
            tree_rss_mb     = [math]::Round($treeRss, 2)
            tree_private_mb = [math]::Round($treePrivate, 2)
            tree_cpu_s      = [math]::Round($treeCpu, 2)
            tree_handles    = [int]$handles
            tree_threads    = [int]$threads
        }

        if ($firstRow) {
            $row | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8
            $firstRow = $false
        } else {
            $row | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding utf8 -Append
        }

        $sampleCount++

        Write-Host (
            '{0:HH:mm:ss}  TUI={1,7:N1} MB  Node={2,7:N1} MB  Tree={3,7:N1} MB  Processes={4}' -f
            $now,
            $row.tui_rss_mb,
            $row.node_rss_mb,
            $row.tree_rss_mb,
            $row.tree_processes
        )

        if ($missingTreeSamples -ge 3) {
            Write-Warning 'The monitored process tree has been absent for three samples; monitoring stopped.'
            break
        }

        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    Write-Host "Samples written: $sampleCount"
    Write-Host "CSV: $OutputPath"
}
