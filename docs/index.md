# NeoBank — Project *Digital Leap*

**A high-level architecture design for a retail bank's digital transformation.**

A publicly traded retail bank — 1M customers, 200 branches, founded 1905 — runs its Core
Banking System as COBOL on z/OS, with DB2 holding transactions and ADABAS holding customers.
That core delivers exactly what a bank is legally obliged to deliver: strong consistency, an
accurate ledger, full audit trails, five-nines reliability. It also charges for every operation.

Regulation and fintech competition now demand millisecond digital experiences at a scale and
release cadence the mainframe was never designed for — and every money movement must still be a
Core Banking System transaction.

## The central idea

**Separate the read path from the write path.** Money movement stays a CBS transaction, reached
only through an on-premises anti-corruption layer. Everything a customer *reads* is served from
a derived read model, continuously fed by change data capture over a replayable event log. Reads
never touch the mainframe.

| | |
|---|---|
| **Cost** | 290M → 20M mainframe operations per month at year three — a 93% reduction, ~$3.24M/year |
| **Latency** | p95 of 55 ms on a balance read, against a 100 ms budget |
| **Availability** | The read path has no dependency on the core, so it can genuinely target five nines even though the core-dependent write path cannot |

## The documents

- **[High Level Design](solution/hld.md)** — the design deliverable: context, requirements,
  architecture, data, security, performance, sizing, cost model, delivery estimate, risks and
  open issues.
- **[Decision Log](solution/decisions.md)** — fourteen architecture decisions, each with the
  options genuinely considered and the trade-off accepted.
- **[Diagrams](solution/diagrams.md)** — C4 context and container, data architecture, network
  topology, six flow sequences, the transfer state machine and the scaling view.

Supporting study notes on the architectural patterns applied here begin at
[Week 1 — Foundations](learn/week-01.md).

## Where to start

If you have five minutes, read [D5 — Serving fast, low-cost
reads](solution/decisions.md#d5--serving-fast-low-cost-reads). Every other decision in the design
either enables it or handles a consequence of it.
