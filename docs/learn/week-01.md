# Week 01 — Foundations of software architecture

**Date:** 2026-05-27 · **Session:** Lesson 1 (Intro I)

## Key concepts (my study notes)
- **Architecture** = the most important components, their relations & interactions — driven by
  **quality attributes**, not just features.
- Traits: many **stakeholders**, **quality-driven**, **conceptual integrity** (architect =
  keeper of the vision), **separation of concerns** → architectural **views**.
- **4+1 views:** Logical, Process, Development, Physical + Scenarios. **Conway's Law.**
- Architect chooses: tech, decomposition (monolith vs. microservices), infra (on-prem vs.
  cloud), data (SQL vs. NoSQL), interfaces (REST vs. GraphQL). **Breadth > depth.**
- **3 forces:** functional reqs, non-functional reqs, restrictions (legal, cost, TTM, talent).

## What clicked
Functional = what it **does**; non-functional = how it must **be**. For NeoBank the
non-functionals (99.999%, ms-latency, no data loss, cost, GDPR) look like the real drivers.

## Questions this raises for my NeoBank design
- How should I **rank** quality attributes when they conflict?
- Which **restrictions** bite hardest (5 COBOL devs, per-op cost, 1-yr MVP, GDPR) and how do
  they shape the design? → [decisions.md D3/D6](../solution/decisions.md)
- Which **4+1 views** must my HLD show?
