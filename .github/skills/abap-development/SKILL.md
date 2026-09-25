---
name: abap-development
description: Implement or change ABAP programs, classes, interfaces, function groups, reports, and existing ABAP behavior. Use for ABAP feature work, fixes, and refactoring.
---

# ABAP development

## Tool shortlist

Query the active MCP server's live `tools/list` once; use task-relevant, destination-prefixed tools with their returned schemas. Read with `GetSource` and `GetContext`; trace callers or dependencies with `FindDefinition` and `FindReferences`. Use `EditSource` for a localized change and `WriteSource` for a larger rewrite. Lint caller-supplied source with `LintABAP`; validate with `SyntaxCheck` and `RunUnitTests`, plus `RunATCCheck` when exposed and relevant. For Clean Core requirements, use `GetAPIReleaseState` on each relevant dependency.

1. Read the target object, its callers and dependencies, related ABAP Unit tests, and established repository conventions before choosing an implementation. When Clean Core or ABAP Cloud compatibility is required, check released-API status for relevant dependencies using the live `GetAPIReleaseState` tool and its current schema.
2. Translate the request into observable behavior. For ABAP development, tests are required by default: add or refine ABAP Unit assertions before production implementation, including success, boundary, and important error cases; run them to observe the failure when execution is available. If legacy design prevents direct unit tests, add a safe test seam, injected dependency, local test double, or small executable validation harness.
3. Make the smallest implementation that meets that behavior. Use the live source-edit tool schemas: `EditSource` for a localized change and `WriteSource` for a larger rewrite. Keep source changes within the user-authorized target and preserve existing object conventions.
4. Self-validate the changed public contract. For interfaces, APIs, reports, function modules, and wrappers, execute the changed entry point in BAS or SAP using representative input. Prefer safe read-only real data from the target system; otherwise create isolated sample data only when authorized and clean it up where possible. Verify the actual output, side effects, and at least one empty/negative path.
5. Run the regression tests after implementation and validate relevant callers and dependencies with lint, syntax, ATC, and LSP checks when available. Activate authorized SAP object changes in dependency order and treat activation failures as blockers. Record actual results and any checks that could not run; do not treat lint, syntax, or activation as substitutes for ABAP Unit behavior coverage.
