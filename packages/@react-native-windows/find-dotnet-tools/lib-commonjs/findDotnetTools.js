"use strict";
/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 * @format
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.findPowerShell = exports.getNugetGlobalPackagesFolder = void 0;
const child_process_1 = require("child_process");
const fs_1 = __importDefault(require("@react-native-windows/fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
/**
 * Returns the path to the global NuGet packages folder, checking (in order):
 * 1. The NUGET_PACKAGES environment variable
 * 2. The `dotnet nuget locals` command output
 * 3. The default ~/.nuget/packages location
 */
function getNugetGlobalPackagesFolder() {
    if (process.env.NUGET_PACKAGES) {
        return process.env.NUGET_PACKAGES;
    }
    try {
        const output = (0, child_process_1.execSync)('dotnet.exe nuget locals global-packages --list', {
            encoding: 'utf8',
        }).trim();
        const match = output.match(/global-packages:\s*(.+)/i);
        if (match) {
            return match[1].trim();
        }
    }
    catch { }
    return path_1.default.join(os_1.default.homedir(), '.nuget', 'packages');
}
exports.getNugetGlobalPackagesFolder = getNugetGlobalPackagesFolder;
/**
 * Locates a PowerShell executable, checking (in order):
 * 1. pwsh.exe on the system PATH (preferred — matches a full PowerShell install)
 * 2. A NuGet-restored copy under the global packages folder (non-CI only)
 *
 * Throws if no pwsh.exe can be located.
 */
function findPowerShell() {
    try {
        const found = (0, child_process_1.execSync)('where pwsh.exe', { encoding: 'utf8' }).trim();
        if (found) {
            return found.split(/\r?\n/)[0];
        }
    }
    catch { }
    if (!process.env.TF_BUILD) {
        const nugetPackages = getNugetGlobalPackagesFolder();
        const nugetPwsh = path_1.default.join(nugetPackages, 'PowerShell', '7.6.1', 'tools', 'net10.0', 'any', 'win', 'pwsh.exe');
        if (fs_1.default.existsSync(nugetPwsh)) {
            return nugetPwsh;
        }
    }
    throw new Error('Unable to find pwsh.exe. It should have been made available by `yarn install`.');
}
exports.findPowerShell = findPowerShell;
//# sourceMappingURL=findDotnetTools.js.map