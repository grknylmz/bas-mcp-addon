---
name: sap-transport-release
description: Prepare ABAP changes for SAP transport and verify request contents, dependencies, tests, and activation. Use for transport preparation or release-related requests.
---

# SAP transport preparation

## Tool shortlist

Query the active MCP server's live `tools/list` once; use task-relevant, destination-prefixed tools with their returned schemas. Identify candidates with `GetUserTransports` or `ListTransports`; inspect a request with `GetTransport` / `GetTransportInfo`; use `ListDependencies`, `RunUnitTests`, and `RunATCCheck` as needed. Activate with `Activate` / `ActivateMultiple` only when requested. `CreateTransport` is state-changing and requires explicit authorization. Release and deletion are not available through this addon.

1. Use the live transport tools to verify the destination, package, complete object set, dependencies, and an eligible modifiable request before preparing changes. Use current tool names and schemas; do not assume a request is valid from its identifier alone.
2. Create a transport only when the user specifically authorized its creation. Before transport handoff, ensure changed objects have been activated in dependency order when activation is authorized, ABAP Unit tests have been run or blockers documented, runtime validation evidence exists for changed public contracts, and ATC/syntax checks have been run where available. Report actual request contents and validation state.
3. This addon filters `ReleaseTransport` and `DeleteTransport`. Do not invent or claim release/deletion support. When release is requested, report that release is unavailable through this addon and hand off the release action to an authorized SAP transport workflow.
