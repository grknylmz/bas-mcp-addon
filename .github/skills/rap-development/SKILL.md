---
name: rap-development
description: Develop SAP RAP business objects, behavior, projections, and OData services. Use when implementing or changing RAP models and service publication.
---

# RAP development

1. Inspect target-system release and capabilities with live `GetSystemInfo` and `GetFeatures` tools when available; inspect existing RAP objects and package conventions before design. Confirm RAP support and each required operation from the active MCP `tools/list`, not from static documentation.
2. Build the requested model through the required dependencies: CDS entities, behavior definitions and implementations, projections, service definitions, and service bindings. Follow existing object patterns and validate objects in dependency order with operations actually exposed by the system.
3. Publish a service only when the user requested and authorized publication. Validate the service end-to-end using the live tools available for that system; report actual publication and runtime state.
4. If RAP support or a required object operation is unavailable, stop that path and report the exact capability gap. Do not claim completion based on source text or inferred support.