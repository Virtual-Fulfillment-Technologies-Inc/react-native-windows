/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 * @format
 */
/**
 * Returns the path to the global NuGet packages folder, checking (in order):
 * 1. The NUGET_PACKAGES environment variable
 * 2. The `dotnet nuget locals` command output
 * 3. The default ~/.nuget/packages location
 */
export declare function getNugetGlobalPackagesFolder(): string;
/**
 * Locates a PowerShell executable, checking (in order):
 * 1. pwsh.exe on the system PATH (preferred — matches a full PowerShell install)
 * 2. A NuGet-restored copy under the global packages folder (non-CI only)
 *
 * Throws if no pwsh.exe can be located.
 */
export declare function findPowerShell(): string;
