# VSP Tool Inventory

This inventory reflects the current BAS MCP proxy behavior in `src/mcp-proxy.mjs`. The proxy now exposes every tool registered by the active child VSP process. The live MCP `tools/list` response remains authoritative because available tools vary by VSP mode and SAP system.

## Summary

| Status | Count | Notes |
| --- | ---: | --- |
| VSP tools | Dynamic | All registered child VSP tools are exposed with a destination prefix, for example `<destination>__GetSource`. |
| Add-on tools | 2 | `LintABAP` is local. `GetApplicationLog` is a convenience mapping to VSP `SAP(action="analyze", type="application_log")`. |
| Intentionally filtered VSP tools | 0 | No VSP tool names are filtered by the proxy. |
| Mode-dependent | Dynamic | Focused/expert mode and backend capabilities determine what VSP registers. |

## Currently known VSP tools

These are known from the repository fixtures, README, and historical proxy allowlist. All are enabled when VSP registers them.

### Baseline/source inspection

- `GetSource`
- `SearchObject`
- `GrepObjects`
- `GrepPackages`
- `FindDefinition`
- `FindReferences`
- `GetContext`
- `CompareSource`
- `GetClassInfo`
- `GetPackage`
- `GetFunctionGroup`
- `GetMessages`
- `GetInactiveObjects`
- `GetAPIReleaseState`

### Data, CDS, and metadata

- `GetTable`
- `GetTableContents`
- `RunQuery`
- `GetCDSDependencies`
- `GetCDSImpactAnalysis`
- `GetCDSElementInfo`
- `GetFeatures`
- `GetSystemInfo`
- `GetInstalledComponents`

### Create, update, activate, and quality

- `WriteSource`
- `EditSource`
- `CreatePackage`
- `CreateTable`
- `SyntaxCheck`
- `Activate`
- `ActivateMultiple`
- `ActivatePackage`
- `PrettyPrint`
- `RunUnitTests`
- `RunATCCheck`

### Transport tools

- `GetTransport`
- `GetTransportInfo`
- `GetUserTransports`
- `ListTransports`
- `CreateTransport`
- `ReleaseTransport`
- `DeleteTransport`

### Additional analysis, help, and call graph tools

- `AnalyzeABAPCode`
- `AnalyzeCallGraph`
- `CodeCompletion`
- `GetAbapHelp`
- `GetCallGraph`
- `GetCalleesOf`
- `GetCallersOf`
- `GetCodeCoverage`
- `GetConnectionInfo`
- `GetObjectStructure`
- `GetTypeHierarchy`
- `GetTypeInfo`
- `GrepObject`
- `GrepPackage`
- `CallRFC`

### Debugging, dumps, breakpoints, and trace

- `DebuggerAttach`
- `DebuggerDetach`
- `DebuggerGetStack`
- `DebuggerGetVariables`
- `DebuggerListen`
- `DebuggerStep`
- `DeleteBreakpoint`
- `GetBreakpoints`
- `GetDump`
- `GetSQLTraceState`
- `GetTrace`
- `ListDumps`
- `SetBreakpoint`
- `ListSQLTraces`

### Object, source, dependency, and service operations

- `CloneObject`
- `CreateAndActivateProgram`
- `CreateClassWithTests`
- `CreateObject`
- `CreateTestInclude`
- `DeleteObject`
- `ExecuteABAP`
- `GetClass`
- `GetClassComponents`
- `GetClassInclude`
- `GetFunction`
- `GetInclude`
- `GetInterface`
- `GetProgram`
- `GetStructure`
- `GetTransaction`
- `LockObject`
- `MoveObject`
- `RecoverFailedCreate`
- `RenameObject`
- `SaveToFile`
- `UnlockObject`
- `UpdateClassInclude`
- `UpdateSource`
- `WriteClass`
- `WriteProgram`
- `ListDependencies`
- `PublishServiceBinding`
- `UnpublishServiceBinding`

### General VSP router

- `SAP`

## Enabled add-on/local tools

- `LintABAP` — local add-on tool; lints caller-supplied ABAP source without contacting SAP.
- `GetApplicationLog` — add-on convenience tool mapped to VSP `SAP` with `action="analyze"` and `type="application_log"`.

## Notes

- Runtime tool names are namespaced by destination slug, for example `demo-abap__RunQuery`.
- The proxy starts VSP with `--enable-transports`; generated MCP entries set `SAP_ALLOW_TRANSPORTABLE_EDITS=true`.
- Transport release/deletion and the general-purpose `SAP` router are now exposed when registered by VSP; use SAP authorizations and client-side approvals to control access.
