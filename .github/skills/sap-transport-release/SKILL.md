---
name: sap-transport-release
description: Prepare ABAP changes for SAP transport and verify request contents, dependencies, tests, and activation. Use for transport preparation or release-related requests.
---

# SAP transport preparation

1. Use the live transport tools to verify the destination, package, complete object set, dependencies, and an eligible modifiable request before preparing changes. Use current tool names and schemas; do not assume a request is valid from its identifier alone.
2. Create a transport only when the user specifically authorized its creation. Run the available tests and ATC checks and activate objects in dependency order when requested; report actual request contents and validation state.
3. This addon filters `ReleaseTransport` and `DeleteTransport`. Do not invent or claim release/deletion support. When release is requested, report that release is unavailable through this addon and hand off the release action to an authorized SAP transport workflow.