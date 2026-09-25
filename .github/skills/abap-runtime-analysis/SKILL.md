---
name: abap-runtime-analysis
description: Analyze ABAP runtime incidents, dumps, traces, debugger state, call graphs, and performance symptoms. Use for diagnosing failures before or after ABAP/RAP code changes.
---

# ABAP runtime analysis

## MCP tool shortlist

Query the active MCP server's live `tools/list` once and use exact destination-prefixed names and schemas. Prefer these tools when available: `GetSystemInfo`, `GetFeatures`, `GetConnectionInfo`, `GetContext`, `ListDumps`, `GetDump`, `GetApplicationLog`, `GetTrace`, `GetSQLTraceState`, `DebuggerListen`, `DebuggerAttach`, `DebuggerGetStack`, `DebuggerGetVariables`, `DebuggerStep`, `DebuggerDetach`, `SetBreakpoint`, `DeleteBreakpoint`, `GetBreakpoints`, `AnalyzeCallGraph`, `GetCallGraph`, `GetCallersOf`, `GetCalleesOf`, `FindDefinition`, `FindReferences`, `AnalyzeABAPCode`, `GetTypeInfo`, `GetTypeHierarchy`, `SearchObject`, `GrepObjects`, `GrepPackages`, `GetSource`, `GetObjectStructure`, `RunQuery`, `GetTableContents`, `ExecuteABAP`, and `CallRFC`. For authorized fixes, also use `EditSource`, `WriteSource`, `LintABAP`, `SyntaxCheck`, `RunUnitTests`, `RunATCCheck`, `GetCodeCoverage`, `Activate`, and `ActivateMultiple`.

1. Establish incident boundaries: symptom, expected result, object/service, destination, user/session, input, time window, frequency, and whether reproduction/debugging is authorized.
2. Gather read-only evidence first. Correlate dumps, logs, traces, call graph, source, and data conditions by timestamp and object path. Do not start with source edits.
3. For debugger sessions, use bounded breakpoints and attach/listen only to the authorized session. Inspect stack and variables, step minimally, then detach and remove breakpoints. Never attach to another user's unrelated session.
4. For performance symptoms, separate database access, ABAP logic, remote calls, locking, and payload/serialization cost using traces, SQL trace state, call graphs, and measured reproduction evidence when available.
5. Convert evidence into a falsifiable root-cause chain. Clearly label facts, assumptions, and unverified hypotheses.
6. If a fix is authorized, create a regression test where feasible, implement the smallest change, validate with lint/syntax/unit/ATC/LSP checks, activate only when authorized, and rerun the reproduction or strongest available runtime check.
