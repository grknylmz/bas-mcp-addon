
# Additional VSP tools exposed through the BAS proxy

The proxy forwards these tools when the installed VSP mode registers them. They extend its existing curated tool set.

## Analysis, metadata, debugging, and trace

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

## Object, source, transport, and service operations

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
- `CreateTransport`
- `ListDependencies`
- `PublishServiceBinding`
- `UnpublishServiceBinding`

## Destination-scoped workflow tools

The proxy adds local multi-step tools to each destination when their required VSP capabilities are available:

- `PrepareABAPChangeSet` and `ApplyABAPChangeSet` — review full-source diffs and recheck source before explicit writes.
- `CheckTransportReadiness` — collect a whitelisted bundle of transport, dependency, inactive-object, ABAP Unit, and ATC results.
- `PlanABAPCloudMigration` — batch SAP API release-state checks and prioritize recognized unreleased results.
- `GenerateRAPRegressionSuite` and `RunRAPRegressionSuite` — create and run reusable OData GET-only checks under the selected service root.

`sap-ai-dev-toolkit --doctor` checks destination probing, VSP startup, `GetSystemInfo`, and MCP tool listing. `sap-ai-dev-toolkit --demo` runs the sample tools and OData fixtures without contacting SAP; demo writes and transport creation remain in memory until that process exits.
