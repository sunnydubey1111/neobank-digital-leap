# Week 02 — Architecture patterns I

**Date:** 2026-06-03 · **Session:** Lesson 2 (Patterns I)

## Key concepts (my study notes)
- **Layered / N-tier:** Presentation → Application → Business → Data (separation of concerns).
- **Client–server / 3-tier.** **Event-driven (EDA):** async producers/consumers, decoupled.
- **SOA + ESB.** **Microservices:** small, independent, API-exposed (no central ESB).
- **BFF** (per-client backend). **MVC.**

## What clicked
Async/EDA + microservices let me **decouple** downstream work (reads, fraud, analytics) from
the expensive mainframe — worth exploring.

## Questions this raises for my NeoBank design
- Monolith vs. microservices for the new tier (given "weeks to launch", NFR-100)?
- Where is **sync** truly required (transfer→fraud→CBS) vs. **async**?
- BFF, or is the API Gateway enough for MVP?
- Integration style at the mainframe boundary → [decisions.md D4/D7](../solution/decisions.md)
