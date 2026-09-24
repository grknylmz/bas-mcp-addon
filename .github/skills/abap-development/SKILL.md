---
name: abap-development
description: Implement or change ABAP programs, classes, interfaces, function groups, reports, and existing ABAP behavior. Use for ABAP feature work, fixes, and refactoring.
---

# ABAP development

1. Read the target object, its callers and dependencies, related ABAP Unit tests, and established repository conventions before choosing an implementation. When Clean Core or ABAP Cloud compatibility is required, check released-API status for relevant dependencies using the live `GetAPIReleaseState` tool and its current schema.
2. Translate the request into observable behavior. Add or refine the relevant ABAP Unit regression assertion before production implementation; run it to observe the failure when execution is available.
3. Make the smallest implementation that meets that behavior. Use the live source-edit tool schemas: `EditSource` for a localized change and `WriteSource` for a larger rewrite. Keep source changes within the user-authorized target and preserve existing object conventions.
4. Run the regression test after implementation and validate relevant callers and dependencies with the available checks. Record actual results and any checks that could not run; do not treat lint or syntax checks as a substitute for ABAP Unit behavior coverage.