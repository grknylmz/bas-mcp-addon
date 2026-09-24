---
name: abap-testing-quality
description: Design ABAP Unit behavior tests and validate ABAP changes with lint, editor diagnostics, syntax checks, and ATC. Use for test creation, quality reviews, and change validation.
---

# ABAP testing and quality

## Tool selection

Query the active MCP server's live `tools/list` once, then use only task-relevant, destination-prefixed tools with their returned schemas: `LintABAP` for caller-supplied source, `SyntaxCheck` for SAP syntax validation, `RunUnitTests` for ABAP Unit, and `RunATCCheck` for ATC. Unavailable tools are not passes.

- Treat ABAP Unit as behavior verification: assert externally observable results, boundaries, state transitions, and relevant error behavior. Static analysis and syntax checks find different classes of problems and do not replace behavior tests.
- For a behavior change, create or refine a real ABAP Unit assertion first, run it to observe the regression, then rerun after implementation. If an executable red/green cycle is unavailable, state the concrete constraint and the strongest check actually performed; never report a substitute as a passing test.
- Run the live destination-prefixed `LintABAP` MCP tool on all relevant caller-supplied source files, using abapGit-style filenames and including required dependency sources. The tool analyzes only the files supplied to it; it does not read the workspace or resolve dependencies.
- Consume BAS editor LSP diagnostics when configured. `vsp lsp --stdio` is editor LSP functionality, not an MCP tool and not an entry in MCP `tools/list`.
- Use SAP `SyntaxCheck`, `RunUnitTests`, and `RunATCCheck` when exposed by the live tool listing and permitted for the task. Address findings and rerun affected checks. Do not suppress findings silently or present unavailable/skipped checks as passes.
- Report ABAP Unit, lint, LSP, syntax, and ATC outcomes separately, including exact reasons for checks not run.