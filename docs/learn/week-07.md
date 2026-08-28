# Week 07 — Databases and the persistence layer

## Key concepts (my study notes)
- **Relational / SQL:** structured data, **schema on write**, indexing and normalization, and
  **ACID** — *atomicity* (all-or-nothing), *consistency* (valid before and after), *isolation*
  (intermediate state invisible), *durability* (survives failure).
- **DBMS tiers:** 1-tier (everything on one box) · 2-tier (client talks straight to the database)
  · 3-tier (presentation → business logic → data access), the usual choice for distributed systems.
- **Normal forms:** 1NF atomic values, no repeating groups · 2NF no partial dependency on part of a
  composite key · 3NF no transitive dependency on the key.
- **Microservice data patterns:** **database-per-service** (loose coupling, independent schema
  change and scaling) — and the consequence that you **cannot use ACID transactions across
  services**.
- **CQRS:** split the command (write) database from the query (read) database, joined by
  **eventual consistency**; the read side is a **materialized view**. Suits write-less/read-more.
- **Event sourcing:** store the sequence of events, not just current state, so you can **replay**
  to any point; the event store publishes to a bus that builds the read view.
- **NoSQL — "not *only* SQL":** **schema on read**, denormalized on purpose, built for scale.
  Families: **key-value**, **column store** (columns stored separately, good for wide/sparse),
  **document** (JSON/BSON, nested, schema-less), **graph** (nodes + edges, relationship-first).

## What clicked
This lesson is the direct justification for the shape of the whole NeoBank design. CQRS is not a
flourish here — reads outnumber writes about 13:1, which is exactly the "write-less, read-more"
condition where the pattern pays. The command side stays ACID on DB2 through the mainframe, and the
query side becomes a materialized view I control.

The line "you can't use ACID transactions between distributed systems" is why the transfer path is
a **saga with a compensating transaction** rather than a distributed transaction, and why the
ledger is append-only: a reversal is a new entry, never an edit.

Also useful: schema-on-write vs. schema-on-read named the split I already had — DB2/ADABAS impose
their schema on write, while the analytics lake takes events as they come and imposes structure
when read.

## Questions this raises for my NeoBank design
- Read model engine: relational materialized view vs. document store, given the access patterns? → [D11](../solution/decisions.md)
- Event sourcing *properly*, or CDC-fed projection? (I chose the latter — the CBS is the event source) → [D4](../solution/decisions.md)
- Database-per-service vs. one shared read model across query services → [D2](../solution/decisions.md), [D13](../solution/decisions.md)
- Where the eventual-consistency window is visible to a customer, and how to keep it out of their own actions → [§3.5](../solution/hld.md)
