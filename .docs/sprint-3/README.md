# Sprint 3: OAuth Connect Flow (End-to-End)

**Goal:** Implement the complete OAuth 2.0 flow: discovery (RFC 9470 + 8414), PKCE, dynamic client registration, authorization redirect, callback handling, token exchange, and storage. Click "Connect" on Notion → go through OAuth → come back connected.

**Status:** done

---

## How to Test This Sprint

Open `localhost:3000` and verify:
1. Click "Connect" on Notion card and confirm app initiates OAuth through backend route(s)
2. Confirm discovery is performed using protected resource metadata and authorization server metadata
3. Approve consent on Notion OAuth screen and confirm redirect back to app callback route
4. Confirm callback validates state, exchanges code for tokens, and stores credentials in SQLite
5. Refresh page and confirm Notion card shows `Connected` with timestamp
6. Force an expired/invalid token scenario and confirm app transitions to `Reconnect` state
7. Click `Disconnect` and confirm credentials are removed and card returns to `Not Connected`
8. `bun run build` succeeds

---

## Task Dependency Graph

```
Task 1 (OAuth Discovery) → Task 2 (PKCE + Authorize Route) → Task 3 (Callback + Token Exchange)
Task 3 (Credential Storage) → Task 4 (Connect/Disconnect APIs)
Task 3 (Credential Storage) → Task 5 (Refresh + Lifecycle Hardening)
Task 4 (APIs) + Task 5 (Lifecycle) → Task 6 (UI Connect/Disconnect Flow)
```

## Tasks

| # | Task | File | Status | Depends On |
|---|------|------|--------|------------|
| 1 | OAuth Discovery (RFC 9470 + RFC 8414) | [task-1](task-1-oauth-discovery.md) | done | — |
| 2 | PKCE + Authorize Route | [task-2](task-2-authorize-route-with-pkce.md) | done | Task 1 |
| 3 | Callback Handling + Token Exchange Storage | [task-3](task-3-oauth-callback-token-storage.md) | done | Task 2 |
| 4 | Server Connect/Disconnect API Routes | [task-4](task-4-connect-disconnect-api.md) | done | Task 3 |
| 5 | Token Refresh + Credential Lifecycle Hardening | [task-5](task-5-token-refresh-lifecycle.md) | done | Task 3 |
| 6 | UI Connect/Disconnect + OAuth Callback UX | [task-6](task-6-ui-connect-disconnect-flow.md) | done | Task 4, Task 5 |

## Definition of Done

- OAuth discovery works for MCP servers that implement RFC 9470 + RFC 8414
- PKCE is enforced for authorization code flow (`S256`)
- OAuth state is securely stored, validated, and expires automatically
- Client registration is handled when `registration_endpoint` is available
- Callback exchanges authorization code for tokens and persists credentials in SQLite
- Connect/disconnect flows update server connection status in API + UI
- Token refresh handles rotation and `invalid_grant` re-auth behavior
- Notion end-to-end connect/disconnect flow is manually verified
- `bun run build` succeeds without TypeScript errors
