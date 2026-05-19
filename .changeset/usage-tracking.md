---
"pi-adapter-cf": minor
---

Add cumulative token usage and cost tracking per session. Usage is accumulated from assistant message events, broadcast via WebSocket, included in state responses, and available via a dedicated REST endpoint. New `onUsage` config callback for budget enforcement.
