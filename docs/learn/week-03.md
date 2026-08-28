# Week 03 — Architecture patterns II (resilience & CQRS)


## Key concepts (my study notes)
- **Retry** (transient failures: cancel / immediate / after-delay).
- **Throttling / rate limiting** (cost, DDoS, load; combine with autoscaling).
- **Circuit breaker** (Closed → Open → Half-Open; fail fast).
- **CQRS** (separate read/write models; reads dominate & are immutable → replicate).
- **Shared-nothing** (no shared memory/disk; scale by adding nodes; shard = data on one node).

## What clicked
This lesson feels central to NeoBank's core tension — **ms-level reads vs. a costly per-op
mainframe.** CQRS, caching, and resilience patterns all look relevant to explore.

## Questions this raises for my NeoBank design
- Is a **read/write split** worth its consistency cost? Real read:write ratio? → [D5](../solution/decisions.md)
- Where do **circuit breaker / retry / throttling** belong? → [hld.md §7](../solution/hld.md)
- Does the read tier need **sharding** for 1M users?
