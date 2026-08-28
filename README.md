# NeoBank — Project *Digital Leap*

**A high-level architecture design for the digital transformation of a 120-year-old retail
bank.** It carries a COBOL/z-OS mainframe core into a hybrid on-premises and cloud platform
serving a million customers in real time, without putting the ledger at risk.

<p align="left">
  <img alt="Type" src="https://img.shields.io/badge/type-architecture%20design-blue">
  <img alt="Domain" src="https://img.shields.io/badge/domain-fintech%20%2F%20banking-6f42c1">
  <img alt="Diagrams" src="https://img.shields.io/badge/diagrams-C4%20%2B%20Mermaid-0aa">
  <img alt="License" src="https://img.shields.io/badge/license-MIT-green">
  <img alt="Origin" src="https://img.shields.io/badge/origin-course%20final%20project-orange">
</p>

| | |
|---|---|
| **Role** | Solution architect |
| **Context** | A publicly traded retail bank (1M customers, 200 branches, founded 1905) must go digital or lose ground to fintechs and open-banking rivals |
| **Challenge** | Millisecond latency, five-nines availability and GDPR erasure, on top of an unchangeable COBOL core that charges for every operation |
| **Constraints** | 12 months to MVP · 60 developers, only 5 of them COBOL · one regulatory region · minimise operating cost |
| **Outcome** | A read/write-split hybrid architecture that removes 93% of the mainframe operations the digital channel would otherwise consume: 290M a month down to 20M at Year-3 volume |

**About this project.** It is the final project of the Global Dev Experts *Software Architect*
programme, written against a fixed brief. The brief supplied the business context, the
requirements and the constraints; the architecture, the decision record, the sizing, the cost
model and the delivery plan are mine. Where the brief is ambiguous the design says so rather than
choosing quietly — those readings are recorded as assumptions in §4 and raised as open issues in
§8, addressed to a business sponsor in the document's own terms and to the course instructor in
practice.

## The problem

NeoBank's Core Banking System is COBOL on z/OS, with DB2 holding transactions and ADABAS
holding customers; a SQL Server estate sits alongside them as a third source system. The core
delivers exactly what a bank is legally obliged to deliver: strong consistency, an accurate
ledger, full audit trails and 99.999% reliability. It also charges for every operation, running
to millions of dollars a year.

Two forces have made that core a liability as well as an asset. Regulation forced the bank to
sell its credit-card company, turning a subsidiary into a direct competitor, and Open Banking
obliged it to expose customer data to fintechs building competing products on top of it.
Meanwhile digital payment providers now offer the full retail financial product set.

The bank needs remarkable digital experiences, immediate responses at any scale, and new
channels shipped in weeks, while every money movement remains a Core Banking System transaction.

## The central idea

**Separate the read path from the write path.**

Money movement stays a CBS transaction, reached only through an on-premises anti-corruption
layer, so correctness and auditability are never traded away. Everything a customer *reads*
(balances, transactions, reports, the 360° view, Open Banking responses) is served from a
derived read model, fed continuously by change data capture from all three source systems: DB2,
ADABAS and SQL Server, over a replayable event log. Reads never touch the mainframe.

Measured against the capacity model, customers read about thirteen times for every transfer they
make. Moving those reads off the core does three things at once:

| | |
|---|---|
| **Mainframe load** | 290M → 20M operations per month at Year 3, a **93% reduction**. This follows from the design, not from any price assumption |
| **Latency** | p95 of 55 ms on a balance read, against a 100 ms budget, because no request waits on a mainframe |
| **Availability** | 99.999% committed for the digital platform, since nothing on the request path needs the core. Completion additionally needs the core and composes to 99.998%, reported separately rather than blended away |

A customer's own action is never subject to replication lag: on a confirmed CBS commit the
Transfer Orchestrator writes the authoritative post-state straight into the read cache before
responding. The eventual-consistency window applies only to activity someone else initiated.

## The documents

| Document | What it is |
|----------|------------|
| **[High Level Design](docs/solution/hld.md)** | The design deliverable — context, requirements, architecture, data, security, performance, sizing, cost model, delivery estimate, risks and open issues |
| **[Decision Log](docs/solution/decisions.md)** | Fifteen architecture decisions, each recording the options considered and the trade-off accepted |
| **[Diagrams](docs/solution/diagrams.md)** | Legend, C4 context, target platform vision, container views, data architecture, network topology, six flow sequences, the transfer state machine and the scaling view, all as Mermaid |
| **[Delivery Roadmap](ROADMAP.md)** | Year-1 MVP against Year-3 target state, and how 7,980 developer-days across eight streams fit inside 60 developers and twelve months |

Supporting study notes on the architectural patterns applied here are in
[`docs/learn/`](docs/learn/).

## Design principles

Nine rules govern the design. Any change that breaks one is a change to the architecture, not
to an implementation.

1. **The ledger is the only truth** — every money movement is a CBS transaction.
2. **Never read money from the core** — reads come from derived models.
3. **Talk to the core only through the anti-corruption layer** — no service knows COBOL, DB2, ADABAS, CICS or MQ.
4. **Corrections are new transactions** — posted entries are immutable; fraud reversal is a compensating transaction.
5. **Personal data lives in one vault and travels as a token** — no raw PII in ledgers, read models, events, logs or model prompts.
6. **Every boundary is a versioned contract** — a producer may not break a consumer.
7. **Every core-facing call is idempotent, bounded and metered.**
8. **Availability is measured on what it actually depends on.** 99.999% for the digital platform; completion additionally needs the core and composes to 99.998%. A queued transfer is pending, never complete.
9. **Placement is a compliance decision, not a preference.**

## Two design details worth the click

**GDPR erasure against a legally immutable ledger.** Financial records carry statutory
retention, so ledger rows cannot be deleted — yet the same personal data has been copied into
six derived stores plus their backups. The design encrypts each customer's data under its own
key held in an on-premises vault; erasure destroys that key, rendering every copy unreadable at
once, including backups and archives that no row-level delete can reach. The ledger keeps its
required financial record, now bearing only a token that resolves to nothing.
→ [D10](docs/solution/decisions.md#d10--gdpr-erasure-against-a-legally-immutable-ledger)

**Fraud caught after a transfer has already posted.** The offline engine scores against full
history and produces verdicts hours after posting. The ledger is append-only, so cancellation is
effected by a compensating CBS transaction referencing the original. The customer sees both
entries — a visible, unavoidable and correct consequence of an auditable ledger.
→ [D7](docs/solution/decisions.md#d7--fraud-detection-architecture)

## Reading it as a website

The Markdown renders directly on GitHub, diagrams included. To build a searchable site with
navigation and dark mode:

```bash
pip install mkdocs-material
mkdocs serve   # http://127.0.0.1:8000
```

Diagram export for the Word deliverable is described in
[`tools/export-diagrams.md`](tools/export-diagrams.md).

---

<sub>Produced for the Global Dev Experts *Software Architect* programme. The brief is theirs;
the design is mine. This repository contains only original work — the copyrighted course slides,
recordings and summaries are deliberately excluded, and the study notes under
<a href="docs/learn/">docs/learn</a> are my own summaries rather than course material.</sub>
