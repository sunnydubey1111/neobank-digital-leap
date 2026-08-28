# Decision Log — NeoBank *Digital Leap*

Every significant architecture decision, with the context that forced it, the options that were
genuinely considered, the choice made, and the consequences accepted — including the
unwelcome ones. A decision without a stated cost has not been made, only asserted.

Referenced throughout the [High Level Design](hld.md). Requirement identifiers (FR-, NFR-, C-,
A-) are defined there.

| | Decision | Status |
|---|----------|--------|
| [D1](#d1--architecture-documented-as-versioned-text) | Architecture documented as versioned text | Accepted |
| [D2](#d2--service-decomposition-and-integration-style) | Service decomposition and integration style | Accepted |
| [D3](#d3--mainframe-integration-strategy) | Mainframe integration strategy | Accepted |
| [D4](#d4--source-system-data-ingestion-approach) | Source-system data ingestion approach | Accepted |
| [D5](#d5--serving-fast-low-cost-reads) | Serving fast, low-cost reads | Accepted |
| [D6](#d6--cloud-platform-and-region-strategy) | Cloud platform and region strategy | Accepted |
| [D7](#d7--fraud-detection-architecture) | Fraud detection architecture | Accepted |
| [D8](#d8--event-backbone-technology) | Event backbone technology | Accepted |
| [D9](#d9--meeting-99999-with-a-core-dependent-write-path) | Meeting 99.999% with a core-dependent write path | Accepted |
| [D10](#d10--gdpr-erasure-against-a-legally-immutable-ledger) | GDPR erasure against a legally immutable ledger | Accepted, pending legal confirmation |
| [D11](#d11--read-model-storage-engine) | Read model storage engine | Accepted |
| [D12](#d12--workload-placement-on-premises-versus-cloud) | Workload placement, on-premises versus cloud | Accepted |
| [D13](#d13--not-sharding-the-read-model) | Not sharding the read model | Accepted |
| [D14](#d14--customer-identity-and-consent) | Customer identity and consent | Accepted |
| [D15](#d15--disaster-recovery-posture) | Disaster recovery posture | Accepted — differs from the brief vision |

---

## D1 — Architecture documented as versioned text

**Related:** NFR-530.

**Context.** The design will be revised many times over twelve months by a team of 60, and must
survive as a reference well beyond delivery. Binary diagram files diverge from the document,
cannot be reviewed line by line, and cannot be diffed.

**Options.** Diagramming suite with exported images · a wiki · diagrams and decisions as text in
the same repository as the design.

**Decision.** Diagrams are authored as Mermaid and decisions as records in this log, both
version-controlled alongside the High Level Design and organised on the C4 model — context,
container, then cross-cutting and flow views. Images are exported only for the Word submission.

**Consequences.** Every change is reviewable and attributable, and the diagram cannot silently
drift from the text describing it. The cost is that Mermaid constrains layout: it cannot produce
the hand-tuned composition a dedicated tool can, and complex diagrams must be split rather than
crowded. That has been accepted as the right trade for reviewability.

---

## D2 — Service decomposition and integration style

**Related:** C-06, C-07, NFR-380, NFR-410.

**Context.** Sixty developers, mostly new to this domain, must ship an MVP in twelve months.
Decomposition determines both how fast they can work in parallel and how much operational
surface they must run from day one.

**Options.**

| Option | Assessment |
|--------|-----------|
| Single deployable application | Simplest to operate, but couples every team's release to every other and cannot satisfy the independent-deployability target (NFR-380) |
| Fine-grained microservices | Maximum independence, but distributed-systems overhead — service discovery, tracing, saga complexity, dozens of pipelines — imposed on a new team against a fixed deadline |
| **Coarse services aligned to bounded contexts** | A modest number of services, each owned by one team, each independently deployable, each with its own datastore where it owns data |
| Event-driven integration with synchronous calls only where a decision must be immediate | Decouples read-path construction from the write path without making every interaction asynchronous |

**Decision.** Coarse services aligned to bounded contexts — accounts and balances, transfers,
fraud, reporting, Open Banking, advisor, identity and consent, core integration. Services
communicate over the event backbone by default, and synchronously only where the caller cannot
proceed without an answer: the transfer path's fraud check and core submission.

**Consequences.** Teams can ship independently at the required cadence without paying full
microservice tax during the first year. The accepted cost is that a bounded context that later
proves too broad will need splitting under load, which is a refactor rather than a redesign.
Choosing event-driven integration as the default also means most of the platform is eventually
consistent by construction — which D5 turns from a cost into the central benefit.

---

## D3 — Mainframe integration strategy

**Related:** FR-070, C-01, C-02, C-06, C-07, NFR-280.

**Context.** The core is COBOL on z/OS with DB2 and ADABAS. It provides exactly the guarantees a
bank is legally obliged to provide — strong consistency, an accurate ledger, full audit trails,
five-nines reliability, and it charges for every operation. There are 5 COBOL developers and 12
months. This is the decision every other decision depends on.

**Options.**

| Option | Assessment |
|--------|-----------|
| Replace the core | A multi-year, bet-the-bank programme. Impossible in twelve months with five COBOL developers, and it would put the ledger's correctness at risk to solve a latency problem. Rejected |
| Let new services query DB2 and ADABAS directly | Fastest to write, and the worst possible outcome: every new service acquires a hard dependency on legacy schemas, every read costs a mainframe operation, and the segregation requirement (NFR-280) becomes unenforceable. Rejected |
| Modernise incrementally in place, moving function off the mainframe as it is displaced | The strangler-fig posture. Correct as a long-term direction, but on its own does not say how the next twelve months work |
| **Keep the core as the system of record and wrap it behind an anti-corruption layer** | Correctness stays where it already works; the new platform gets a modern contract; one component owns every legacy detail |

**Decision.** The Core Banking System remains the system of record for money and is unchanged.
Every money movement is a CBS transaction (P1). A single on-premises **anti-corruption layer**
is the only component permitted to speak to it (P3); it publishes a small domain contract —
described in HLD §3.4.3 — and absorbs COBOL, DB2, ADABAS, CICS and MQ entirely. The strangler-fig
direction is preserved: because every consumer already talks to the ACL's contract rather than
to the core, function can later be moved behind that contract without any consumer changing.

**Consequences.** The write path inherits the core's latency, and transfer *execution* inherits
the core as a serial availability dependency (D9); the transfer latency budget allocates 250 ms
to the commit (§3.8.3). Mainframe capacity becomes a hard throughput ceiling, so the write path
is throttled rather than scaled (§3.8.4). The ACL becomes both a single point of failure and the
programme's critical path with only five COBOL developers: the most serious schedule risk in
the plan (R-02), mitigated by freezing its contract in month 2 and publishing mocks so the other
55 developers are never blocked. In exchange, the bank never gambles its ledger, and one team
absorbs all the legacy complexity instead of every team carrying a share of it.

---

## D4 — Source-system data ingestion approach

**Related:** NFR-080, NFR-090, NFR-180, NFR-200, A-02, A-03, A-17, A-18.

**Context.** If reads are to be served without touching the mainframe (D5), something must
continuously supply current data to whatever does serve them. How that data leaves each source
determines both freshness and cost.

There are **three** sources, not two. The target vision shows DB2 and ADABAS on the mainframe
and a **SQL Server** estate beside them, in both the production and disaster recovery sites.
Only the two mainframe sources carry a per-operation charge, so cost pressure applies unevenly
across them, but the ingestion contract must be uniform regardless.

**Options.**

| Option | Freshness | Mainframe cost | Assessment |
|--------|-----------|----------------|-----------|
| Query the core on demand | Perfect | One operation per query | Defeats the entire purpose. Rejected |
| Periodic full extract | Hours to a day | Low but bursty; heavy batch windows | Too stale for a balance view, and full extracts grow with the customer base |
| Scheduled delta extract | Minutes to hours | Low | Workable fallback; too coarse for the money path |
| **Log-based change data capture** | Seconds | Near zero — reads the recovery log, not the database | Adds no per-query cost, preserves commit order, and is a standard DB2 capability |

**Decision.** Log-based change data capture as the default for every source that supports it —
DB2 from the recovery log, SQL Server from its native transaction-log capture — publishing
committed changes to the event backbone as canonical domain events. For ADABAS, event
replication where the installation supports it, with a scheduled delta extract as the designed
fallback. All three producers run on-premises; the cloud consumes a mirror of the log and never
reaches back for data.

The ingestion tier is **source-agnostic by design**: every producer emits the same event
contract (§3.4.4), so adding, replacing or re-scoping a source changes which events exist, not
how ordering, idempotency, replay or projection work. The design can therefore carry
SQL Server as a first-class source while the brief leaves its contents unspecified (A-18).

Ordering is guaranteed per account by partitioning on the account identifier. Delivery is
at-least-once and projection is idempotent by `(account, sequence_number)`: the achievable
combination, and the one that makes replay safe.

**Consequences.** The read path becomes eventually consistent, bounded at p95 ≤ 5 s (NFR-180),
which the 24-hour allowance (NFR-080) comfortably accommodates for externally originated
activity — and which the write-through in D5 removes entirely for a customer's own actions.
A 30-day replayable log means any derived store can be rebuilt from zero without a single
mainframe operation, so the read model is safe to treat as disposable. The
ADABAS half is the weak point: near-real-time capture is unconfirmed (A-03), so the design
places no money-path decision on customer-master freshness, and the question is
resolved by a spike in phase 0 rather than assumed (OI-03).

The SQL Server source is carried on an explicit assumption rather than an invention. The brief
names it without saying what it holds, so the design assumes non-ledger data (A-18) and records
the question as [OI-10]. The one outcome that would matter architecturally is its holding
authoritative money data, in which case it becomes a second system of record under P1 and joins
the write path; the source-agnostic contract above means the ingestion design itself is
unaffected either way.

---

## D5 — Serving fast, low-cost reads

**Related:** FR-010, FR-040, NFR-130, NFR-160, NFR-200, A-08. **This is the central decision of the architecture.**

**Context.** Millisecond reads are required for up to 1M users, with a 360° view from a single
source — while the authoritative data sits on a mainframe that charges per operation. Measured
against the capacity model, customers read roughly 13 times for every transfer they make
(§3.8.1). Every one of those reads is either free or expensive, depending on this decision.

**Options.**

| Option | Latency | CBS ops/month at year 3 | Assessment |
|--------|---------|------------------------:|-----------|
| Read from the core on every request | Poor, and bounded by the mainframe | 290,000,000 | Fails NFR-130 and NFR-200 simultaneously. Rejected |
| Cache in front of the core | Good on hits; the miss path still costs an operation and a cold cache is a stampede against the ledger | ~60,000,000 | Better, but the mainframe remains on the critical path for correctness and for availability. Rejected |
| **Separate read and write models (CQRS), read model built from the CDC stream** | Consistently good; entirely independent of the core | **20,000,000** | Reads never touch the mainframe at all |

**Decision.** Command Query Responsibility Segregation. Writes go to the core through the ACL.
Reads are served from a derived read model with a cache in front, projected continuously from
the event log (D4). The read model *is* the 360° single source the brief asks for: it is the one
place accounts, balances, transactions and categorised spend are assembled, rather than being
stitched together per request.

The read-your-writes problem is solved rather than tolerated: when the Orchestrator
receives a confirmed CBS commit it writes the authoritative post-state straight into the read
cache before responding (§3.3.2). The customer's own action is visible immediately; the CDC
event that follows seconds later is applied idempotently and merely confirms it.

**Consequences.** This removes **93% of the mainframe operations** the digital channel would
otherwise consume: 290M/month to 20M/month at Year-3 volume (HLD §3.9.6). This is an
architectural result, independent of pricing. Its financial value is material but cannot be
stated as fact, because the brief supplies no per-operation rate; HLD §3.9.7 models it under an
explicit assumption and shows the conclusion holds across a tenfold range.

The decision earns its place even if that rate is unknowable. It is what makes NFR-011
achievable — with no dependency on the core, queries can be engineered to 99.999% (D9) — and it
removes the mainframe as a throughput ceiling on customer growth.

The accepted costs are real. The read model is eventually consistent for activity the customer
did not initiate (L-01), which is why every read response carries `as_of` and
`freshness_seconds` — a customer must be able to see what is actually known. There is now a
second copy of financial data to secure, to reconcile and to erase, which drives the tokenisation
in D10 and the nightly control-total reconciliation in §3.5.4. And a class of bug appears that
does not exist in a single-store design: silent projection drift. The mitigations — replayable
log, idempotent projection, nightly reconciliation, rehearsed rebuild — are not optional extras
but the price of this decision.

---

## D6 — Cloud platform and region strategy

**Related:** C-04, C-06, C-07, NFR-260, NFR-480, FR-200.

**Context.** A cloud environment is required for the API gateway, elastic digital services and
the cloud-only AI advisor. The team is 60 developers with mostly Java and AWS background. The
deadline is twelve months. Personal data must stay in one regulatory region.

**Options.** A single major provider matching the team's existing skills · a different major
provider on its technical merits · multi-cloud for portability and negotiating leverage.

**Decision.** A single provider matching the team's existing AWS experience, one region inside
the regulatory boundary, three availability zones, with the on-premises estate as the second
independent failure domain rather than a second cloud.

The reasoning is that the deadline is real and the skills are the binding constraint (C-07).
Re-skilling 55 developers on an unfamiliar platform while delivering a regulated MVP in twelve
months is not a technical trade-off, it is a schedule failure with extra steps. The provider
also offers dedicated private connectivity to on-premises data centres, which the mainframe
integration depends on.

Multi-cloud was rejected on all three of its usual justifications. Portability: unattainable in
practice once managed data services are used, and using only lowest-common-denominator services
forfeits most of the benefit of being in the cloud at all. Availability: two clouds do not add
resilience here, because the binding availability constraint is the on-premises mainframe, not
the cloud. Leverage: not worth doubling the platform surface a new team must learn and operate
against a fixed deadline.

**Consequences.** Provider lock-in is accepted, and mitigated where it is cheap to do so:
containers rather than proprietary compute abstractions, PostgreSQL and Kafka wire protocols
rather than proprietary APIs, OpenID Connect and OpenTelemetry as open standards, and
infrastructure defined declaratively. A single region means a region-wide provider failure
degrades digital function to what the on-premises estate can serve (L-04) — accepted, because
multi-region would multiply cost and create exactly the data-residency exposure NFR-260 forbids.

---

## D7 — Fraud detection architecture

**Related:** FR-100, FR-110, FR-120, FR-125, FR-130, NFR-140, NFR-150.

**Context.** Two modes are required: real-time on the transfer path, and offline with more data
and more processing time. On detection the transaction is cancelled and the customer informed.
The two modes have irreconcilable constraints — one has 80 milliseconds, the other has hours —
so they cannot be the same system.

**Options.** One model serving both paths · inline scoring only · offline scoring only ·
**two-stage with distinct budgets and distinct placement.**

Inline-only cannot catch patterns that need cross-account history and time. Offline-only means
every fraudulent transfer posts before being caught, which is a materially worse customer
outcome. One model for both forces either an accurate model that is too slow for the money path,
or a fast model that wastes the offline path's budget.

**Decision.** Two engines with separate budgets, separate placement and a shared verdict
contract.

*Real-time*, on-premises, on the money path, before the CBS transaction is submitted. Two-stage:
deterministic rules first, then a model. Features are pre-computed into cache, so the money path
never queries a database. Hard timeout at 100 ms with an explicit written policy on breach —
transfers below the low-risk ceiling proceed and are forced into offline review; above it, they
are held. Placement is on-premises because it sits between the Orchestrator and the ACL, and a
wide-area round trip inside an 80 ms budget is not affordable.

*Offline*, in the cloud, consuming the posted-transaction stream, scoring against full history
and cross-account patterns with models too expensive to run inline. It produces verdicts minutes
to hours after posting.

**The two cancellation cases are different mechanisms, and the distinction matters.**

| | Detected by | When | Cancellation mechanism | Ledger effect |
|---|---|---|---|---|
| **Primary — pre-posting** (FR-120) | Real-time scorer | Before the CBS transaction is submitted | The transfer is **rejected**. No CBS transaction is ever submitted | **None.** Nothing posts, nothing is reversed |
| **Exception — post-posting** (FR-125) | Offline pipeline | Minutes to hours after posting | A **compensating** CBS transaction referencing the original (P4) | Two entries: the original and its reversal, both permanent |

The first is the normal path and the one the brief describes: fraud is caught on the synchronous
transfer path and the transaction is cancelled before any money moves. Compensation exists only
for what the real-time budget cannot catch. The ledger is append-only, so a posted entry is
never edited; above a value threshold an analyst approves the reversal, below it cancellation is
automatic. In both cases the customer is notified in the application (FR-130).

**Consequences.** Both requirements are met without compromising either. The customer sees both
the original posting and its reversal (L-06) — a direct and unavoidable consequence of an
immutable auditable ledger, and the correct behaviour, but not invisible. Two models mean two
training and monitoring pipelines. The 80 ms budget constrains real-time model complexity and
may not be met on the first attempt (R-03), which is why the fallback policy is written into the
design rather than decided during an incident, and why every new model runs in shadow against
live traffic before it is allowed to block a single customer.

---

## D8 — Event backbone technology

**Related:** NFR-050, NFR-180, NFR-320, D4, D5.

**Context.** D4 and D5 both depend on a transport between the core and the derived stores. Its
properties determine whether the read model can be rebuilt, whether ordering is preserved, and
whether a bad projection is recoverable.

**Options.**

| Option | Assessment |
|--------|-----------|
| Message queue with acknowledge-and-delete | Adequate for work distribution, but a consumed message is gone. A read model could never be rebuilt without going back to the mainframe — which is precisely what the architecture exists to avoid. Rejected |
| Direct database replication | Couples every consumer to the legacy schema, undoing D3. Rejected |
| **Distributed, partitioned, replayable log** | Retains events after consumption, guarantees order per partition, supports many independent consumers at different positions, and supports rebuild by replay |

**Decision.** A partitioned, replayable log — Kafka-compatible — as the backbone. An
on-premises cluster is the primary; the cloud cluster is a mirror. Replication factor 3,
minimum in-sync replicas 2, producers acknowledging on full replication. Partition key is the
account identifier, giving total ordering per account. Retention 30 days. Schemas are registered
and `BACKWARD` compatibility is enforced at publish time (NFR-320).

**Consequences.** Read model, analytics lake and offline fraud pipeline are all independent
consumers of one ordered history, each at its own position, each rebuildable by replay. Schema
incompatibility is rejected by the registry at publish time rather than discovered by a broken
consumer in production. The costs: an additional stateful platform to operate and secure in two
locations, 30 days of event data to protect under the same erasure obligation as every other
store (handled by D10's crypto-shredding plus tombstones on compacted topics), and the ordering
guarantee holds only per partition — cross-account global ordering does not exist and no
consumer may assume it.

---

## D9 — Meeting 99.999% with a core-dependent write path

**Related:** NFR-010, NFR-011, NFR-012, NFR-020, NFR-021, NFR-025, NFR-030, C-01, C-08, OI-13,
D3, D5.

**Context.** The requirement is 99.999% uptime — 5.3 minutes a year. The brief does not say what
is being measured, and that omission is the whole difficulty. Three facts bound the answer. The
brief gives the existing Core Banking System as 99.999% reliable, so the core is not a weak link
to be apologised for. Every money movement must be a CBS transaction (C-01), so posting depends
on the core being up. And two 99.999% components in series give 0.99998 under an independence
assumption — roughly 10.5 minutes a year rather than 5.3.

So the question is not whether to commit to 99.999%. It is what the figure is measured over, and
what to do about the fact that nobody has said.

**Options.**

| Option | Assessment |
|--------|-----------|
| Commit 99.999% end to end including ledger posting | Not achievable in series against a 99.999% dependency. A promise the design cannot keep. Rejected |
| Commit a lower single figure such as 99.9% | Contradicts an explicit requirement, and understates what the architecture delivers by a factor of fifty — 525 minutes a year against a composed 10.5. Rejected as both non-compliant and inaccurate |
| Redefine a queued transfer as complete so the headline reads 99.999% | Satisfies the requirement on paper by misrepresenting the service. A customer whose money has not moved does not have a completed transaction. **Rejected — this is the convenient answer and it is dishonest** |
| Pick the favourable interpretation and stay quiet about the other | Passes review until someone asks the obvious question. Rejected |
| **Define the candidate indicators, commit against the platform, publish the composed figure for completion, and raise the boundary as an open issue** | Meets the requirement on a stated scope, discloses what it does not cover, and puts the ambiguity where it belongs |

**Decision.** Availability is committed against four named indicators rather than one number
(HLD §2.2.1). SLI-1 digital channel, SLI-2 read service and SLI-3 transfer-request acceptance
together constitute the **NeoBank Digital Platform: the system this document designs — and are
committed at 99.999%** (NFR-010). SLI-4, CBS-backed completion, additionally depends on the core
and composes to **99.998%** (NFR-020).

Each is measured and reported separately (NFR-025). No blended figure is published, because a
blended figure would let core downtime hide inside a platform number.

**Two things this decision does not do.**

It does not claim SLI-4 meets the requirement. If the intended indicator turns out to be
completed money movement, the design is **0.001% short**, and §2.2.1 says so in those words.
Closing that gap means investing in the mainframe, not rearchitecting the platform.

It does not treat the multiplication as proof. Two vendor availability figures multiplied
together are a planning estimate: they assume independent failure domains, and the platform and
core share a data centre, a network and an operations team. Correlated failure is real and
unquantified here. The figure sizes the expectation and identifies the dominant dependency; only
measurement over time establishes what is actually delivered.

**A queued transfer is not a completed transaction.** Store-and-forward keeps *acceptance*
available when the core is not. It does not move money, and nothing in this design represents it
as having done so: the transfer sits in `ACCEPTED (pending)`, changes no balance, appears in no
statement, and is shown to the customer as pending until it posts. Every financial transaction
still executes as a CBS transaction (P1); store-and-forward defers that execution rather than
replacing it.

**Consequences.** The requirement is met on a scope that is stated rather than assumed, and the
shortfall against the stricter reading is disclosed rather than absorbed. The cost is that the
business must engage with a four-line availability statement instead of one number, and must
settle the measurement boundary (OI-13, R-04). Store-and-forward also introduces a
customer-visible pending state the application has to present honestly, which FR-090 requires
anyway and which is better than either refusing the transfer or misreporting it.

---

## D10 — GDPR erasure against a legally immutable ledger

**Related:** FR-240, NFR-250, NFR-270, C-05, A-15.

**Context.** A customer may demand erasure of all their data. Financial records carry a statutory
retention period measured in years, so the ledger entries cannot lawfully be deleted. The same
personal data has also been copied, by design, into the read model, cache, event log, analytics
lake, advisor digest, and every backup and archive of those. Two legal obligations point in
opposite directions, and a design that ignores either one is not deliverable.

**Options.**

| Option | Assessment |
|--------|-----------|
| Delete rows wherever the customer appears | Cannot reach backups, archives or a compacted event log without restoring and rewriting them, which is not operationally credible. Also conflicts with statutory retention. Rejected |
| Retain everything and rely on a legal exemption | Not defensible for derived marketing- and analytics-grade copies that carry no retention obligation of their own. Rejected |
| **Tokenise personal data and crypto-shred on erasure** | Reaches every copy simultaneously, including offline media, and preserves the statutory financial record |

**Decision.** Personal data lives in exactly one place: the on-premises PII Vault — and travels
everywhere else only as an opaque `customer_token` (P5). Each customer's personal data is
encrypted under a per-customer data encryption key held in the vault, backed by a hardware
security module. On erasure the vault record is deleted and **that key is destroyed**. Every
derived copy — read model, cache, event log, analytics lake, advisor digest, and every backup and
archive of any of them — was encrypted under that key and becomes permanently unreadable at the
same instant. Compacted event-log topics additionally receive a tombstone. The ledger retains
its legally required financial record, now bearing only a token that resolves to nothing.

**Consequences.** This satisfies both obligations at once, and it is the only mechanism that
reaches backup and archive media — no row-level delete can, and any design claiming otherwise is
claiming something it cannot deliver. It also improves the breach position materially: a
compromise of the read model, the cache, the analytics lake or the event log yields pseudonymous
data rather than identities.

The costs are accepted with open eyes. The vault becomes the most security-critical component in
the estate and a hard dependency for any operation needing real identity. Key destruction is
irreversible — an erroneous erasure cannot be undone, so the request path requires
authentication, a legal-hold check and an audit record. Per-customer key management at 1M
customers is real operational work. And the whole approach rests on counsel accepting
crypto-shredding as erasure (A-15); it is common practice where retention and erasure conflict,
but it is not this architecture's call to make. That confirmation is OI-02, scheduled before
the vault is built out, because there is no fallback design if the answer is no.

---

## D11 — Read model storage engine

**Related:** FR-010, FR-020, FR-040, NFR-130, NFR-190, D5.

**Context.** D5 created a read model that must serve ~1,100 requests per second at peak, hold a
90-day hot window of roughly 150 GB, answer both key-lookup queries (balance) and range and
aggregate queries (statements, monthly income and expenses), and support erasure.

**Options.**

| Option | Assessment |
|--------|-----------|
| Managed key-value store | Excellent single-digit-millisecond key lookups and effortless scaling, but the monthly report (FR-020) needs range scans and aggregation, which would have to be precomputed into yet another store or done in application code |
| Two engines — key-value for balances, relational for reporting | Optimal for each access pattern, at the cost of two engines to operate, two consistency stories and two erasure implementations, for a workload neither engine would find demanding |
| **Managed relational database, multi-AZ with read replicas, plus a cache** | Serves both access patterns; scales out by adding replicas; familiar to the team; one erasure implementation |

**Decision.** A managed PostgreSQL-compatible cluster — one writer, multi-AZ synchronous
standby, read replicas added as load grows — with an in-memory cache in front holding current
balances and recent transactions for active accounts.

The deciding argument is that at year-three volume this workload is not large. 80 write
transactions per second and 150 GB is unremarkable for a single relational writer, and the cache
absorbs ~85% of reads before they arrive. Introducing a second engine to optimise a workload
that is already comfortably inside one engine's envelope would buy operational cost and no
capability. Relational range queries and aggregation are exactly what FR-020 needs, the team
already has SQL, and a single engine means one erasure path rather than two.

**Consequences.** Read scaling is by replica addition, which requires no schema change and no
redeployment (NFR-190). The write path to the read model is a single instance, so it is a
scaling ceiling — sized at year three to roughly 2% of capacity, and D13 records the trigger
points and the partitioning already in place should that change. Cache invalidation becomes a
correctness concern, addressed by the projector writing through on every change and by TTLs
bounding any staleness.

---

## D12 — Workload placement, on-premises versus cloud

**Related:** C-03, C-04, FR-200, NFR-510, NFR-520, NFR-280.

**Context.** Some services may legally run only on-premises; the AI advisor may run only in the
cloud. Between those two fixed points, everything else must be placed on a stated principle
rather than by preference — placement drives cost, latency and the compliance position.

**Decision.** Placement follows P9: a service runs on-premises only if regulation, data
sensitivity or latency-to-core requires it; otherwise it runs in the cloud.

| On-premises | Why |
|-------------|-----|
| Anti-corruption layer | The only admitted path to the core zone (NFR-280) |
| Transfer Orchestrator | Holds in-flight money state; must survive a cloud outage; must be adjacent to the ACL |
| Real-time fraud scorer | An 80 ms budget cannot absorb a wide-area round trip, and it needs full unmasked transaction context |
| Consent and identity, PII Vault | Raw personal data and per-customer keys; hardware security modules |
| CDC producers, primary event backbone | Adjacent to the source; publishes before anything crosses the link |

| Cloud | Why |
|-------|-----|
| API gateway, BFF, account, reporting, Open Banking, notification | Internet-facing, spiky, read-only; benefits directly from elasticity |
| Offline fraud pipeline | Needs elastic compute for models too expensive to run inline; consumes tokenised data only |
| AI advisor | Cloud-only by constraint (FR-200); consumes only the tokenised digest |
| Analytics lake, observability | Volume and cost favour object storage and managed services |

**Consequences.** The regulated core keeps a hard perimeter and the elastic tier gets to be
elastic. The unavoidable cost is a wide-area hop on the write path — 12 ms round trip, budgeted
in §3.8.3 — and two platforms to build, secure and operate. The same container images and
manifests run in both (NFR-500), which keeps that cost to infrastructure rather than duplicating
application work.

The financial consequence is worth stating plainly. On-premises capacity must be bought before
it is needed, because it cannot autoscale. At Year-1 MVP scale it is ~$17,540 per month (HLD
§3.9.3): the largest single cost in Year 1, and unaffected by having few users — rising to
~$25,810 by Year 3. It is sized for the MVP plus headroom and incremented in Year 2 rather than
bought for Year-3 peak on day one, which would tie up capital in hardware idle for two years.
Either way this is the strongest argument for keeping the on-premises footprint to genuinely
regulated workloads and nothing more.

Offline fraud placement in the cloud assumes a favourable data-classification review (OI-07); if
that goes the other way, the pipeline moves on-premises and the on-premises tier must grow.

---

## D13 — Not sharding the read model

**Related:** NFR-110, NFR-190, D11.

**Context.** One million users sounds like a sharding problem. Measured against the capacity
model it is not: 80 write transactions per second and about 150 GB of hot data at year three.

**Options.** Shard now, to avoid a painful migration later · shard never, and handle it when it
arrives · **do not shard, but make sharding cheap.**

**Decision.** Do not shard. Partition read tables on a hash of `customer_token` from day one, so
a future split is a data movement rather than a schema rewrite, and record the trigger points
explicitly: sustained write throughput above 5,000 transactions per second, or a hot dataset
above 10 TB. Year three reaches neither — it is roughly 2% of the first threshold and 1.5% of
the second.

**Consequences.** The team is spared cross-shard queries, resharding operations and distributed
transaction complexity for capacity the bank will not need for years, and the option is retained
at essentially zero cost. The risk accepted is that growth far beyond the stated projection would
force the migration under time pressure; the recorded trigger points and the existing
partitioning exist so that it is a planned operation rather than a discovery. Stating the
thresholds is what makes this a decision rather than an omission.

---

## D14 — Customer identity and consent

**Related:** FR-160, FR-170, FR-220, FR-230, NFR-210, NFR-230.

**Context.** Three distinct populations authenticate: customers, third-party providers under
Open Banking, and internal services. Consent is a first-class regulatory object with its own
lifecycle — granted, scoped, expiring, revocable, and it must be enforced at request time, not
merely recorded.

**Decision.** Customers authenticate via OpenID Connect with passkeys as the primary factor and
device binding, with step-up re-authentication demanded for transfers above a configurable
threshold (FR-230). Third parties authenticate with OAuth 2.0 client credentials under a
financial-grade API profile using certificate-bound tokens, so the certificate rather than the
client identifier is the identity. Services authenticate with mutual TLS and short-lived
workload identities — no shared secrets anywhere in the estate.

Consent is held on-premises alongside identity, is versioned and revocable, and is validated on
every Open Banking request and before every advisor retrieval. Validation results are cached
only briefly, so a revocation takes effect in seconds rather than at the next token refresh.

Authorisation is enforced twice: coarse-grained scope at the gateway, and record ownership again
in the service holding the data. A gateway alone is a single point of authorisation failure.

**Consequences.** Passkeys remove the phishing and credential-stuffing exposure that dominates
retail banking fraud, at the cost of a recovery flow for lost devices that must itself be
resistant to social engineering. Certificate-bound tokens mean a stolen token is useless without
the corresponding key. Enforcing authorisation twice costs a small amount of duplicated logic and
is worth it. Placing consent on-premises adds a cross-link call to the Open Banking read path,
which the short-TTL cache absorbs while keeping revocation prompt.

---

## D15 — Disaster recovery posture

**Related:** NFR-060, NFR-070, NFR-490, C-08, D12. **This decision differs from the target vision
in the brief and is recorded for that reason.**

**Context.** The brief's target vision shows Production and Disaster Recovery drawn
symmetrically: a full cloud tier, a full on-premises tier and all three source databases on both
sides, joined by a replication arrow. Read literally, that is an active-active or hot-standby
estate with roughly double the infrastructure.

Two things complicate a literal reading. The source databases on the DR side are the mainframe's
own DB2 and ADABAS, whose replication is part of the existing core platform and outside this
programme's scope (C-01). And a full hot standby of the new platform roughly doubles the
on-premises capital cost: the largest single line in Year 1 (§3.9.3) — to protect against a
site loss whose tolerable recovery time has not yet been agreed ([OI-04](hld.md#8-open-issues)).

**Options.**

| Option | Recovery time | Relative cost | Assessment |
|--------|---------------|---------------|-----------|
| Cold standby — hardware ordered on failure | Days | Lowest | Incompatible with any five-nines conversation. Rejected |
| **Warm standby — DR site provisioned, data replicated, services scaled down** | ≤ 60 min, declared manually | ~30–40% of production | Meets a manually declared site-failover objective at materially lower cost |
| Hot standby — DR fully scaled, ready to take traffic | Minutes, automatic | ~100% of production | Justified only if the agreed RTO is minutes. Not yet established |
| Active-active across both sites | Near zero | >100%, plus split-brain and write-arbitration complexity on the money path | Substantial complexity against a one-year MVP deadline (C-06) |

**Decision.** Warm standby. The DR site is provisioned and its data is continuously replicated —
synchronously for Transfer Orchestrator state, so RPO remains 0 (NFR-040), but its services run
scaled down until failover is declared. Cloud-side resilience is separate and stronger: three
availability zones with automatic recovery inside 5 minutes (NFR-060), which handles the failure
mode that actually occurs frequently.

The split is deliberate. **Frequent, small failures are handled automatically** by multi-AZ
redundancy. **Rare, large failures** — loss of an entire site — are handled by a declared
failover inside 60 minutes (NFR-070). Paying hot-standby prices to shorten the rare case, while
the agreed recovery objective is still open, would be spending before knowing the requirement.

**Consequences.** Approximately $8,000–12,000 per month of on-premises capital cost is avoided
compared with a symmetric estate, and the DR site still holds a complete, current copy of every
system of record. The accepted cost is a manual declaration step and up to an hour of degraded
service in a site-loss scenario — during which, notably, the cloud query path continues serving
from its own multi-AZ replicas, so customers retain read access throughout.

This is a **conscious divergence from the brief's illustrated vision**, not an oversight. If the
business continuity workshop ([OI-04](hld.md#8-open-issues)) sets an RTO in minutes rather than an
hour, the decision inverts to hot standby and §3.9.3 grows accordingly; the topology and
replication design do not change, only the scale at which the DR services run.

---

## Recording a new decision

Add the next identifier in sequence. A useful entry names at least two options that were
genuinely considered, ties itself to specific requirement identifiers, states the trade-off
being **accepted** rather than only the benefits obtained, and could be defended out loud to
someone who preferred a different option.
