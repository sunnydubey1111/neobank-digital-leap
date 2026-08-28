# NeoBank — Project *Digital Leap*

**A high-level architecture design for a retail bank's digital transformation.**

A publicly traded retail bank (1M customers, 200 branches, founded 1905) runs its Core Banking
System as COBOL on z/OS, with DB2 holding transactions, ADABAS holding customers and a SQL
Server estate alongside them. That core delivers exactly what a bank is legally obliged to
deliver: strong consistency, an accurate ledger, full audit trails, five-nines reliability. It
also charges for every operation.

Regulation and fintech competition now demand millisecond digital experiences at a scale and
release cadence the mainframe was never designed for, while every money movement must still be a
Core Banking System transaction.

**About this project.** The final project of the Global Dev Experts *Software Architect*
programme, written against a fixed brief. The brief gave the business context, requirements and
constraints; the architecture and everything that follows from it are mine. Ambiguities in the
brief are recorded as assumptions and open issues rather than resolved silently.

## The central idea

**Separate the read path from the write path.** Money movement stays a CBS transaction, reached
only through an on-premises anti-corruption layer. Everything a customer *reads* is served from
a derived read model, fed continuously by change data capture from DB2, ADABAS and SQL Server
over a replayable event log. Reads never touch the mainframe.

| | |
|---|---|
| **Mainframe load** | 290M → 20M operations per month at Year 3, a **93% reduction**, derived from the design rather than from any price assumption |
| **Latency** | p95 of 55 ms on a balance read, against a 100 ms budget |
| **Availability** | 99.999% committed for the digital platform. Completion additionally needs the core and composes to 99.998%. A queued transfer is shown as pending, never as complete |

## The documents

- **[High Level Design](solution/hld.md)** — the design deliverable: context, requirements,
  architecture, data, security, performance, sizing, cost model, delivery estimate, risks and
  open issues.
- **[Decision Log](solution/decisions.md)** — fifteen architecture decisions, each recording the
  options considered and the trade-off accepted.
- **[Diagrams](solution/diagrams.md)** — legend, C4 context, target platform vision, container
  views, data architecture, network topology, six flow sequences, the transfer state machine and
  the scaling view.

Supporting study notes run from [Week 1 — Foundations](learn/week-01.md) through
[Week 14 — Machine learning](learn/week-14.md), covering the patterns applied in this design.

## Where to start

If you have five minutes, read [D5 — Serving fast, low-cost
reads](solution/decisions.md#d5--serving-fast-low-cost-reads). Every other decision either
enables it or handles a consequence of it.
