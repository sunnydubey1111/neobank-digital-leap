# Week 11 — Cloud, SaaS and web architecture

## Key concepts (my study notes)
- **Five characteristics of cloud:** on-demand self-service · broad network access · **resource
  pooling** · **rapid elasticity** · **measured service** (usage is tracked, so cost follows demand).
- **Deployment models:** **public** (shared tenancy, cheapest, no infrastructure to run) ·
  **private** (single tenant, more control — the usual choice where security and compliance
  dominate) · **hybrid** (both, joined over an encrypted connection, chosen for flexibility).
- **Service models:** **IaaS** (compute/storage/network; you keep applications, data, middleware) ·
  **PaaS** (a platform to build and deploy on) · **SaaS** (the vendor runs everything) ·
  **serverless** (no server management at all — no patching, no provisioning). Control falls as you
  move up the pyramid.
- **SaaS practices:** microservices over a monolith so each part deploys and scales alone ·
  self-service and good APIs · **multi-tenancy** (fewer idle resources — but a heavy tenant may need
  single-tenant isolation) · **RBAC** for data access · autoscaling designed in from the start ·
  minimal downtime · **cost monitoring**, which multi-tenancy makes easy to lose sight of.
- **Web architecture:** DNS → load balancer → web/app servers → database, with a **caching service**
  (key/value, stores expensive computations), **full-text search** over an **inverted index**, **job
  servers** for async work, a **data pipeline** into cloud storage and a warehouse, and a **CDN**
  serving static assets from edge locations.
- **Horizontal vs. vertical scaling:** always scale out on the web tier — servers crash, networks
  degrade, whole data centres go offline, and there is no machine big enough anyway.
- **API Gateway / BFF:** direct client-to-microservice calls mean chatty round trips, a bigger
  attack surface, and clients coupled to internal decomposition. A gateway gives one entry point,
  reverse proxying, authentication, TLS termination and caching — and is built around the *client's*
  needs, which is why it's also called backend-for-frontend.

## What clicked
The gateway/BFF argument is precisely why the design puts a BFF in front of the read services with
"one round trip per screen" as a stated goal. With a millisecond-level latency requirement, each
extra client-to-service round trip is latency the customer feels — and it's the aggregation tier,
not the network, that fixes it.

**Measured service** reframed the cost model: cloud cost is a design output, not a procurement
detail. Every sizing choice in §3.8 has a price attached in §3.9 because the platform bills by
consumption.

Hybrid is also no longer a compromise in my head. It's the only model that satisfies "the ledger
stays on-premises" and "the advisor must run in the cloud" at the same time — the boundary is drawn
by regulation and by where the data legally lives.

## Questions this raises for my NeoBank design
- Managed services vs. self-hosted on the cloud side — where does operational cost beat control? → [D6](../solution/decisions.md), [D8](../solution/decisions.md)
- Serverless anywhere on the read path, or does the latency budget rule out cold starts? → [§3.8](../solution/hld.md)
- Is a CDN worth it when every response is personalised and nothing is cacheable at the edge? → [§3.8](../solution/hld.md)
- Cost monitoring as a first-class operational requirement, not a monthly surprise → [§3.9](../solution/hld.md)
- Single tenant by definition here (one bank) — so which multi-tenant lessons still apply? → [D12](../solution/decisions.md)
