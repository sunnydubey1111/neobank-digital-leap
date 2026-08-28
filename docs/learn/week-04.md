# Week 04 — Storage architecture


## Key concepts (my study notes)
- **DAS / NAS / SAN** (server-attached → appliance → network of devices as one).
- **RAID 0/1/5/6** (stripe / mirror / single parity / dual parity).
- **Cloud storage:** frontend API → storage-logic → backend; traits incl. multi-tenancy,
  scalability, **efficiency (compression/dedup)**, cost.
- **Multi-tenancy** + **Noisy Neighbor**. Patterns: **Deployment Stamps, Sharding, Geodes.**

## What clicked
Even as one bank, the multi-tenancy lens may apply to *customers*; **tiered storage + data
reduction** look like direct cost levers (NFR-080).

## Questions this raises for my NeoBank design
- Hot vs. cold data → tiering for cost? → [hld.md §8](../solution/hld.md)
- RAID/replication per store for no data loss (NFR-020)?
- Sharding in year 1 or later? Geodes only if regions added (A-01)? → [D4/D5](../solution/decisions.md)
