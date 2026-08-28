# High Level Design — NeoBank *Digital Leap*

| Revision | Date | Author | Details |
|----------|------|--------|---------|
| 0.1 | 2026-06-03 | Sunny Dubey | Requirements, assumptions and constraints baselined |
| 0.2 | 2026-07-08 | Sunny Dubey | Preliminary solution diagram; core integration and read-path decisions |
| 0.3 | 2026-08-19 | Sunny Dubey | Data, security and performance architecture |
| 1.0 | 2026-08-28 | Sunny Dubey | Flows, contracts, sizing, cost model and delivery estimate; issued for review |

## Abstract

NeoBank is a publicly traded retail bank — 1M customers, 200 branches, 10,000 employees,
founded 1905 — whose Core Banking System is COBOL running on z/OS, with DB2 holding
transactions and ADABAS holding customer information. That core delivers what a bank is
legally required to deliver: strong consistency, an accurate ledger, full audit trails and
five-nines reliability. It also charges for every operation, and it was never designed for the
latency, concurrency and release cadence that digital channels demand.

This document specifies the target architecture for *Digital Leap*: a hybrid on-premises and
cloud platform carrying the bank's new digital services — account and balance views, transfers,
a two-mode fraud engine, monthly spending reports, an Open Banking REST API and a cloud-hosted
AI financial advisor — to 100,000 digital users in year one and 1,000,000 within three years,
on a twelve-month MVP schedule, with a team of 60 developers of whom 5 write COBOL.

The design rests on one central move: **separate the read path from the write path.** Money
movement remains a Core Banking System transaction, reached only through an on-premises
anti-corruption layer, so correctness and auditability are never traded away. Everything a
customer *reads* is served from a derived read model, continuously fed by change data capture
from DB2, ADABAS and SQL Server over an event backbone.

That single decision removes **93% of the operations the digital channel would otherwise send to
the mainframe** — 290 million a month down to 20 million at Year-3 volume. That figure follows
from the design and the capacity model and does not depend on any price; what an operation costs
is not stated in the brief, so its financial impact is modelled separately and explicitly as an
assumption (§3.9.7). The same decision also removes the core from the query path entirely, which
is what allows queries to meet a millisecond latency budget and to carry the full 99.999%
availability target.

Sections 1 and 2 establish scope and requirements. Section 3 is the design. Sections 4 through
8 record what the design assumes, what it costs in people and money, and what it does not yet
resolve.

## Contents

1. [General](#1-general)
2. [Requirements](#2-requirements)
3. [High Level Design](#3-high-level-design)
4. [Assumptions and Constraints](#4-assumptions-and-constraints)
5. [Time Estimation](#5-time-estimation)
6. [Limitations](#6-limitations)
7. [Risks and Mitigations](#7-risks-and-mitigations)
8. [Open Issues](#8-open-issues)

Companion documents: the [Decision Log](decisions.md) records the reasoning behind each
significant choice; [Diagrams](diagrams.md) holds every diagram referenced here.

---

# 1. General

## 1.1 Introduction

### 1.1.1 Business context

Retail banking was static for decades. Two forces broke it. Regulation forced NeoBank to sell
its credit-card company three years ago — overnight, a subsidiary became a direct competitor —
and Open Banking obliged the bank to expose customer data to fintechs building competing
services on top of it. In parallel, digital payment providers began offering the full financial
product set that was previously the preserve of retail banks.

The bank's response is not a feature programme. It is a rewiring: deploy technology
continuously and at scale, to improve customer experience and lower cost. The business
objectives are to offer digital experiences customers find remarkable, to serve any number of
users with immediate responses, and to reach the market fast with new channels and services.

### 1.1.2 System goals

| Goal | What it means for this design |
|------|-------------------------------|
| Scale | Millions of customers; thousands of concurrent users |
| Latency | Millisecond-level responses on the customer-facing read path |
| Unified view | A 360° view of customer data served from one place, not stitched together per request |
| Delivery speed | Weeks, not quarters, to launch a new application |
| Cost | Minimise storage and processing spend, with mainframe cost per operation as the dominant lever |
| Correctness | Every money movement remains a Core Banking System transaction, fully audited |

### 1.1.3 Scope

**In scope.** New digital services on-premises and in the cloud; the on-premises hardware and
software build-out; the synchronisation path between on-premises and cloud; the cloud API
gateway serving the mobile app and website; the fraud engine in both modes; the Open Banking
API; the cloud AI advisor; the data ingestion path from all three source systems — DB2, ADABAS
and SQL Server; and the security, data, performance and cost architecture supporting all of it.

**Out of scope.** Any rewrite or functional change to the COBOL Core Banking System; branch,
ATM and teller channels, which continue to address the core directly; card issuing and
acquiring, which left the group with the divested card unit; and the interbank settlement
network itself, which is consumed as an external service.

### 1.1.4 Delivery stages

The brief sets two targets that are often conflated: an **MVP live within one year serving
100,000 digital users**, and **1,000,000 digital users within three years**. This design
distinguishes them throughout. Every sizing, cost and capacity figure in this document is given
for both stages, and the Year-3 column is a target state, not work delivered in Year 1.

| | **Year-1 MVP** | **Year-2 evolution** | **Year-3 target state** |
|---|---|---|---|
| Digital users | 100,000 | ~350,000 | 1,000,000 |
| Peak read throughput | ~110 req/s | ~400 req/s | ~1,100 req/s |
| Peak transfer throughput | ~8 tx/s | ~28 tx/s | ~80 tx/s |
| Functional scope | Every *Must* requirement in §2.1 | Depth and quality, no new *Must* capability | Unchanged feature set at ten times the scale |
| AI advisor (FR-190, *Should*) | First version, narrow scope | Full rollout | At scale |
| Read model | 1 writer + 1 replica | + 1 replica | 1 writer + 3 replicas |
| On-premises estate | 12 servers, 40 TB | + 4 servers, + 40 TB | 20 servers, 120 TB |
| Cloud region and AZs | 1 region, 3 AZs | unchanged | unchanged |

**No structural change occurs between the stages.** The same components, contracts, trust
boundaries and placement rules carry through; what grows is the number of replicas, the size of
instances and the amount of storage. This follows directly from the read/write split:
read capacity is added by adding replicas, with no schema change and no redeployment (NFR-190),
and the write path is not scaled at all, because its ceiling is the core rather than the platform.

Capacity that is **not** bought on day one: the on-premises estate is sized for the MVP plus
defined headroom, with a planned increment in Year 2. Provisioning three years of on-premises
capacity in month 1 would tie up capital in hardware that sits idle for two years; §3.9 prices
both stages separately.

### 1.1.5 Readership

Sections 1, 2, 3.1–3.2 and the cost model in 3.9 are written for product and management.
Sections 3.3–3.8 and 5–8 carry the detail that engineering and operations need.

## 1.2 Glossary

| Term | Meaning |
|------|---------|
| ACL | Anti-corruption layer — the only component permitted to speak to the Core Banking System |
| ADABAS | Software AG database holding the customer master on the mainframe |
| BFF | Backend for frontend — a channel-specific API aggregating services for the app or web client |
| CBS | Core Banking System — the COBOL/z-OS ledger; system of record for money |
| CDC | Change data capture — streaming a database's committed changes as an ordered event feed |
| Compensating transaction | A new posting that reverses an earlier one; posted entries are never edited |
| CQRS | Command Query Responsibility Segregation — separate models for writes and for reads |
| Crypto-shredding | Rendering data unreadable everywhere by destroying its encryption key |
| DB2 | IBM database holding transactions on the mainframe |
| DEK | Data encryption key; here, one per customer, held in the key vault |
| Direct Connect | Dedicated private network link between the on-premises data centre and the cloud region |
| FAPI | Financial-grade API — the OpenID Foundation security profile for Open Banking |
| HSM | Hardware security module — tamper-resistant key storage |
| MIPS | Millions of instructions per second; the unit mainframe capacity is charged in |
| PII | Personally identifiable information |
| Read model | A derived, query-optimised store built from the event stream; never a source of truth |
| RPO / RTO | Recovery point objective (tolerable data loss) / recovery time objective (tolerable outage) |
| SAGA | A long-running transaction expressed as local steps, each with a compensation |
| SoR | System of record — the authoritative store for a given fact |
| SQL Server | Distributed (off-mainframe) database shown as a third source system in the target vision; contents not specified by the brief |
| STRIDE | Threat taxonomy: spoofing, tampering, repudiation, information disclosure, denial of service, elevation of privilege |
| Strangler fig | Incrementally surrounding a legacy system with new services until it can be retired |
| TPP | Third-party provider — a fintech consuming the Open Banking API under customer consent |

---

# 2. Requirements

Identifiers are stable. Once a revision is published an identifier is never reused or
renumbered; new requirements are inserted in the gaps (FR-045 between FR-040 and FR-050).
Every requirement is testable and uses *shall*.

## 2.1 Functional Requirements

### 2.1.1 Accounts and reporting

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-010 | The system shall display a customer's account information and current balance. | Must |
| FR-020 | The system shall display a monthly income and expenses report per account. | Must |
| FR-030 | The system shall categorise transactions to support the income and expenses report. | Must |
| FR-040 | The system shall present a 360° view of a customer's accounts, balances and transactions from a single served source. | Must |

### 2.1.2 Transfers

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-050 | The system shall transfer funds between two accounts held at NeoBank. | Must |
| FR-060 | The system shall transfer funds from a NeoBank account to an account at another bank. | Must |
| FR-070 | The system shall execute every money movement as a Core Banking System transaction. | Must |
| FR-080 | The system shall reject a duplicate submission of the same transfer request without posting it twice. | Must |
| FR-090 | The system shall show the customer the state of every transfer they have submitted, including transfers accepted but not yet posted. | Must |

### 2.1.3 Fraud

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-100 | The system shall evaluate every transfer against a real-time fraud check before the Core Banking System transaction is submitted. | Must |
| FR-110 | The system shall run an offline fraud process using more data and more processing time than the real-time check permits. | Must |
| FR-120 | **Cancellation before posting (primary).** On a real-time fraud decision to block, the system shall cancel the transfer by rejecting it **before any Core Banking System transaction is submitted**, so that no posting occurs and no reversal is required. | Must |
| FR-125 | **Cancellation after posting (exception).** Where the offline fraud process detects fraud in a transaction that has already posted, the system shall cancel it by posting a **compensating** Core Banking System transaction referencing the original. The original posting shall not be altered. | Must |
| FR-130 | The system shall inform the customer in the application whenever a transfer of theirs is cancelled for fraud, in **both** the pre-posting (FR-120) and post-posting (FR-125) cases. | Must |
| FR-140 | The system shall record every fraud verdict, its inputs and its outcome, for audit and for model retraining. | Must |

### 2.1.4 Open Banking

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-150 | The system shall expose an Open Banking API over REST to registered third-party providers. | Must |
| FR-160 | The system shall serve a third-party request only against an explicit, unexpired customer consent. | Must |
| FR-170 | The system shall allow a customer to view and revoke every consent they have granted. | Must |
| FR-180 | The system shall apply a per-third-party rate limit and quota. | Must |

### 2.1.5 AI advisor

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-190 | The system shall provide an AI agent that advises the customer financially — reducing expenses, saving, investing — from that customer's own data. | Should |
| FR-200 | The AI advisor shall run only in the cloud environment. | Must |
| FR-210 | The AI advisor shall operate only on data for which the customer has given advisory consent, and shall not be given raw personally identifiable information. | Must |

### 2.1.6 Identity, privacy and operations

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-220 | The system shall authenticate customers before granting access to account data or transfer functions. | Must |
| FR-230 | The system shall require step-up authentication for transfers above a configurable threshold. | Must |
| FR-240 | The system shall erase, on request, all personal data of a customer from every store it controls, retaining only what financial-records law requires and only in pseudonymous form. | Must |
| FR-250 | The system shall emit technical and business monitoring metrics. | Must |
| FR-260 | The system shall record the count of Core Banking System operations it consumes, per service and per month. | Must |

## 2.2 Non-Functional Requirements

### 2.2.1 Availability and Recovery

**The requirement is 99.999% uptime.** The brief does not define the service-level indicator —
what is being measured as "up" — and the choice of indicator changes the answer materially. This
section states the target, sets out the four things that could reasonably be measured against
it, and says which of them the design commits to and which it does not. The boundary itself is
not ours to settle unilaterally; it is recorded as [OI-13](#8-open-issues).

**Four candidate indicators.** They differ only in what they depend on.

| Indicator | What it measures | Depends on | Figure |
|-----------|------------------|------------|--------|
| SLI-1 | Digital channel and API — the gateway authenticates and routes | Cloud edge | 99.999% |
| SLI-2 | Read service — balance, transactions, reports, Open Banking answered | Cloud edge, read model, cache | 99.999% |
| SLI-3 | Transfer-request acceptance — request durably recorded, replicated and acknowledged **as pending** | Cloud edge, private link, on-premises orchestrator | 99.999% |
| SLI-4 | **CBS-backed completion** — money posted to the ledger | All of the above **plus the Core Banking System** | **99.998%** |

**What the design commits to.** SLI-1 to SLI-3, at 99.999% (NFR-010). Together these are the
NeoBank Digital Platform — the system this document designs. None of them touches the Core
Banking System on the request path, which is why the figure is achievable: multi-AZ cloud
services, redundant on-premises hosts, and cross-site synchronous replication of transfer state.

**What the design does not claim.** If the intended indicator is SLI-4 — completed money
movement, end to end — then **the composed figure is 99.998%, which is below the stated
99.999%.** The design says so rather than obscuring it. No platform-side engineering can raise
it while every money movement must be a CBS transaction (C-01, P1); closing that gap is a
mainframe investment decision, not an architectural one.

**On the arithmetic.** The brief gives the Core Banking System as 99.999% reliable. Composing it
in series with a 99.999% platform gives 0.99999 × 0.99999 = 0.99998 — about 10.5 minutes a year
against 5.3 for either component alone. Two caveats belong with that number. It assumes the two
failure domains are **independent**, and they are not entirely: they share a data centre, a
network and an operations team, so a correlated event can take both down at once, and the true
figure can only be established by measuring it. And a multiplication of two vendor-quoted
availability figures is a **design estimate, not a contractual guarantee** — it is used here to
size expectations and to show which dependency dominates, not to assert a service level.

**Pending is never complete.** During any window in which the core is unavailable, a transfer is
accepted, durably recorded, replicated and acknowledged **as pending**. It has not moved money.
It changes no balance, it appears in no statement, and the application shows it as pending until
it posts. Store-and-forward defers CBS execution; it does not substitute for it, and no design
in this document treats an accepted transfer as a completed financial transaction. See
[D9](decisions.md#d9--meeting-99999-with-a-core-dependent-write-path).

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-010 | **Digital platform availability** — SLI-1, SLI-2 and SLI-3 together | **99.999%** — 5.3 min/year |
| NFR-011 | Read service availability (SLI-2) | 99.999% — no core dependency |
| NFR-012 | Transfer-request acceptance and durable acknowledgement (SLI-3) | 99.999% — no core dependency at acceptance; RPO = 0 |
| NFR-020 | **CBS-backed transfer completion** (SLI-4) | 99.998% — composed against the core's stated 99.999%, under an independence assumption (≈ 10.5 min/year) |
| NFR-021 | Transfer completion integrity | 100% of accepted transfers shall ultimately post as a CBS transaction or be explicitly rejected; none shall be lost, and none shall be reported complete before it posts |
| NFR-025 | Availability reporting | Each indicator shall be measured and reported separately. No blended platform figure shall be published |
| NFR-030 | Behaviour during core degradation or outage | Accepted transfers remain durably queued as `ACCEPTED (pending)`, are shown to the customer as pending, and drain automatically on recovery. No compensating action is required because nothing was posted |
| NFR-040 | Data loss on the ledger and on accepted transfers | RPO = 0 |
| NFR-050 | Data loss on derived read models | RPO ≤ 5 min; fully rebuildable from the event log |
| NFR-060 | Recovery time, read service, on loss of one cloud availability zone | RTO ≤ 5 min, automatic |
| NFR-070 | Recovery time, full site failover to the disaster recovery environment | RTO ≤ 60 min, declared manually |
| NFR-080 | Staleness of account information for incoming transfers from other banks and for payments not made through the app | ≤ 24 h |
| NFR-090 | Staleness of account information following a customer's own action in the app | ≤ 2 s |

### 2.2.2 Performance and Capacity

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-100 | Digital users, year 1 | 100,000 |
| NFR-110 | Digital users, year 3 | 1,000,000, all in one geographic region |
| NFR-120 | Concurrent users at peak, year 3 | 30,000 |
| NFR-130 | Balance and account read latency | p95 ≤ 100 ms, p99 ≤ 200 ms, at the API gateway |
| NFR-140 | Transfer submission latency, including the real-time fraud check | p95 ≤ 800 ms, p99 ≤ 1,500 ms |
| NFR-150 | Real-time fraud verdict latency | p99 ≤ 80 ms, hard timeout at 100 ms |
| NFR-160 | Sustained read throughput, year 3 | 1,100 requests/s at peak |
| NFR-170 | Sustained transfer throughput, year 3 | 80 transfers/s at peak |
| NFR-180 | Change data capture lag, DB2 to read model | p95 ≤ 5 s, p99 ≤ 30 s |
| NFR-190 | Horizontal scalability | The read tier shall scale out without redeployment or schema change |
| NFR-200 | Core Banking System operations consumed by digital channels | ≤ 1.2 × the count of customer-initiated money movements |

NFR-200 is the cost requirement expressed as an engineering constraint. It forbids, by
construction, any design in which a customer opening the app causes a mainframe operation.

### 2.2.3 Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-210 | Customer authentication | OpenID Connect with multi-factor authentication; device binding |
| NFR-220 | Service-to-service authentication | Mutual TLS with short-lived workload identities |
| NFR-230 | Third-party provider authentication | OAuth 2.0 with a financial-grade API profile and certificate-bound tokens |
| NFR-240 | Data in transit | TLS 1.3 externally; mutual TLS internally, including the cloud-to-on-premises link |
| NFR-250 | Data at rest | AES-256 everywhere, with a per-customer data encryption key for personal data |
| NFR-260 | Personal data residency | All personal data shall remain within the bank's regulatory region |
| NFR-270 | Erasure | Erasure shall take effect across every derived store, cache, backup and analytics copy |
| NFR-280 | Legacy segregation | The Core Banking System shall be reachable from exactly one component, in one network zone, under quota |
| NFR-290 | Overload protection | Rate limiting and quota enforcement at every ingress, per identity and per third party |
| NFR-300 | Audit | Every money movement, consent change, fraud verdict and erasure shall be recorded immutably |
| NFR-310 | Personal data in telemetry | Logs, traces, metrics and event payloads shall contain no raw personal data |

### 2.2.4 Backward Compatibility

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-320 | Event schema evolution | Backward-compatible only; a consumer written for version *n* shall read version *n+1* |
| NFR-330 | API evolution | Major version in the URI path; minor additive changes shall not require a client change |
| NFR-340 | Version support window | Every API major version shall be supported for 12 months after its successor is published |
| NFR-350 | Database schema change | Expand-and-contract; no release shall require simultaneous code and schema cut-over |
| NFR-360 | Mobile clients | The platform shall support the two most recent app major versions concurrently |

### 2.2.5 Upgradability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-370 | Deployment of a cloud or on-premises service | Rolling, zero downtime, no request loss |
| NFR-380 | Deployment frequency | Any service shall be deployable at least daily, independently of every other |
| NFR-390 | Rollback | Any release shall be revertible within 15 minutes without data migration |
| NFR-400 | Anti-corruption layer deployment | Blue/green, because it is the only path to the ledger |
| NFR-410 | Time from merge to production | ≤ 1 working day for a non-ledger service |
| NFR-415 | **Time to launch a new digital application or service** | **≤ 6 weeks** from approved requirement to production, using the paved-road pipeline, shared identity, shared observability and the existing read model, with no new infrastructure provisioning |

### 2.2.6 Monitoring and Debugging

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-420 | Technical metrics | Rate, errors and duration per service; utilisation, saturation and errors per node; consumer and CDC lag |
| NFR-430 | Business metrics | Transfers per minute, transfer success rate, fraud block rate, fraud false-positive rate, active users, advisor engagement, Open Banking calls per third party |
| NFR-440 | Cost metrics | Core Banking System operations per month shall be a first-class monitored series with an alert threshold |
| NFR-450 | Distributed tracing | One trace shall span client, cloud, the private link and the on-premises core call |
| NFR-460 | Log retention | 90 days searchable; 7 years archived for audit records |
| NFR-470 | Alerting | Alerts shall fire on error-budget burn rate, not on isolated instance failures |

### 2.2.7 Deployment

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-480 | Cloud environment | One provider, one region inside the regulatory boundary, three availability zones |
| NFR-490 | On-premises environment | Two data centres: production and disaster recovery |
| NFR-500 | Runtime | Containers on a managed orchestrator; the same images and manifests on-premises and in cloud |
| NFR-510 | Placement of regulated services | Services handling ledger-adjacent data or the core connection shall run on-premises only |
| NFR-520 | Placement of the AI advisor | Cloud only |
| NFR-530 | Infrastructure provisioning | Declarative and version-controlled; no manual change in any environment |
| NFR-540 | Environments | Development, test, pre-production and production, with pre-production topologically identical to production |

---

# 3. High Level Design

## 3.1 High Level System Diagram

The platform is built as four zones with strictly controlled traffic between them.

| Zone | Contains | Why here |
|------|----------|----------|
| **Cloud — public edge** | CDN, WAF, API gateway, load balancer | Elastic, internet-facing, absorbs volume and attack traffic before it reaches anything stateful |
| **Cloud — private services** | Mobile/web BFF, Account & Balance API, Reporting, Open Banking API, Notification, AI Advisor, offline fraud analytics, observability | Read-heavy, spiky, benefits from elasticity; none of it is on the money path |
| **On-premises — regulated services** | Anti-corruption layer, Transfer Orchestrator, real-time Fraud Scoring, Consent & Identity master, Customer PII Vault, CDC producers, event backbone | Ledger-adjacent, latency-critical next to the core, or legally required to stay in the bank's own data centre |
| **On-premises — core** | COBOL CBS on z/OS, DB2, ADABAS | Unchanged. Reachable from exactly one component |

Three diagrams carry the structure. The [C4 Context diagram](diagrams.md#1-c4-context) shows who
uses the platform and what it depends on, and the [C4 Container
diagram](diagrams.md#3-c4-container) shows the components above and every flow between them, and
the [target platform vision](diagrams.md#2-target-platform-vision) gives the layered production
and disaster-recovery view.
The [deployment and network topology](diagrams.md#5-deployment-and-network-topology) shows how
the same components are placed across availability zones, data centres and the disaster
recovery site.

### 3.1.1 The shape of the design in one paragraph

A customer's request enters through the cloud API gateway. If it is a **read** — balance,
transactions, report, 360° view — it is answered entirely inside the cloud from a read model
and its cache, and the mainframe is never touched. If it is a **write** — a transfer — it
crosses the private link to the on-premises Transfer Orchestrator, which scores it for fraud in
line, submits it to the anti-corruption layer as a single Core Banking System transaction, and
writes the confirmed result straight back into the read model so the customer sees their own
action immediately. Independently and continuously, change data capture on DB2 and ADABAS
publishes every committed change to an event backbone; consumers project those events into the
read model, the analytics lake and the offline fraud pipeline. The read model is therefore
never authoritative and always rebuildable, and the ledger is never bypassed.

### 3.1.2 Component responsibilities

| Component | Responsibility | Placement |
|-----------|----------------|-----------|
| API Gateway | TLS termination, authentication, rate limiting, routing, request quotas | Cloud |
| Mobile / Web BFF | Channel-shaped aggregation; one round trip per screen | Cloud |
| Account & Balance API | Serves FR-010, FR-040 from the read model and cache | Cloud |
| Reporting Service | Serves FR-020, FR-030; monthly aggregates precomputed nightly | Cloud |
| Open Banking API | Serves FR-150–FR-180; separate ingress, separate read replicas | Cloud |
| Notification Service | Push and in-app messaging, including fraud cancellation notices (FR-130) | Cloud |
| AI Advisor | Retrieval-augmented advice over the customer's own spend digest (FR-190–FR-210) | Cloud only |
| Offline Fraud Pipeline | Stream and batch scoring over the full history (FR-110) | Cloud |
| Transfer Orchestrator | Owns the transfer SAGA: validate, score, submit, confirm, compensate | On-premises |
| Real-time Fraud Scorer | Sub-80 ms verdict on the money path (FR-100, NFR-150) | On-premises |
| Anti-corruption layer | The only component that speaks to the CBS; translates domain commands to CBS transactions | On-premises |
| Consent & Identity | Customer authentication, consents, TPP registration | On-premises |
| Customer PII Vault | The only store of raw personal data; issues customer tokens; holds per-customer DEKs | On-premises |
| CDC Producers | Log-based capture from DB2 and SQL Server; event replication from ADABAS | On-premises |
| Event Backbone | Ordered, replayable log; on-premises cluster mirrored to cloud | Both |
| Read Model | Query-optimised projection of accounts, balances, transactions and categorised spend | Cloud |

## 3.2 Design Rules and Principles

These nine rules are load-bearing. Every subsequent section is an application of them, and any
proposed change that breaks one is a change to the architecture, not to an implementation.

**P1 — The ledger is the only truth.** Every money movement is a Core Banking System
transaction. No other component computes, stores or adjusts an authoritative balance.
*(FR-070, C-01. See [D3](decisions.md#d3--mainframe-integration-strategy).)*

**P2 — Never read money from the core.** Customer reads are served from derived read models.
The core is a write-path resource, not a query service. This is what makes NFR-130 and NFR-200
simultaneously achievable.
*(NFR-130, NFR-200. See [D5](decisions.md#d5--serving-fast-low-cost-reads).)*

**P3 — Talk to the core only through the anti-corruption layer.** No service anywhere knows
COBOL, DB2, ADABAS, CICS or MQ. The ACL publishes a domain contract and absorbs every legacy
detail behind it. Segregation and cost control both depend on this being absolute.
*(NFR-280, C-03. See [D3](decisions.md#d3--mainframe-integration-strategy).)*

**P4 — Corrections are new transactions.** A posted entry is immutable. Fraud reversal,
operational error and dispute resolution all produce a compensating transaction with a
reference to the original.
*(FR-125, NFR-300. See [D7](decisions.md#d7--fraud-detection-architecture).)*

**P5 — Personal data lives in one vault and travels as a token.** No ledger entry, read model
row, event payload, log line, metric or model prompt contains raw PII. Everything carries an
opaque `customer_token`.
*(NFR-250, NFR-310, FR-210, FR-240. See [D10](decisions.md#d10--gdpr-erasure-against-a-legally-immutable-ledger).)*

**P6 — Every boundary is a versioned contract.** APIs and event schemas evolve
backward-compatibly and are registered. A producer may not break a consumer.
*(NFR-320–NFR-340.)*

**P7 — Every core-facing call is idempotent, bounded and metered.** One idempotency key per
business operation; a bulkhead and quota per calling channel; a counter on every call feeding
the cost dashboard.
*(FR-080, NFR-200, NFR-440.)*

**P8 — Availability is measured on what it actually depends on.** The platform is engineered to
99.999% because nothing on the request path needs the core. Completion additionally needs the
core, composes to 99.998%, and is reported separately rather than blended in. A queued transfer
is shown as pending, never as complete.
*(NFR-010–NFR-030, FR-090. See [D9](decisions.md#d9--meeting-99999-with-a-core-dependent-write-path).)*

**P9 — Placement is a compliance decision, not a preference.** A service runs on-premises
because regulation, data sensitivity or latency-to-core requires it; otherwise it runs in the
cloud, where it can scale. No component is placed by habit.
*(NFR-510, NFR-520, C-03, C-04.)*

## 3.3 High Level System Flows

Six flows carry the functional requirements. Each is drawn as a sequence diagram in
[Diagrams §6](diagrams.md#6-flow-diagrams); this section states the contract, the failure
behaviour and the requirement each satisfies.

### 3.3.1 View account information and balance — FR-010, FR-040, NFR-130

Client → API Gateway → BFF → Account & Balance API → cache; on miss, read replica.

The mainframe is not involved. The cache holds the current balance and the most recent 50
transactions per account, written by the read-model projector on every change and by the
Transfer Orchestrator's write-through on the customer's own transfers. Target hit ratio 85%,
giving p95 ≈ 55 ms end to end (§3.8.3).

On a cache miss the read replica answers in ~12 ms. On a read-model outage the API returns
`503` with a `Retry-After` rather than falling back to the core: a fallback path to the
mainframe would be a per-operation cost bomb precisely when the platform is unhealthy, and it
would violate P2 and NFR-200.

### 3.3.2 Transfer with real-time fraud check — FR-050–FR-080, FR-100, FR-120, NFR-140

1. Client submits a transfer with a client-generated `Idempotency-Key`.
2. API Gateway authenticates; step-up authentication is demanded above the configured threshold (FR-230).
3. The request crosses the private link to the on-premises Transfer Orchestrator.
4. The Orchestrator records the transfer as `ACCEPTED` in its own durable store — before any scoring or posting. This is what makes NFR-012 and FR-090 achievable independently of the core.
5. The Real-time Fraud Scorer is called with a hard 100 ms timeout (NFR-150). Features are pre-computed and held in cache; the scorer never queries a database on the money path.
6. On `BLOCK`, the transfer moves to `REJECTED_FRAUD`, nothing is posted, and the customer is informed (FR-130).
7. On `ALLOW`, the Orchestrator calls the ACL, which executes exactly one CBS transaction carrying the idempotency key.
8. On commit, the Orchestrator moves the transfer to `POSTED`, writes the authoritative post-state into the read cache, and publishes `transfer.completed.v1`.
9. The client receives the posted balance in the response. The CDC event for the same posting arrives seconds later and is applied idempotently by CBS sequence number — it confirms rather than duplicates.

**Failure behaviour.** If the fraud scorer times out, policy applies: transfers under the
low-risk ceiling proceed and are flagged for mandatory offline review; transfers above it are
held. If the ACL call times out with an indeterminate result, the Orchestrator does not retry
blindly — it queries the CBS by idempotency key to establish the true outcome, then converges.
If the core is unavailable, accepted transfers stay durably queued in `ACCEPTED` and the app
shows them as pending, never as complete (FR-090, NFR-030).

The transfer lifecycle is drawn as a state machine in [Diagrams §7](diagrams.md#7-transfer-state-machine).

### 3.3.3 Offline fraud detection and cancellation after posting — FR-110, FR-125, FR-130

The offline pipeline consumes the posted-transaction stream in the cloud and scores it against
the full customer history, cross-account patterns and models too expensive to run inline. It
produces verdicts minutes to hours after posting.

A `CONFIRMED_FRAUD` verdict raises a case. On approval — automatic under a value threshold,
analyst-approved above it — the Transfer Orchestrator issues a **compensating** CBS transaction
referencing the original (P4). The original entry is never altered; the ledger shows both
postings, as audit requires. The customer is notified in the app (FR-130) with both
the original and the reversal visible.

### 3.3.4 Open Banking request — FR-150–FR-180

A TPP authenticates with OAuth 2.0 client credentials and a certificate-bound token, presents a
consent reference, and is served from the read model through a dedicated ingress and dedicated
read replicas. Consent is validated against the on-premises Consent service on every request
(short-TTL cached). Per-TPP quotas are enforced at the gateway. TPP traffic cannot touch the
core and cannot exhaust the capacity serving the bank's own customers — the replica separation
is a bulkhead, not an optimisation.

### 3.3.5 AI advisor consultation — FR-190–FR-210

The advisor runs cloud-only (FR-200). It does not receive raw transactions or raw PII. A nightly
job builds a per-customer **spend digest** — categorised totals, trends, recurring commitments,
savings capacity — keyed by `customer_token`. A consultation retrieves that digest, plus the
current month's categorised spend, and passes it to the model as context. Advisory consent is
checked before any retrieval (FR-210); the digest is deleted when consent is withdrawn or
erasure is requested. Customer data is not used to train models.

The digest is also the cost control: it replaces thousands of raw transaction rows in the
prompt with a few hundred tokens of summary (§3.9.4).

### 3.3.6 GDPR erasure — FR-240, NFR-270

Erasure cannot mean deleting ledger rows: financial records carry a statutory retention period.
The design separates the two obligations. On an erasure request the platform deletes the vault
record and **destroys the customer's data encryption key**. Every derived copy — read model,
cache, event log, analytics lake, backups, the advisor's digest — is encrypted under that key
and becomes permanently unreadable. Compacted event-log topics receive a tombstone. The ledger
retains its legally required financial record, now bearing only a `customer_token` that resolves
to nothing.

This satisfies erasure while preserving the audit trail. It requires legal sign-off; see
[Open Issue OI-02](#8-open-issues) and [D10](decisions.md#d10--gdpr-erasure-against-a-legally-immutable-ledger).

## 3.4 Message Schemas

Contracts between components are part of the architecture, not an implementation detail. All
events carry a common envelope, are published to the event backbone, are registered in a schema
registry under `BACKWARD` compatibility (NFR-320), and identify the customer only by token (P5).

### 3.4.1 Common event envelope

```json
{
  "event_id": "b2f4c1e0-...",
  "event_type": "transaction.posted",
  "event_version": 1,
  "occurred_at": "2026-08-28T09:14:22.481Z",
  "producer": "acl-core-bridge",
  "partition_key": "acct_9f2c...",
  "correlation_id": "trace-7d1a...",
  "payload": { }
}
```

`partition_key` is the account identifier, which guarantees per-account ordering across the log
— the property the read-model projector depends on for correctness.

### 3.4.2 Transfer command — client to Transfer Orchestrator

`POST /v1/transfers`

| Field | Type | Notes |
|-------|------|-------|
| `Idempotency-Key` | header, UUID | Client-generated; required. Deduplicates for 24 h (FR-080) |
| `source_account` | string | Account reference the caller is authorised for |
| `destination` | object | `{ scheme: "internal" \| "external", account, bank_id? }` |
| `amount` | object | `{ value: integer minor units, currency: ISO 4217 }` — never floating point |
| `reference` | string | Free-text, ≤ 140 chars, sanitised |
| `initiated_at` | ISO 8601 | Client clock, advisory only |

Response `202 Accepted` carries `transfer_id`, `status`, and `estimated_completion`. Status is
one of `ACCEPTED`, `SCORING`, `POSTED`, `REJECTED_FRAUD`, `REJECTED_FUNDS`, `REVERSED`, `FAILED`.

### 3.4.3 Core transaction request — ACL to CBS

The ACL's whole purpose is that this is the only place the legacy shape appears.

| Field | Type | Notes |
|-------|------|-------|
| `idempotency_key` | UUID | Carried into the CBS transaction; the basis for outcome recovery |
| `debit_account` / `credit_account` | string | Internal CBS account keys |
| `amount_minor` | integer | Minor units |
| `currency` | string | ISO 4217 |
| `value_date` | date | |
| `channel` | enum | `DIGITAL` — enables per-channel cost attribution (FR-260) |
| `original_transaction_ref` | string, optional | Present only on a compensating transaction (P4) |

Response returns `cbs_transaction_id`, `sequence_number`, `posted_at`, `resulting_balance`, or a
typed failure (`INSUFFICIENT_FUNDS`, `ACCOUNT_BLOCKED`, `CORE_UNAVAILABLE`, `INDETERMINATE`).
`INDETERMINATE` is a first-class outcome and triggers the reconciliation query in §3.3.2.

### 3.4.4 Domain events

| Event | Produced by | Consumed by | Payload summary |
|-------|-------------|-------------|-----------------|
| `transaction.posted.v1` | CDC on DB2 | Read-model projector, offline fraud, analytics | `account_token`, `cbs_transaction_id`, `sequence_number`, `amount_minor`, `currency`, `counterparty_ref`, `posted_at`, `resulting_balance` |
| `transfer.completed.v1` | Transfer Orchestrator | Notification, read model, analytics | `transfer_id`, `customer_token`, `status`, `cbs_transaction_id`, `posted_at` |
| `fraud.verdict.v1` | Real-time scorer, offline pipeline | Orchestrator, case management, audit | `transfer_id`, `mode` (`REALTIME`/`OFFLINE`), `decision`, `score`, `reason_codes[]`, `model_version` |
| `customer.changed.v1` | CDC on ADABAS | Read model, PII vault sync | `customer_token`, `changed_attributes[]`, `effective_at` |
| `consent.changed.v1` | Consent service | Open Banking API, AI advisor, read model | `consent_id`, `customer_token`, `tpp_id`, `scopes[]`, `status`, `expires_at` |
| `erasure.requested.v1` | Consent & Identity | Every store owner | `customer_token`, `requested_at`, `legal_hold` flag |

`reason_codes[]` on the fraud verdict earns its place: a customer whose transfer is blocked is
entitled to an explanation, and a regulator is entitled to an audit trail of why.

### 3.4.5 Read API contract

`GET /v1/accounts/{id}/balance` and `GET /v1/accounts/{id}/transactions?from=&to=&cursor=`
return `as_of` and `freshness_seconds` on every response. The client renders this: a customer
looking at a number that may be up to 24 hours stale for externally originated credits (NFR-080)
must be able to see when it was last known good. Making staleness explicit in the contract is
what allows the 24-hour allowance to be used honestly rather than silently.

## 3.5 Data Architecture

Drawn in [Diagrams §4](diagrams.md#4-data-architecture).

### 3.5.1 Systems of record and derived stores

The single most important statement in this section is which stores are authoritative and which
are not.

| Store | Role | Authoritative for | Rebuildable |
|-------|------|-------------------|-------------|
| DB2 (mainframe) | System of record | Every posted transaction and balance | No — this is the ledger |
| ADABAS (mainframe) | System of record | Customer master attributes | No |
| SQL Server (distributed) | System of record | Its own domain — not specified by the brief (A-18, OI-10) | No |
| Transfer Orchestrator store (on-prem) | System of record | In-flight transfer state before posting | No — protected by RPO 0 |
| Customer PII Vault (on-prem) | System of record | Raw personal data and per-customer keys | No |
| Event backbone (Kafka) | Durable event log | The ordered history of changes | No, but replicated ×3 |
| Read model (Aurora PostgreSQL) | Derived projection | Nothing | Yes, from the log |
| Cache (Redis) | Derived | Nothing | Yes |
| Analytics lake (S3) | Derived | Nothing | Yes |

Everything in the bottom half can be deleted and rebuilt. That property is what makes the read
path safe to optimise aggressively, and it is why the log — not the read model — is the thing
that must never be lost.

### 3.5.2 Ingestion from the source systems

The target vision identifies **three** source systems, not two: DB2 and ADABAS on the mainframe,
and a **SQL Server** estate alongside them, present in both the production and disaster recovery
sites. All three feed the same data-ingestion tier. This matches the stated technical challenge
that "data originates in multiple systems that are challenging to integrate".

| Source | Platform | Capture mechanism | Freshness | Confidence |
|--------|----------|-------------------|-----------|------------|
| DB2 | Mainframe, z/OS | Log-based change data capture from the recovery log | p95 ≤ 5 s | High — standard capability (A-02) |
| ADABAS | Mainframe, z/OS | Event replication where available; scheduled delta extract as the designed fallback | ≤ 15 min, or nightly on fallback | Medium — unconfirmed (A-03, [OI-03](#8-open-issues)) |
| SQL Server | Distributed, off-mainframe | Native transaction-log change data capture | p95 ≤ 5 s | High — standard capability (A-17) |

**DB2.** Changes are captured from the recovery log rather than by polling. Polling would consume
mainframe operations continuously and would violate NFR-200 outright; reading the log adds no
per-query cost.

**ADABAS** is the harder source. Customer master data is low-velocity — addresses and names
change rarely — and nothing on the money path depends on its freshness, so the delta-extract
fallback is acceptable. Feasibility of near-real-time capture is [OI-03](#8-open-issues), spiked
in phase 0.

**SQL Server** carries no mainframe operating cost, so its capture is unconstrained by NFR-200.
**The brief does not state what this system holds**, and the design does not invent
it — see [A-18](#42-assumptions) and [OI-10](#8-open-issues). This costs the architecture
nothing: the ingestion tier is source-agnostic by construction. Every producer publishes the same
canonical domain events over the same contract (§3.4.4), so what SQL Server turns out to own
changes which events it produces, not how ingestion, ordering, replay or projection work.

A source that proves to hold **authoritative money data** would be the one exception, since it
would join DB2 as a system of record and fall under P1; the design flags that explicitly rather
than assuming it away.

All three producers publish to the on-premises event backbone. The cloud cluster is a mirror;
cloud consumers never reach back on-premises for data.

| Property | Mechanism |
|----------|-----------|
| Ordering | Partition key = account identifier; per-account order is total |
| Idempotency | Projector upserts by `(account, sequence_number)`; replays are safe |
| Exactly-once effect | At-least-once delivery plus idempotent projection — the achievable and correct combination |
| Replay | 30-day retention; a read model can be rebuilt from zero without touching the mainframe |
| Backpressure | Consumer lag alarms at 30 s; projector scales by partition count |

### 3.5.3 Consistency model

| Data | Model | Where it comes from |
|------|-------|---------------------|
| Balances and postings inside the CBS | Strong, ACID | The core, unchanged |
| A customer's own transfer, as they see it | Read-your-writes | Synchronous write-through on the confirmed response (§3.3.2) |
| Everything else in the read model | Eventual, p95 ≤ 5 s | CDC projection (NFR-180) |
| Externally originated credits | Eventual, bounded at 24 h | Interbank settlement plus CDC (NFR-080) |
| Session reads | Monotonic | Session pinned to one read replica for its lifetime |

The read-your-writes guarantee is what makes eventual consistency acceptable to a customer. They
never see their own action fail to appear; they only ever wait for someone else's.

### 3.5.4 No data loss

| Store | Mechanism | Meets |
|-------|-----------|-------|
| CBS ledger | Unchanged mainframe guarantees | NFR-040 |
| Transfer Orchestrator store | Synchronous replication across two on-premises data centres before acknowledging `ACCEPTED` | NFR-040 |
| Event backbone | Replication factor 3, minimum in-sync replicas 2, producer `acks=all` | NFR-050 |
| Read model | Multi-AZ synchronous standby, point-in-time recovery, and rebuildable from the log | NFR-050 |
| On-premises block storage | RAID 6 — dual parity, survives two simultaneous disk failures during rebuild, which is the realistic failure mode at this array size | NFR-040 |
| Object storage | Cross-AZ durability, versioning, object lock on audit records | NFR-300 |

A nightly reconciliation compares read-model balances against DB2 control totals. A mismatch
raises an operational alert and triggers a targeted partition replay. The read model being
wrong is a detectable, recoverable condition — that is the design intent, not an afterthought.

### 3.5.5 Storage tiering

Tiering is a direct answer to "minimise storage budget", and it works because access frequency
falls sharply with age.

| Tier | Contents | Retention | Rationale |
|------|----------|-----------|-----------|
| Cache (memory) | Current balance, last 50 transactions per active account | Hours | Serves ~85% of reads at ~2 ms |
| Read model (SSD) | 90 days of transactions, accounts, consents, spend aggregates | 90 days | Covers the overwhelming majority of in-app queries |
| Object storage, standard | 13 months, columnar and compressed | 13 months | Reporting, model training, year-on-year comparison |
| Object storage, archive | To 7 years | 7 years | Statutory retention only; retrieval is rare and may be slow |

Columnar compression on the analytics copy achieves roughly 5:1, and moving anything older than
13 months to archive class cuts its storage rate by about 80%. Both are applied by lifecycle
policy, not by a job someone has to remember to run.

### 3.5.6 Sharding and growth

At year-three volume the read model handles roughly 80 write transactions per second and 150 GB
— comfortably inside a single writer instance. The design therefore does **not** shard, and
that is a choice rather than an omission: sharding now would buy operational
complexity for capacity the bank will not use for years.

What the design does do is keep the option open at zero cost. Read tables are partitioned on a
hash of `customer_token`, so a future split is a data movement rather than a rewrite. The
trigger points are recorded: sustained write throughput above 5,000 TPS, or the hot dataset
exceeding 10 TB. Year three reaches neither.

### 3.5.7 Erasure across every store

Erasure is a data-architecture problem, not a compliance checkbox, because the data has been
copied into six places by design. The mechanism (§3.3.6) is crypto-shredding:

| Store | What happens on erasure |
|-------|-------------------------|
| PII Vault | Record deleted; the customer's data encryption key is destroyed |
| Read model | PII columns unreadable; row retained under `customer_token` |
| Cache | Keys evicted immediately on the erasure event |
| Event backbone | Tombstone published to compacted topics; payloads unreadable |
| Analytics lake | Unreadable; partitions rewritten on the next compaction cycle |
| Backups | Unreadable — no backup restore or re-import can resurrect the data |
| CBS ledger | Financial record retained in pseudonymous form, as law requires |

Encrypting each customer's data under its own key is the only mechanism that reaches backups
and archives. Row-level deletion cannot, and any design that claims otherwise is claiming
something it cannot deliver.

## 3.6 Security Architecture

Drawn in [Diagrams §6](diagrams.md#5-deployment-and-network-topology).

### 3.6.1 Network topology

**Cloud.** One VPC per environment, three availability zones, three subnet tiers:

| Tier | Contents | Reachability |
|------|----------|--------------|
| Public | Application load balancer, NAT gateways | Internet inbound to the load balancer only |
| Private application | All services, on the container platform | No inbound from the internet; outbound via NAT |
| Isolated data | Read model, cache, managed Kafka | Reachable only from the application tier; no route to a NAT gateway |

Security groups are service-to-service, not subnet-wide. Cloud-provider service access uses
private endpoints, so traffic to object storage and secrets never leaves the VPC.

**The link.** Two dedicated private connections from separate on-premises data centres, on
diverse physical paths, with an encrypted VPN as third-tier backup. All traffic across the link
is mutually authenticated TLS regardless of the link being private.

**On-premises.** Three zones separated by firewalls:

| Zone | Contents |
|------|----------|
| DMZ | Link termination, reverse proxies, inbound inspection |
| Application | Transfer Orchestrator, fraud scorer, consent, event backbone |
| Core | ACL, hardware security modules, and the mainframe itself |

The core zone accepts exactly one inbound path: from the ACL, on the mainframe's message
channel, with a whitelisted source, its own credentials and its own quota. No human and no
other service reaches the mainframe from the digital platform (NFR-280).

### 3.6.2 Identity

| Principal | Mechanism |
|-----------|-----------|
| Customer | OpenID Connect; passkeys as the primary factor with device binding; step-up re-authentication for transfers above threshold (FR-230); short-lived access tokens, refresh bound to the device |
| Service | Mutual TLS with workload identities issued per service, certificates rotated automatically; no shared secrets and no long-lived service passwords |
| Third-party provider | OAuth 2.0 client credentials under a financial-grade API profile, certificate-bound tokens, plus a consent reference validated per request (FR-160) |
| Operator | Federated single sign-on with hardware multi-factor; no standing production access — access is requested, time-boxed, approved and recorded |
| Batch and pipelines | Workload identity federation; no static cloud credentials anywhere in the estate |

Authorisation is enforced twice: coarse-grained scope at the gateway, and ownership checked
again in the service that holds the data. A gateway alone is a single point of authorisation
failure.

### 3.6.3 Data protection

TLS 1.3 externally, mutual TLS internally including across the private link. AES-256 at rest
everywhere. Keys are managed in the cloud key service for cloud-side data and in on-premises
hardware security modules for the CBS channel and the per-customer data encryption keys, with
the vault as the only component that can request a customer key. Personal data is tokenised at
the boundary (P5), so a compromise of the read model, the cache, the analytics lake or the
event log yields pseudonymous data, not identities. Logs, traces and metrics are scrubbed at the
emitting library, not by a downstream filter that can be bypassed (NFR-310).

### 3.6.4 Threat model

| Threat (STRIDE) | Scenario | Control |
|-----------------|----------|---------|
| Spoofing | Stolen credentials used to move money | Passkeys with device binding; step-up authentication; behavioural signals feed the real-time fraud scorer |
| Spoofing | A rogue client impersonating a registered third party | Certificate-bound tokens; the certificate, not just the client id, is the identity |
| Tampering | Altering a transfer in flight between cloud and on-premises | Mutual TLS; the amount is re-validated on-premises against the authenticated session, never trusted from the request alone |
| Tampering | Modifying a posted ledger entry | Structurally impossible — corrections are new transactions (P4) |
| Repudiation | A customer denies initiating a transfer | Immutable audit record binding transfer, device, authentication event, fraud verdict and posting |
| Information disclosure | Read model or backups exfiltrated | Tokenised PII; per-customer keys; the data is pseudonymous without the vault |
| Information disclosure | Personal data reaching the AI advisor or a model provider | Only the tokenised spend digest leaves the boundary; consent-gated; no training on customer data |
| Denial of service | Volumetric attack on the public edge | CDN and web application firewall absorb; the edge is the only internet-facing tier |
| Denial of service | A third party exhausting shared capacity | Per-TPP quotas, dedicated ingress, dedicated read replicas — a bulkhead |
| Denial of service | Digital traffic saturating the mainframe | P2 removes reads entirely; the Orchestrator token-buckets writes toward the core |
| Elevation of privilege | Compromised cloud service reaching the ledger | The cloud has no route to the core zone; only the on-premises ACL does, under quota, with its own credentials |

### 3.6.5 Regulatory obligations

Personal data stays inside the regulatory region: one cloud region, one on-premises estate, no
cross-region replication of personal data, and model inference pinned in-region (NFR-260).
Erasure is delivered by §3.3.6 and §3.5.7. Consent is explicit, versioned, revocable and
enforced at request time (FR-160, FR-170). Audit records — money movements, consent changes,
fraud verdicts, erasures — are written to object-locked storage for seven years (NFR-300,
NFR-460).

## 3.7 Upgradability

| Concern | Approach |
|---------|----------|
| Stateless cloud and on-premises services | Rolling update, surge 25%, unavailable 0, readiness-gated, connections drained (NFR-370) |
| Anti-corruption layer | Blue/green with an explicit cut-over, because it is the only path to the ledger (NFR-400) |
| Read-model schema | Expand and contract: add and backfill, deploy code reading both shapes, then remove. No release requires simultaneous code and schema cut-over (NFR-350) |
| Event schemas | Registered, `BACKWARD` compatibility enforced at publish time. Adding an optional field is free; removing or retyping one is rejected by the registry, not discovered in production (NFR-320) |
| Public APIs | Major version in the path; additive minor changes only within a major; 12-month support window after a successor ships (NFR-330, NFR-340) |
| Mobile clients | Two most recent major versions supported concurrently; the BFF absorbs the difference so services need not (NFR-360) |
| Risky changes | Feature flags, decoupled from deployment; new fraud models run in shadow against live traffic before they gate a single transfer |
| Rollback | Previous image kept warm; revert within 15 minutes. Because schema changes are expand-and-contract, a code rollback never requires a data rollback (NFR-390) |
| Read-model rebuild | A supported operation, not an emergency: build a new projection from the log alongside the old, verify against control totals, switch reads |
| Disaster recovery | Failover exercised quarterly against production-identical pre-production; an untested recovery plan is not a recovery plan |

## 3.8 Sizing

### 3.8.1 Capacity model

Every figure below derives from the stated assumptions; changing an assumption changes the
sizing arithmetically rather than by judgement.

| Input | Year-1 MVP | Year-3 target | Source |
|-------|--------|--------|--------|
| Digital users | 100,000 | 1,000,000 | NFR-100, NFR-110 |
| Daily active ratio | 30% | 30% | A-09 |
| Daily active users | 30,000 | 300,000 | derived |
| Sessions per active user per day | 2.5 | 2.5 | A-10 |
| Reads per session | 12 | 12 | A-11 |
| Transfers per user per month | 20 | 20 | A-12 |
| Peak-to-average factor, reads | 8 | 8 | A-13 |
| Peak-to-average factor, writes | 10 | 10 | A-13 |

| Derived figure | Year-1 MVP | Year-3 target |
|----------------|--------|--------|
| Reads per day | 900,000 | 9,000,000 |
| Average read throughput | 10 req/s | 104 req/s |
| **Peak read throughput, own channels** | **83 req/s** | **832 req/s** |
| Open Banking additional load (+30%) | 25 req/s | 250 req/s |
| **Peak read throughput, total** | **≈ 110 req/s** | **≈ 1,100 req/s** |
| Transfers per month | 2,000,000 | 20,000,000 |
| Average write throughput | 0.77 tx/s | 7.7 tx/s |
| **Peak write throughput to the core** | **≈ 8 tx/s** | **≈ 80 tx/s** |
| Read : write ratio (average) | 13 : 1 | 13.5 : 1 |
| Concurrent users at peak | 3,000 | 30,000 |

Sized against NFR-160 (1,100 req/s) and NFR-170 (80 tx/s): both met.

### 3.8.2 Mainframe operations — the decisive number

| Measure | Year-1 MVP | Year-3 target |
|---------|--------|--------|
| CBS operations if reads were served from the core | 29,000,000/month | 290,000,000/month |
| CBS operations under this design | 2,000,000/month | 20,000,000/month |
| **Reduction** | **93%** | **93%** |
| Ratio to customer-initiated money movements | 1.0 | 1.0 |

NFR-200 requires ≤ 1.2. The design achieves 1.0, with headroom for compensating transactions
and reconciliation queries. §3.9 prices what this is worth.

### 3.8.3 Latency budgets

**Transfer with real-time fraud check — budget 800 ms p95 (NFR-140)**

| Hop | p95 (ms) | p99 (ms) |
|-----|---------:|---------:|
| Client → edge: TLS, web application firewall, authentication | 40 | 60 |
| Edge → BFF → Transfer API | 15 | 25 |
| Cloud → on-premises across the private link (round trip) | 12 | 20 |
| Orchestrator: validation, idempotency check, durable `ACCEPTED` write | 25 | 45 |
| Real-time fraud scoring (cached features, in-process inference) | 60 | 80 |
| ACL → CBS transaction commit | 250 | 600 |
| Confirm, write through to cache, respond | 45 | 70 |
| **Total** | **447** | **900** |
| **Budget** | **800** | **1,500** |

The mainframe commit is 56% of the budget and is not under the platform's control. That is
precisely why every other hop is kept tight and why the fraud check has a hard 100 ms timeout
(NFR-150) rather than a soft one.

**Balance read — budget 100 ms p95 (NFR-130)**

| Hop | p95 (ms) |
|-----|---------:|
| Client → edge | 35 |
| Edge → BFF | 6 |
| BFF → Account & Balance API | 4 |
| Cache hit | 2 |
| Serialise and return | 8 |
| **Total (cache hit, ~85% of reads)** | **55** |
| Total (cache miss, read replica) | 65 |
| **Budget** | **100** |

### 3.8.4 Scaling strategy

| Path | Strategy |
|------|----------|
| Read services | Scale out. Stateless containers, horizontal autoscaling on request rate and CPU, 2 → 45 nodes |
| Read model | Scale out by adding read replicas; no schema change, no redeployment (NFR-190) |
| Cache | Cluster mode, sharded by account key; capacity added by adding shards |
| Event backbone | Scale by partition count; consumer groups scale to partition count |
| Write path | **Not scaled out.** Throughput toward the core is capped by a token bucket sized to agreed mainframe capacity. Excess is queued, never dropped, and surfaced to the customer as pending |
| On-premises tier | Fixed capacity, sized for year-three peak from day one, because it cannot autoscale |

The asymmetry is the point. Scaling the read path is cheap and safe. Scaling the write path
means buying mainframe capacity, so the architecture throttles instead.

### 3.8.5 Resilience patterns

| Pattern | Applied at | Why there |
|---------|-----------|-----------|
| Retry with exponential backoff and jitter | Cache, read model, event publication | Transient failures on idempotent operations |
| **No blind retry** | ACL → CBS | A retry can double-post. On an indeterminate result the Orchestrator queries by idempotency key and converges on the truth |
| Circuit breaker | Orchestrator → ACL; BFF → every downstream | Fail fast, shed load, and stop pushing a struggling core |
| Bulkhead | Per-channel connection pools to the ACL; separate read replicas for third parties | One channel cannot starve another |
| Throttling | Gateway per identity; Orchestrator toward the core | NFR-290 and NFR-200 |
| Store and forward | Accepted transfers during a core outage | NFR-021, NFR-030 and FR-090 |
| Compensating transaction | Posted transfers later found fraudulent | P4 |
| Shadow evaluation | New fraud models | Measure false-positive rate before a model can block a customer |

### 3.8.6 Sizing units

| Resource | Year-1 MVP | Year-3 target | Notes |
|----------|--------|--------|-------|
| Cloud availability zones | 3 | 3 | NFR-480 |
| Cloud application nodes | 6 avg / 16 peak | 18 avg / 45 peak | General-purpose 2 vCPU / 8 GiB class |
| Read model | 1 writer + 1 replica, 2 vCPU / 16 GiB | 1 writer + 3 replicas, 8 vCPU / 64 GiB | Multi-AZ |
| Read model storage | 15 GB | 150 GB | 90-day hot window |
| Cache | 2 nodes, 13 GiB | 3 nodes, 26 GiB | ~16 GB working set at year 3 |
| Event backbone | 3 brokers, 2 vCPU / 8 GiB | 3 brokers, 8 vCPU / 32 GiB | 100M events/month at year 3 |
| Event backbone storage | 30 GB | 300 GB | 30-day retention, replication factor 3 |
| Object storage | 250 GB | 2.5 TB | Lifecycle-tiered |
| Private link | 2 × 1 Gbps | 2 × 1 Gbps | Diverse paths; sized for CDC plus write traffic, not for reads |
| On-premises servers | 20 | 20 | 12 production, 8 disaster recovery; sized for year 3 on day one |
| On-premises storage | 120 TB usable | 120 TB usable | RAID 6, replicated between sites |

### 3.8.7 On-premises hardware and software

The brief requires the new on-premises deployment to be defined in both hardware and software
terms. Quantities are given for the Year-1 MVP with the Year-3 target in brackets (§1.1.4);
components are specified by class and by the property that makes them necessary, not by vendor
part number.

**Hardware**

| Element | Year-1 MVP (Year-3) | Specification driver |
|---------|---------------------|----------------------|
| Application servers, production site | 8 (12) dual-socket, 32 cores, 256 GB RAM | Transfer Orchestrator, fraud scorer, consent, vault, event backbone and CDC producers, each with N+1 |
| Application servers, DR site | 4 (8), same class | Warm standby (D15); identical class so images are interchangeable |
| Block storage | 40 TB (120 TB) usable, **RAID 6** | Dual parity survives a second disk failure during rebuild — the realistic failure mode at this array size (NFR-040) |
| Storage replication | Synchronous between sites for orchestrator state; asynchronous for bulk | RPO = 0 on in-flight transfers (NFR-040) |
| Network | Redundant top-of-rack and core switching; three firewalled zones — DMZ, application, core | Zone separation is what enforces NFR-280 |
| External connectivity | 2 × 1 Gbps dedicated links on diverse physical paths, plus VPN fallback | No single path failure isolates the cloud tier |
| Hardware security modules | 2, clustered | Per-customer data encryption keys and the CBS channel credentials (D10, NFR-250) |
| Power and cooling | Dual feed, N+1 cooling, both sites | Site-level resilience |

**Software**

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Operating system | Enterprise Linux, long-term support release | Vendor support and predictable patch cadence for a regulated estate |
| Runtime platform | Managed Kubernetes distribution, **the same distribution as the cloud tier** | One set of images and manifests across both environments (NFR-500); this is what keeps the hybrid split an infrastructure cost rather than duplicated application work |
| Application runtime | JVM | Matches the available skills (C-07) |
| Event backbone | Kafka-compatible broker with commercial support | Ordered, replayable log (D8); a support contract because it sits on the critical path |
| Change data capture | Log-based CDC tooling covering DB2, ADABAS and SQL Server | Three sources, one contract (§3.5.2). ADABAS coverage is the licensing question in [OI-03](#8-open-issues) |
| Relational store | PostgreSQL-compatible, for orchestrator and consent state | Same engine family as the cloud read model — one set of operational skills |
| Key management | HSM-backed key manager | D10 |
| Identity | OpenID Connect provider with FIDO2 support | D14 |
| Observability | OpenTelemetry collection, with metrics and logs shipped to the cloud tier | One trace spans both environments (NFR-450) |
| Infrastructure automation | Declarative provisioning and configuration, version-controlled | NFR-530; no manual change in any environment |

**Why this shape.** Two principles drive every row. *Symmetry with the cloud tier* — the same
container platform, application runtime, relational engine and telemetry stack run in both
places, so a service can be placed by compliance need (P9) rather than by where its dependencies
happen to exist. *Redundancy concentrated on what cannot be re-created* — orchestrator state and
the key vault get synchronous replication and clustered hardware security modules, while anything
derived is allowed to fail and be rebuilt from the event log (§3.5.1).

## 3.9 Operational Cost Model

The brief requires an operational cost calculation and points at the
[AWS Pricing Calculator](https://calculator.aws/). This section answers that in §3.9.1–3.9.5.

§3.9.6 and §3.9.7 are a **separate** analysis of mainframe operation volume and its cost
implication. They are kept apart because they rest on very different footing: the
cloud estimate prices a design against published rates, whereas the mainframe figure depends on
a unit cost the brief does not supply.

### 3.9.1 Method, pricing basis and confidence

| | |
|---|---|
| **Method** | Bottom-up, following the AWS Pricing Calculator's own structure: each component is sized in §3.8.6 from the capacity model in §3.8.1, then priced against its cost driver — instance-hours, requests, GB stored, GB transferred, tokens |
| **Region** | Europe (Frankfurt), `eu-central-1` — single region, chosen for data residency (NFR-260, D6) |
| **Rate basis** | AWS on-demand list rates. No committed-use discount, no enterprise agreement, no free tier |
| **Priced as of** | **28 August 2026** |
| **Currency** | **USD throughout** |
| **Services priced** | EKS, EC2 (M-family general purpose), Application Load Balancer, API Gateway, Aurora PostgreSQL, ElastiCache, MSK, S3 with lifecycle tiering, Direct Connect and data transfer, CloudWatch and OpenSearch, SageMaker, Bedrock, KMS, Secrets Manager, WAF, GuardDuty |
| **Confidence** | **±30%** at line level; better at the level of which line dominates |

**Verification status — read this before using the figures.** These are **modelled estimates,
not a calculator export.** An attempt was made on the pricing date above to reconstruct the
model against published AWS rates. It partially succeeded: `m6i.large` on-demand was confirmed at
**$0.096/hour** against a public pricing reference, which corroborates the order of magnitude of
the compute lines. It did not fully succeed: AWS publishes regional rates through
JavaScript-rendered pages and a bulk price-list API that could not be retrieved in full, so
**`eu-central-1`-specific rates for every service were not independently confirmed.** Frankfurt
typically carries a premium over US regions, which the model reflects but which remains
unverified line by line.

[OI-12](#8-open-issues) therefore stays open, with a specific action: rebuild this model inside
the AWS Pricing Calculator, export the estimate, and attach it. Nothing below should reach a
budget submission until that is done.

What survives re-pricing is the **structure**. Rates change; which components exist, what drives
each one's cost, and which line dominates do not. Every figure can be recomputed from §3.8.6 and
a current rate card without touching the architecture.

### 3.9.2 Cloud infrastructure — monthly

| Line | Cost driver | Year-1 MVP | Year-3 target |
|------|-------------|-----------:|--------------:|
| Container platform control planes | Fixed, production + DR | $146 | $146 |
| Application compute | Instance-hours; 6 → 18 nodes average | $470 | $1,400 |
| API gateway and load balancing | Requests; 30M → 290M per month | $160 | $1,150 |
| Read model instances | Instance-hours; 2 → 4 nodes | $424 | $3,388 |
| Read model storage, I/O and backup | GB; 15 → 150 GB | $40 | $260 |
| Cache | Instance-hours; 2 → 3 nodes | $330 | $990 |
| Event backbone | Instance-hours + GB; 3 brokers scaled | $525 | $2,200 |
| Object storage | GB, lifecycle-tiered; 250 GB → 2.5 TB | $15 | $75 |
| Private link and data transfer | Port-hours + GB egress | $480 | $780 |
| Observability | Ingest volume | $380 | $1,450 |
| Offline fraud: training and batch inference | Instance-hours | $520 | $1,750 |
| Security services | Keys, secrets, firewall, threat detection | $280 | $700 |
| Disaster recovery environment | Warm standby, ~30% of production | $1,150 | $4,300 |
| **Cloud infrastructure subtotal** | | **$4,920** | **$18,589** |
| AI advisor inference | Tokens — see §3.9.4 | $996 | $9,960 |
| **Cloud total** | | **≈ $5,920** | **≈ $28,550** |

The advisor is listed separately because it is priced per token rather than per resource-hour,
and because at Year-3 volume it is **35% of the entire cloud bill** — the single largest line,
and the most sensitive to an assumption (A-16).

### 3.9.3 On-premises infrastructure — monthly

Capital items amortised straight-line over three years. The estate is sized for the Year-1 MVP
with defined headroom, and incremented in Year 2 — **not** provisioned for Year-3 peak on day
one (§1.1.4).

| Line | Year-1 MVP | Year-3 target |
|------|-----------:|--------------:|
| Servers — 12 → 20 dual-socket ($168K → $280K capex) | $4,667 | $7,778 |
| Storage array — 40 → 120 TB usable, RAID 6, both sites ($70K → $180K capex) | $1,944 | $5,000 |
| Network, firewalls, load balancers, 2 hardware security modules ($120K capex) | $3,333 | $3,333 |
| Data centre space, power and cooling, two sites | $2,400 | $3,200 |
| Software — operating system, container platform, event backbone support, CDC tooling for three sources | $5,200 | $6,500 |
| **On-premises total** | **≈ $17,540** | **≈ $25,810** |

On-premises cost is the **largest single line in Year 1** and it does not fall when usage is low
— capacity must be bought before it is needed, and it cannot autoscale. That asymmetry against
the cloud bill, which tracks users almost linearly, is the clearest financial argument for
keeping the on-premises footprint to genuinely regulated workloads and nothing more (P9, D12).

### 3.9.4 AI advisor inference

| Input | Year-1 MVP | Year-3 target |
|-------|-----------:|--------------:|
| Users consulting the advisor in a month (10% — A-16) | 10,000 | 100,000 |
| Sessions per user per month | 2 | 2 |
| Turns per session | 4 | 4 |
| Input tokens per turn (1,400 stable prefix + 600 volatile) | 2,000 | 2,000 |
| Output tokens per turn | 350 | 350 |
| Billable input per turn, with prompt caching on the prefix | 740 | 740 |
| **Monthly input tokens** | 59.2M | 592M |
| **Monthly output tokens** | 28M | 280M |
| **Modelled cost at $5 / $25 per million tokens** | **$996** | **$9,960** |

The rate used is the published first-party reference rate for a frontier-class model as of
mid-2026. Inference will in practice be bought through a managed cloud marketplace, which
publishes its own separate rate card; that must replace this figure before budget sign-off
([OI-06](#8-open-issues)).

Three design choices hold this line down, and each was an architectural decision rather than a
tuning exercise:

- **The pre-computed spend digest (§3.3.5)** replaces thousands of raw transaction rows with a
  few hundred tokens of summary. Without it, input tokens rise roughly fivefold — an estimated
  $12,000/month more at Year-3 volume. The digest exists for cost as much as for quality.
- **Prompt caching on the stable prefix** — the instructions and digest are identical across a
  session's turns. Caching cuts billable input by about 63%, an estimated $5,000/month at Year 3.
- **Batching the proactive monthly advice push** takes roughly half off that portion.

Routing routine turns to a smaller model tier and reserving the frontier model for complex
planning would reduce this line substantially; that trades cost against advice quality and is a
business decision ([OI-06](#8-open-issues)).

### 3.9.5 Total platform operating cost

This is the answer to "minimise storage and processing budget, present your calculation".

| | Year-1 MVP | Year-3 target |
|---|-----------:|--------------:|
| Cloud infrastructure | $4,920 | $18,589 |
| AI advisor inference | $996 | $9,960 |
| On-premises infrastructure (amortised) | $17,540 | $25,810 |
| **Total per month** | **≈ $23,460** | **≈ $54,360** |
| **Total per year** | **≈ $281,500** | **≈ $652,300** |
| Cost per digital user per year | ≈ $2.82 | ≈ $0.65 |

Cost per user falls by 77% between the stages, which is the operating leverage the architecture
exists to produce: the on-premises component is broadly fixed, the cloud component scales
with users, and the expensive per-operation component stays off the read path entirely.

Mainframe charges are **excluded** from this table and treated separately in §3.9.6–3.9.7,
because their unit cost is assumed rather than known.

### 3.9.6 Mainframe operation volume — an architectural result

The **operation counts** below follow from the design and the capacity model. They do not depend
on any price and are not an estimate in the way §3.9.2 is.

| Measure | Year-1 MVP | Year-3 target |
|---------|-----------:|--------------:|
| CBS operations per month, this design | 2,000,000 | 20,000,000 |
| CBS operations per month, had reads been served from the core | 29,000,000 | 290,000,000 |
| **Reduction in mainframe operations** | **93%** | **93%** |
| Ratio to customer-initiated money movements | 1.0 | 1.0 |

NFR-200 requires ≤ 1.2. The design achieves 1.0, with headroom for compensating transactions and
reconciliation queries. **This is the compliance result, and it stands whatever an operation
turns out to cost.**

### 3.9.7 Illustrative cost impact of that reduction

> **This subsection is speculative and is not part of the required cost calculation.** The brief
> states only that mainframe operations are charged individually and run to "millions of dollars
> annually". It supplies **no unit rate**. Everything below rests on an assumed
> **$0.001 per operation** (A-14), which nobody has confirmed. The figures are illustrative
> estimates for comparing design options, **not** a saving NeoBank can bank.

| Measure | Year-1 MVP | Year-3 target |
|---------|-----------:|--------------:|
| Modelled cost, this design | $2,000/month | $20,000/month |
| Modelled cost, reads served from the core | $29,000/month | $290,000/month |
| **Illustrative estimated difference** | **$27,000/month** | **$270,000/month** |
| | ≈ $324,000/year | ≈ $3.24M/year |

**Sensitivity.** The conclusion does not depend on the assumed rate being right:

| Assumed $/operation | Year-3, this design | Year-3, served from the core | Illustrative annual difference |
|--------------------:|--------------------:|-----------------------------:|-------------------------------:|
| $0.0005 | $10,000/month | $145,000/month | ≈ $1.6M |
| **$0.001** (modelled) | **$20,000/month** | **$290,000/month** | **≈ $3.2M** |
| $0.005 | $100,000/month | $1,450,000/month | ≈ $16.2M |

At every point across a tenfold range the read/write split is the dominant cost lever, and the
*architectural* conclusion — keep reads off the core — is unchanged. Obtaining the real rate is
[OI-01](#8-open-issues); it determines the size of the business case, not the shape of the design.

**The architecture remains valid if the assumed rate is wrong.** Serving reads from a derived
model is justified independently by latency (NFR-130), by read-path availability (NFR-011), and
by removing the mainframe as a throughput ceiling on customer growth. The cost argument is
additional, not load-bearing.

### 3.9.8 Further cost levers

| Lever | Effect |
|-------|--------|
| Committed-use discounts on steady-state cloud compute and databases | 25–40% off roughly 60% of the cloud bill, once demand is proven |
| Lifecycle tiering to archive storage beyond 13 months | ~80% off the storage rate for the largest and coldest dataset |
| Columnar compression on the analytics copy | ~5:1 |
| Keeping high-volume traffic on one side of the private link | Egress is charged; the CDC design already avoids per-read traffic across it |
| Autoscaling with throttling rather than static peak provisioning | Cloud compute sized to average, not peak |
| Smaller model tier for routine advisor turns | Materially reduces the largest Year-3 cloud line ([OI-06](#8-open-issues)) |
| Staging on-premises capacity rather than buying Year-3 peak on day one | ≈ $8,270/month avoided through Year 1 (§3.9.3) |

---

# 4. Assumptions and Constraints

## 4.1 Constraints

Constraints are given. The design has no authority to change them.

| ID | Constraint | Consequence for the design |
|----|-----------|----------------------------|
| C-01 | The Core Banking System stays. Every money movement is a CBS transaction | The ledger is never bypassed (P1); the write path inherits the core's latency and availability |
| C-02 | DB2, ADABAS and the SQL Server estate remain the systems of record for their own data | Every other store is derived and rebuildable (§3.5.1) |
| C-03 | Some services may legally run only on-premises | Placement is a compliance decision (P9); the on-premises tier is not optional |
| C-04 | The AI advisor may run only in the cloud | It cannot be given ledger-adjacent data; it consumes a tokenised digest (§3.3.5) |
| C-05 | Personal data must stay in the regulatory region, and customers may demand erasure | One region; crypto-shredding rather than row deletion (§3.5.7) |
| C-06 | Twelve months to a live MVP | Rules out replacing the core; forces buy-and-integrate over build (§5) |
| C-07 | 60 developers, mostly Java and AWS; 5 COBOL developers | COBOL capacity is the critical path (R-02); the cloud choice follows the team (D6) |
| C-08 | 99.999% uptime and no data loss are demanded | Committed for the system under design (NFR-010); transfer execution composes to 99.998% against the core (D9). RPO 0 on the write path |
| C-09 | Mainframe capacity is charged per operation and must be minimised | Elevated to a hard engineering constraint, NFR-200 |

## 4.2 Assumptions

Assumptions are the design's exposed surface. Each is stated so it can be challenged, and each
names how it would be validated.

| ID | Assumption | Basis | If wrong |
|----|-----------|-------|----------|
| A-01 | All customers are in one geographic region for the planning horizon | Stated in the brief | Multi-region introduces data-residency and consistency work not costed here |
| A-02 | DB2 supports log-based change data capture in this installation | Standard DB2 capability | Fall back to scheduled extracts; freshness degrades from seconds to minutes (§3.5.2) |
| A-03 | ADABAS changes can be captured by event replication, or by delta extract | Vendor capability; not yet confirmed | Customer data freshness degrades to nightly; acceptable, since no money-path decision depends on it. Spike in weeks 1–6 ([OI-03](#8-open-issues)) |
| A-04 | The 24-hour staleness allowance applies only to externally originated activity | Read of the brief; a customer's own action must appear immediately | Design already exceeds this via write-through (NFR-090) |
| A-05 | Millisecond-level latency is a read-path requirement; a transfer may reasonably take under a second | Standard for retail banking | If sub-second is demanded end-to-end including the core commit, the core becomes the binding constraint and NFR-140 must be renegotiated |
| A-06 | Interbank settlement is an existing external service the bank already reaches | Bank has operated transfers for decades | Building settlement integration is a separate programme |
| A-07 | Branch, ATM and teller channels keep addressing the core directly and are out of scope | Scope statement | Their mainframe load is unchanged by this programme and is excluded from §3.9 |
| A-08 | A digital retail customer reads far more often than they transact | Universal retail-banking pattern; measured ratio 13:1 (§3.8.1) | If writes dominated, the read/write split would still be correct but the saving would shrink |
| A-09 | 30% of digital users are active on a given day | Retail banking app norm | Sizing scales linearly; §3.8 recomputes from the input table |
| A-10 | 2.5 sessions per active user per day | Retail banking app norm | As above |
| A-11 | 12 reads per session | Balance, transaction list, one report view, plus refreshes | As above |
| A-12 | 20 transfers per user per month | Retail current-account norm | Drives both CBS operation count and mainframe cost directly |
| A-13 | Peak is 8× average for reads and 10× for writes | Payday and month-end concentration | Under-estimating peak affects autoscaling headroom, not architecture |
| A-14 | The mainframe charge is $0.001 per operation | **Assumed. The brief supplies no unit rate** | Used only in §3.9.7, which is explicitly separated from the required cost calculation. The sensitivity table there holds across a tenfold range, and the architecture stands independently of it ([OI-01](#8-open-issues)) |
| A-15 | Crypto-shredding is accepted by counsel as satisfying erasure | Common practice where statutory retention conflicts with erasure | If rejected, erasure of ledger-linked personal data becomes legally unresolvable and must be escalated ([OI-02](#8-open-issues)) |
| A-16 | 10% of users consult the AI advisor monthly, twice each | Conservative engagement estimate for a new feature | Advisor cost scales linearly (§3.9); it is the most volatile line in the model |
| A-17 | SQL Server supports native log-based change data capture in this installation | Standard product capability | Fall back to a scheduled delta extract, as for ADABAS; freshness degrades from seconds to minutes |
| A-18 | The SQL Server estate holds **non-ledger** operational or reference data, not authoritative money data | The brief shows it as a source system but does not state its contents. Money is stated to live in DB2 | If it holds authoritative money data it becomes a system of record under P1 and joins the write path. Ingestion is unaffected either way (§3.5.2). Confirm in [OI-10](#8-open-issues) |
| A-19 | "Only this service can run on the cloud and not on-prem" (brief, AI agent) means the AI advisor is **cloud-only**, not that it is the sole permitted cloud service | The same slide states both environments run new digital services, and the cloud environment hosts the API gateway for the app and website | Under the alternative reading every cloud service except the advisor would have to move on-premises, removing the elasticity the design depends on. Confirm with the instructor ([OI-11](#8-open-issues)) |

---

# 5. Time Estimation

This section estimates the **Year-1 MVP** only. Year-2 and Year-3 evolution is scope and capacity
growth, not new construction, and is set out in §1.1.4; the sequencing is in §5.4.

## 5.1 Capacity basis

| Input | Value | Basis |
|-------|-------|-------|
| Developers | 60 | C-07: 5 COBOL, 55 mostly Java/AWS |
| Weekdays per year | 260 | |
| Less annual leave, public holidays, training | 25 + 11 + 5 | |
| **Productive days per developer per year** | **219** | |
| **Productive days per developer-month** | **18** | 219 ÷ 12 |
| Organisational capacity | **12,960 dev-days** | 60 × 12 × 18 |
| **Planned MVP effort** | **7,980 dev-days** | §5.2 |
| Peak concurrent headcount | **57 of 60** | §5.3 — 3 held as floating reserve |

## 5.2 Estimate by delivery stream

Eight streams, each of four or more people. Every row satisfies
**planned effort ≤ developers × months × 18** — no stream is assigned more work than the people
in it can do inside the window it runs in. Each is planned at about 85% of its window capacity,
so slack sits inside the streams rather than only in a programme-level buffer.

| Stream | Devs | Window | Months | Capacity | Planned | Util. |
|--------|-----:|:------:|-------:|---------:|--------:|------:|
| Core Integration — ACL and CBS transaction contract (**5 COBOL** + 3 Java) | 8 | M1–M9 | 9 | 1,296 | 1,100 | 85% |
| Data Platform — CDC from DB2, ADABAS and SQL Server; event backbone; read model and projectors | 8 | M1–M10 | 10 | 1,440 | 1,200 | 83% |
| Platform Engineering — on-premises build-out, container platform, pipeline, DR, observability | 7 | M1–M12 | 12 | 1,512 | 1,280 | 85% |
| Security & Compliance — identity, PII vault, key management, erasure, threat modelling | 4 | M1–M12 | 12 | 864 | 730 | 84% |
| Customer Channels — mobile, web, BFF, account and balance API, reporting | 10 | M3–M12 | 10 | 1,800 | 1,530 | 85% |
| Payments — Transfer Orchestrator, SAGA, store-and-forward | 7 | M4–M10 | 7 | 882 | 750 | 85% |
| Fraud — real-time scorer, offline pipeline, case management | 6 | M5–M11 | 7 | 756 | 640 | 85% |
| Open Banking & Advisor — Open Banking API, consent registry, AI advisor | 7 | M6–M12 | 7 | 882 | 750 | 85% |
| **Total** | **57 peak** | | | **9,432** | **7,980** | **85%** |

## 5.3 Concurrent headcount

| M1 | M2 | M3 | M4 | M5 | M6 | M7 | M8 | M9 | M10 | M11 | M12 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|----:|----:|----:|
| 27 | 27 | 37 | 44 | 50 | 57 | 57 | 57 | 57 | 49 | 34 | 28 |

Peak 57 against 60 available (C-07). Months 1–2 are light by design: only the streams that
unblock everything else are running, which is also the realistic shape of a programme still
standing up its environments.

## 5.4 Sequence

| Phase | Months | Outcome |
|-------|:------:|---------|
| 0 — Foundations | 1–2 | On-premises build-out begins; cloud landing zone; delivery pipeline; **ADABAS capture spike ([OI-03](#8-open-issues))**; **SQL Server data-landscape review ([OI-10](#8-open-issues))**; CBS transaction contract frozen and published with mocks |
| 1 — Read path | 2–5 | Change data capture live from all three sources; event backbone; read model and cache; balance and transaction APIs; app shell. Nothing writes yet |
| 2 — Write path | 4–9 | Anti-corruption layer; Transfer Orchestrator; real-time fraud scoring; internal then external transfers; store-and-forward |
| 3 — Regulated surfaces | 6–11 | Open Banking API and consent; identity, vault and erasure; reporting; offline fraud and case management |
| 4 — Advisor and hardening | 9–12 | AI advisor; load testing at MVP volume with headroom probes at target-state volume; disaster recovery rehearsal; penetration test; conformance and regulatory review |

Two sequencing decisions carry the schedule. **The read path ships before the write path**: it
delivers visible customer value early, exercises ingestion end to end, and proves the
mainframe-operation reduction before anything touches the money path. **The CBS transaction
contract is frozen in month 2** and published with mocks, so 52 developers are never blocked
waiting on 5.

---

# 6. Limitations

| ID | Limitation | Description |
|----|-----------|-------------|
| L-01 | The read model is eventually consistent | Activity not initiated in the app appears after change-data-capture lag, and up to 24 hours for incoming interbank credits (NFR-080). Every read response carries `as_of` and `freshness_seconds` so the client can show the customer what is actually known |
| L-02 | Read-your-writes depends on the write-through path | If write-through fails after a successful posting, the customer's own transfer appears only when the CDC event lands — seconds, not milliseconds. The response is still correct; the cached view lags |
| L-03 | Five nines covers the platform, not ledger posting | 99.999% is committed for SLI-1 to SLI-3 (NFR-010). Completion additionally depends on the Core Banking System and composes to 99.998% (NFR-020) — roughly 10.5 minutes a year in which a transfer is accepted and pending rather than posted. Measured against completion the design is 0.001% short of the stated requirement, and §2.2.1 says so. The composition also assumes independent failure domains, which two systems sharing a site and an operations team do not strictly have |
| L-04 | Single region | A region-wide cloud failure leaves the on-premises estate and disaster recovery site serving reduced digital function. Multi-region was rejected on cost and data-residency grounds ([D6](decisions.md#d6--cloud-platform-and-region-strategy)) |
| L-05 | On-premises capacity is fixed | It is bought for year-three peak on day one and cannot flex. This is why only genuinely regulated workloads are placed there |
| L-06 | Fraud reversal is visible to the customer | A transfer caught by the offline process after posting is reversed by a compensating entry (P4). The customer sees both postings. This is a consequence of an immutable ledger and is the correct behaviour, but it is not invisible |
| L-07 | The AI advisor sees a summary, not the ledger | It reasons over a tokenised spend digest, so it cannot answer questions requiring raw transaction detail or real-time balances beyond what the digest carries |
| L-08 | Branch, ATM and teller load is unchanged | This programme reduces mainframe operations from digital channels only. Existing channel load is out of scope and excluded from §3.9 |
| L-09 | Cost model is an estimate, not a quotation | Cloud figures are modelled on list rates at ±30% and have not been rebuilt against a dated rate card ([OI-12](#8-open-issues)). No committed-use discount is assumed. The mainframe unit cost is assumed, not quoted (A-14), which is why §3.9.7 is separated from the required calculation |

---

# 7. Risks and Mitigations

| ID | Risk | Impact | Likelihood | Mitigation |
|----|------|--------|-----------|------------|
| R-01 | ADABAS cannot be captured in near-real time | Medium | Medium | Scheduled delta extract as the designed fallback; no money-path decision depends on customer-master freshness. Resolved by a spike in months 1–2, before the design commits (§5.3) |
| R-02 | Five COBOL developers are the critical path for the anti-corruption layer | **High** | **High** | Freeze the CBS transaction contract in month 2 and publish it with mocks so the other 55 developers are never blocked; keep the CBS surface deliberately thin — a small number of transaction types, no business logic on the mainframe side; hold three developers in reserve; engage a specialist COBOL partner for surge capacity |
| R-03 | The real-time fraud model cannot meet the 80 ms budget | High | Medium | Two-stage scoring — deterministic rules first, model second; features pre-computed into cache so the money path never queries a database; hard 100 ms timeout with an explicit policy (proceed under a lowered ceiling and force offline review, or hold); model runs in shadow against live traffic before it gates a transfer |
| R-04 | The business reads 99.999% as covering ledger posting rather than the platform | High | Medium | Agree the measurement scope explicitly up front: 99.999% committed for the system under design (NFR-010); 99.998% derived for transfer execution (NFR-020, [D9](decisions.md#d9--meeting-99999-with-a-core-dependent-write-path)). Store-and-forward keeps acceptance available through a core outage but is never presented as completion. Raising 99.998% requires mainframe investment, not platform work |
| R-05 | Change-data-capture lag or event loss silently corrupts the read model | High | Medium | 30-day replayable log; idempotent projection by sequence number; nightly reconciliation against DB2 control totals with alerting; read-model rebuild as a rehearsed, supported operation (§3.7) |
| R-06 | Open Banking traffic exhausts capacity serving the bank's own customers | Medium | Medium | Dedicated ingress, dedicated read replicas, per-third-party quotas — a bulkhead, not a rate-limit afterthought (§3.3.4) |
| R-07 | Counsel rejects crypto-shredding as satisfying erasure | High | Low | Raised as [OI-02](#8-open-issues) for resolution in months 1–3, before the vault design is built out. No alternative reaches backups and archives, so an early answer is essential |
| R-08 | Mainframe cost per operation is far higher than modelled | Medium | Medium | The design already minimises operations to 1.0× money movements; a higher rate strengthens rather than weakens the illustrative case (§3.9.7), and the design does not depend on it. Obtain the real figure in month 1 ([OI-01](#8-open-issues)) |
| R-09 | AI advisor inference cost grows faster than planned | Medium | Medium | Spend digest and prompt caching are already designed in (§3.9.4); per-customer monthly quotas; model tier reviewed against measured advice quality ([OI-06](#8-open-issues)) |
| R-10 | Twelve months proves insufficient for the full functional scope | High | Medium | Phased delivery with the read path first (§5.3), so a schedule slip costs the newest capability rather than the core proposition; the AI advisor is the designated first candidate to defer, being a *Should* (FR-190) |
| R-11 | Hiring and onboarding 60 developers consumes early capacity | Medium | High | 13% schedule buffer (§5.1); phase 0 front-loads platform and contract work that a smaller senior group can complete |
| R-12 | On-premises hardware procurement slips | Medium | Medium | Long-lead items ordered in month 1; phase 1 development proceeds against cloud environments and the contract mocks |

---

# 8. Open Issues

| ID | Issue | Why it matters | Next step | Owner | Needed by |
|----|-------|----------------|-----------|-------|-----------|
| OI-01 | Actual mainframe charge per operation is unknown | Drives the illustrative saving in §3.9.7; the design and the required cost calculation do not depend on it | Obtain the chargeback rate from mainframe capacity management and finance | Architecture + Finance | Month 1 |
| OI-02 | Legal sign-off on crypto-shredding as GDPR erasure | No other mechanism reaches backups and archives; blocks the vault design | Formal opinion from the Data Protection Officer and external counsel | DPO | Month 3 |
| OI-03 | Feasibility and licensing of near-real-time ADABAS change capture | Determines customer-data freshness and the ingestion design | Technical spike with the vendor in phase 0 | Data Ingestion team | Month 2 |
| OI-04 | Formal recovery objectives | RTO/RPO are proposed in NFR-040–NFR-070 but not yet agreed with the business | Business continuity workshop; confirm or revise | Risk + Architecture | Month 2 |
| OI-05 | Which Open Banking regulatory profile applies | Determines the security profile, consent model and certification path | Confirm the national scheme and its conformance requirements | Compliance | Month 2 |
| OI-06 | Model tier and rate card for the AI advisor | Largest year-3 cloud line; tier choice trades cost against advice quality | Evaluate tiers against a held-out advice-quality set; obtain the marketplace rate card | AI Advisor team | Month 6 |
| OI-07 | Whether the offline fraud pipeline may process data in the cloud | Determines placement of a substantial workload | Data classification review with Compliance | Compliance | Month 3 |
| OI-08 | Definition of "millisecond-level" as a contractual target | NFR-130 proposes p95 ≤ 100 ms; needs business confirmation | Confirm with Product against competitor benchmarks | Product | Month 2 |
| OI-09 | Agreed mainframe throughput ceiling for the digital channel | Sizes the token bucket protecting the core (§3.8.4) | Capacity agreement with mainframe operations | Platform + Mainframe ops | Month 3 |
| OI-10 | What the SQL Server estate owns, and whether any of it is authoritative money data | Determines whether it is a third read-side source or a second write-side system of record (A-18) | Data-landscape review with the owning application teams | Data Platform | Month 1 |
| OI-11 | Confirm the reading of the cloud-only wording for the AI agent (A-19) | The alternative reading would force every cloud service on-premises | Clarify with the business sponsor | Architecture | Month 1 |
| OI-12 | Cloud cost model not verified line by line against a dated AWS rate card | §3.9 uses modelled `eu-central-1` list-price estimates at ±30%. One rate was corroborated externally (`m6i.large` at $0.096/hour, 28 Aug 2026); the rest were not, because AWS publishes regional rates through JavaScript-rendered pages and a bulk API that could not be retrieved in full | Rebuild the model in the AWS Pricing Calculator, export the estimate, attach it, and restate §3.9.2 against it | Architecture + Finance | Month 2, before any budget submission |
| OI-13 | The service-level indicator for the 99.999% requirement is not defined in the brief | Determines whether the platform meets the requirement (SLI-1 to SLI-3) or falls 0.001% short of it (SLI-4). §2.2.1 states both rather than choosing silently | Confirm the intended measurement boundary with the business sponsor and the regulator-facing risk function | Architecture + Risk | Month 1 |
