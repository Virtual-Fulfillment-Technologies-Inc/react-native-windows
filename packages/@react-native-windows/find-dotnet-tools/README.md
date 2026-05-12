# @react-native-windows/find-dotnet-tools

Helpers to locate .NET-based tools (e.g. PowerShell) restored via `dotnet tool restore` or
available on PATH.

Used to resolve tool paths consistently across local development and CI
environments.

## Usage

Add the package as a dependency:

```json
{
  "dependencies": {
    "@react-native-windows/find-dotnet-tools": "<version>"
  }
}
```

### findPowerShell

Locates a PowerShell executable by checking, in order:

1. `pwsh.exe` on the system PATH
2. A NuGet-restored copy under the global packages folder (non-CI only; may require a matching .NET runtime)

Throws an error if `pwsh.exe` cannot be found.

```js
import {findPowerShell} from '@react-native-windows/find-dotnet-tools';

const pwsh = findPowerShell();
// e.g. "C:\\Program Files\\PowerShell\\7\\pwsh.exe", or a NuGet packages path if PATH has no pwsh
```

### getNugetGlobalPackagesFolder

Returns the path to the global NuGet packages folder by checking, in order:

1. The `NUGET_PACKAGES` environment variable
2. The output of `dotnet nuget locals global-packages --list`
3. The default `~/.nuget/packages` location

```js
import {getNugetGlobalPackagesFolder} from '@react-native-windows/find-dotnet-tools';

const packagesDir = getNugetGlobalPackagesFolder();
// e.g. "C:\\Users\\user\\.nuget\\packages"
```
