# Week 12 — Performance, scalability and resilience

## Key concepts (my study notes)
- **Cache-aside:** check the cache, on a miss read the store and populate it. **Write-through**
  writes to the store and invalidates (or updates) the cache in the same step. Cached data will
  never be perfectly consistent — the design has to *detect and handle* staleness, not pretend it
  away.
- **Orchestration vs. choreography:** a central **orchestrator** acknowledges the request and
  drives each step, and every service stays ignorant of the wider workflow. **Choreography** has
  services react to messages and hand off among themselves — better when services are added and
  changed often, and when the orchestrator itself becomes the bottleneck.
- **Materialized view:** a pre-computed, query-shaped view of data stored in a form optimised for
  *writing*. It is **read-only, never updated directly, and completely disposable** — rebuildable
  from the source at any time. Effectively a specialised cache.
- **Event sourcing:** store the whole history, not just current state. Events are immutable and
  append-only, so there's no update contention; the append-only store *is* the audit trail; state is
  materialised by replaying events. Commonly paired with CQRS.
- **CRUD's limits:** direct updates cost performance, cause contention under concurrency, and lose
  history unless something else logs it.
- **Static content hosting:** serve static assets from storage rather than burning application
  compute on them.
- **Sharding strategies:** range-based (simple, risks uneven distribution) · vertical · **hash-based**
  (even spread, the usual default).
- **Tenets of scalable architecture:** **statelessness** (push state into the data layer so
  instances are interchangeable) · **loose coupling** · **events instead of direct calls** (producer
  and consumer each move at their own pace) · **managed infrastructure** where running it yourself
  buys nothing.

## What clicked
"A materialized view is completely disposable because it can be rebuilt from the source" is the
single sentence that makes the read model safe to be as aggressive as it is. It can be re-derived
from the event log, so indexing, denormalising or reshaping it is a cheap decision rather than a
migration.

The orchestration/choreography split also confirmed a deliberate inconsistency in my design. The
transfer path is **orchestrated** because someone must own the outcome of moving money and be able
to compensate. Everything downstream of the ledger — projections, analytics, offline fraud,
notifications — is **choreographed** off the event log, because those consumers change often and no
central coordinator should have to know about them.

Cache-aside vs. write-through matters more here than it looks. The design uses **write-through on
the customer's own transaction** specifically so a customer never sees their own action lag, and
cache-aside everywhere else where a few seconds of staleness is acceptable.

## Questions this raises for my NeoBank design
- Cache invalidation on the fraud-reversal path — the balance changes without a customer action → [§3.3.3](../solution/hld.md)
- Which parts of the platform are genuinely stateless, and where does state legitimately live? → [§3.8](../solution/hld.md)
- Hash-based sharding on `customer_token` if the read model ever splits — trigger points → [D13](../solution/decisions.md)
- Is the orchestrator a single point of contention at Year-3 write volume? → [§3.8.1](../solution/hld.md)
- Managed vs. self-run for the event backbone — operational cost against control → [D8](../solution/decisions.md)
