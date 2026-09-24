---
name: abap-debugging
description: Diagnose ABAP runtime failures using SAP dumps, application logs, traces, call context, and debugger facilities. Use when investigating ABAP defects or production-like incidents.
---

# ABAP debugging

1. Reproduce the reported failure when safe and within the requested target. Establish the observed input, outcome, and execution context before changing code.
2. Inspect relevant dumps, application logs, traces, call/reference context, and debugger state using only the current live MCP tool listing and schemas. Correlate evidence to the failing path before proposing a cause.
3. Keep debugger sessions and execution bounded. Do not change business data or attach to, interrupt, or alter another user's session. Prefer read-only diagnostics unless a change is specifically authorized.
4. Verify a fix against the reproduced failure when possible and distinguish reproduced behavior from diagnostic inference.