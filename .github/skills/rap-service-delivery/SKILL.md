---
name: rap-service-delivery
description: Validate and deliver SAP RAP OData services, behavior implementations, service bindings, activation, publication, and runtime checks. Use with RAP service exposure or end-to-end RAP validation tasks.
---

# RAP service delivery

## MCP tool shortlist

Query the active MCP server's live `tools/list` once and use exact destination-prefixed names and schemas. Prefer these tools when available: `GetSystemInfo`, `GetFeatures`, `GetConnectionInfo`, `SearchObject`, `GrepObjects`, `GrepPackages`, `GetSource`, `GetObjectStructure`, `GetCDSDependencies`, `GetCDSImpactAnalysis`, `GetCDSElementInfo`, `EditSource`, `WriteSource`, `UpdateSource`, `UpdateClassInclude`, `CreateClassWithTests`, `CreateTestInclude`, `LintABAP`, `SyntaxCheck`, `RunUnitTests`, `RunATCCheck`, `GetCodeCoverage`, `RunQuery`, `GetTableContents`, `ExecuteABAP`, `ListDumps`, `GetDump`, `GetApplicationLog`, `GetTrace`, `Activate`, `ActivateMultiple`, and `PublishServiceBinding`. Use `UnpublishServiceBinding` only when explicitly requested.

1. Confirm target destination, package, transport/temporary target, RAP object names, and whether activation/publication/data mutation is authorized.
2. Inspect the full RAP object chain before changing anything: interface/root CDS, child/composition CDS, behavior definition, behavior pool/local handlers, projection CDS, projection behavior, service definition, service binding, tests, and package conventions.
3. Validate behavior implementations with tests first where feasible. Cover validations, determinations, actions, feature control, numbering, authorization-relevant branches, reported/failed messages, and negative or empty paths.
4. Validate runtime service behavior end-to-end. Use read-only `RunQuery`/`GetTableContents` for query paths. For mutating behavior, proceed only when authorized, use isolated data, verify persisted state/messages, and clean up when possible.
5. Activate in dependency order only when authorized: lower CDS/model dependencies first, then behavior artifacts, projections, service definition, and service binding. Publish only when explicitly requested.
6. If runtime validation fails, inspect dumps/logs/traces with `ListDumps`, `GetDump`, `GetApplicationLog`, and `GetTrace` before guessing. Report exact evidence, not inferred success.
