# Week 08 — Big data architecture

## Key concepts (my study notes)
- **Big data = volume + variety + velocity.** The answer to all three is a **data pipeline** that
  separates **compute from storage**.
- **Reference pipeline:** data sources → *data storage* (distributed file store, the **data lake**)
  and *real-time message ingestion* (a buffer supporting scale-out and reliable delivery) → **batch
  processing** / **stream processing** → **analytical data store** → analysis and reporting, with
  **orchestration** across the whole thing.
- **Processing topologies:** **batch** (let data pile up; hours to days old; fine when freshness
  isn't critical or the algorithm needs the whole set) · **stream** (process on arrival, sub-second,
  little or no state — used for fraud decisions and real-time serving) · **micro-batch** (under a
  minute; fresh but not instant).
- **Distribution at scale:** splittable file formats, parallel processing across cluster nodes.
- **Partitioning** — for scalability, performance, security, cost-matched storage and availability:
  - **Horizontal (sharding)** — same schema, each shard a subset of rows. **The shard key is the
    decision that's hard to reverse**; balance requests, not just size.
  - **Vertical** — split columns by access pattern; hot fields together, and sensitive fields
    isolated so they can carry their own controls.
  - **Functional** — split by bounded context; also the way to separate read-write from read-only.
- **Lambda architecture:** batch layer (immutable master dataset) + speed layer (real-time view) +
  serving layer (merges both). Cost: two systems, two code paths, changed logic must land in both.
- **Kappa architecture:** drop the batch layer, treat everything as a stream over a replayable log.

## What clicked
The batch/stream split is exactly the two-mode fraud requirement. Real-time scoring is stream
processing under a hard latency budget with pre-computed features and almost no state; the offline
pipeline is batch over full history where minutes-to-hours is acceptable. Seeing them named as two
*topologies* rather than two implementations of one thing is why the design gives them separate
budgets and separate placement.

The Lambda-vs-Kappa comparison landed too. The NeoBank design is closer to **Kappa** — one
replayable event log feeding every derived store — and the reason is precisely the limitation
listed: I don't want two code paths that must be changed together.

Vertical partitioning also gave a name to the PII Vault: sensitive fields in their own partition
with their own controls, everything else carrying only a token.

## Questions this raises for my NeoBank design
- Shard key if the read model ever needs splitting — and why it isn't needed yet → [D13](../solution/decisions.md)
- Lake retention and tiering: how long before archive, and what does that cost? → [§3.5](../solution/hld.md), [§3.9](../solution/hld.md)
- Do the batch and stream fraud paths share features, or drift apart into two models? → [D7](../solution/decisions.md)
- Is the analytics lake tokenised end to end, so no batch job ever sees raw PII? → [§3.5.7](../solution/hld.md)
