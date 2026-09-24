---
name: cds-development
description: Implement, change, or analyze ABAP CDS data definitions and their dependencies or consumers. Use for DDLS and CDS modeling tasks.
---

# CDS development

## Tool shortlist

Query the active MCP server's live `tools/list` once; use task-relevant, destination-prefixed tools with their returned schemas. Read DDLS with `GetSource`; use `GetCDSDependencies` for upstream dependencies, `GetCDSImpactAnalysis` for consumers, and `GetCDSElementInfo` for element metadata. Trace references with `FindReferences`; edit via `EditSource` / `WriteSource` and validate with `SyntaxCheck` plus relevant tests or ATC when available.

1. Inspect the target DDLS source, its existing data definitions, package conventions, dependencies, and consumers before editing.
2. Use live `GetCDSDependencies`, `GetCDSImpactAnalysis`, and `GetCDSElementInfo` tools when exposed to understand upstream sources, downstream impact, and element metadata. Use their current destination-prefixed names and schemas.
3. Implement only the requested CDS behavior. Validate the changed definition, affected dependencies, and relevant consumers with operations actually exposed by the system; report unavailable analysis or validation capabilities rather than inferring results.