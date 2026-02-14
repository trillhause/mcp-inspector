# Task 6: Auto Rediscovery + Token Refresh Resilience

**Sprint:** 4 - MCP Capabilities Discovery
**Status:** not_started
**Depends on:** Task 4, Task 5

## Description

Tie capabilities discovery into connect/reconnect lifecycle so capability data stays current and resilient through token refresh or transient provider failures.

## Steps

1. Trigger discovery on successful connect/reconnect:
   - After OAuth callback success, enqueue or invoke capability refresh for that server
   - Avoid blocking callback UX on long capability fetches

2. Add stale-cache policy:
   - Define TTL or refresh heuristics for capabilities (for example, manual refresh + periodic staleness check)
   - Preserve last-good cache when live refresh fails

3. Handle lifecycle transitions:
   - On disconnect, clear capabilities cache for that server
   - On reconnect-required state, keep cache readable but mark possibly stale

4. Expose manual refresh entry point:
   - Add inspector action to refresh capabilities on demand
   - Surface progress and completion/error feedback

5. Add integration test checklist:
   - Connect -> discover -> inspect
   - Token refresh during capability fetch
   - Disconnect -> cache cleared -> reconnect -> rediscover

## How to Test

- Complete OAuth connect and confirm capabilities appear without manual API calls
- Force token refresh path and confirm capability fetch still succeeds transparently
- Disconnect and confirm stale capabilities are no longer shown as active for that server
- Use manual refresh action and confirm updated capability counts

## Acceptance Criteria

- [ ] Capability discovery is integrated with connect/reconnect lifecycle
- [ ] Cache freshness and stale-data behavior are explicitly defined and implemented
- [ ] Manual refresh is available from inspector UX
- [ ] End-to-end lifecycle flow is reliable across connect, refresh, disconnect, and reconnect
