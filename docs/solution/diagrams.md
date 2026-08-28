# Diagrams — NeoBank *Digital Leap*

Structure views are drawn top-down; flow and pipeline views are drawn left-to-right or as
sequences.

Referenced throughout the [High Level Design](hld.md). Rationale for what these diagrams show is
in the [Decision Log](decisions.md).

---

## 0. Legend

One colour vocabulary applies to every diagram in this document. A shape means the same thing
wherever it appears.

```mermaid
flowchart LR
    p(["Person or actor"]):::person
    s["New service<br/>built by this programme"]:::svc
    r[("System of record<br/>authoritative, not rebuildable")]:::sor
    d[("Derived store<br/>rebuildable from the log")]:::store
    b["Event log<br/>ordered, replayable"]:::bus
    a["Anti-corruption layer<br/>the only route to the core"]:::acl
    l["Legacy core platform<br/>CBS, DB2, ADABAS"]:::legacy
    y[["Trust boundary crossing"]]:::boundary
    x["External system"]:::external

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef sor fill:#00695c,stroke:#003d33,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
    classDef boundary fill:#ef6c00,stroke:#b53d00,color:#fff
    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
```

| Line style | Meaning |
|------------|---------|
| Solid arrow | Synchronous request or command |
| Thick arrow | Traffic crossing the cloud / on-premises boundary |
| Dotted arrow | Asynchronous data flow — change data capture, events, notifications |

---

## 1. C4 Context

Who uses the platform, and what it depends on.

```mermaid
flowchart TB
    cust(["Retail Customer"]):::person
    analyst(["Fraud Analyst"]):::person
    tpp(["Third-Party Provider"]):::person

    sys["<b>NeoBank Digital Platform</b><br/>accounts, transfers, fraud, reporting,<br/>Open Banking, AI advisor"]:::svc

    core["Core Banking System<br/>COBOL on z/OS, DB2 + ADABAS"]:::legacy
    sqlsrv[("SQL Server Estate<br/>third source system")]:::sor
    banks["Interbank Settlement Network"]:::external
    idp["Identity Provider"]:::external
    llm["Managed Model Service"]:::external
    reg["Regulator"]:::external

    cust -->|views balances, transfers funds| sys
    analyst -->|reviews and approves reversals| sys
    tpp -->|Open Banking REST, under consent| sys

    sys -->|every money movement<br/>as a CBS transaction| core
    core -.->|change data capture| sys
    sqlsrv -.->|change data capture| sys
    sys -->|settles external transfers| banks
    sys -->|authenticates customers| idp
    sys -->|tokenised spend digest only| llm
    sys -->|audit records, 7-year retention| reg

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef sor fill:#00695c,stroke:#003d33,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
```

The brown box is the constraint the whole design is organised around: it cannot be changed, it
must not be bypassed, and it charges for every operation. **Three** source systems feed the
platform, not two — DB2 and ADABAS on the mainframe, and the SQL Server estate beside them
(§3.5.2, [A-18](hld.md#42-assumptions)).

---

## 2. Target platform vision

The layered view of the target estate — production and disaster recovery, cloud over
on-premises, all three source systems beneath the ingestion tier. This mirrors the structure set
out in the project brief and is the "big picture first" view; §3 onward decomposes it.

```mermaid
flowchart TB
    clients(["Mobile App · Website · Third-Party Providers"]):::person
    gw["API GATEWAY + LOAD BALANCER"]:::svc

    subgraph prod["PRODUCTION SITE"]
        direction TB
        pc["CLOUD<br/>New Digital Services, 3 AZs<br/>query, reporting, Open Banking,<br/>notification, AI advisor, offline fraud"]:::svc
        po["ON-PREM<br/>New Digital Services<br/>orchestration, real-time fraud,<br/>consent, identity, vault"]:::svc
        ping["DATA INGESTION"]:::bus
        pacl["Anti-Corruption Layer"]:::acl
    end

    subgraph dr["DISASTER RECOVERY SITE"]
        direction TB
        dc["CLOUD<br/>warm standby"]:::svc
        do["ON-PREM<br/>warm standby"]:::svc
        ding["DATA INGESTION<br/>standby"]:::bus
    end

    subgraph src["SOURCE SYSTEMS — unchanged by this programme"]
        direction LR
        cbs["CBS<br/>COBOL on z/OS"]:::legacy
        db2[("DB2<br/>transactions")]:::legacy
        adabas[("ADABAS<br/>customers")]:::legacy
        sqls[("SQL Server<br/>contents TBC")]:::sor
    end

    clients --> gw
    gw ==> pc
    pc ==> po
    po --> pacl
    pacl --> cbs
    cbs --- db2
    cbs --- adabas

    db2 -.-> ping
    adabas -.-> ping
    sqls -.-> ping
    ping --> po

    pc -.->|replication| dc
    po -.->|replication| do
    ping -.-> ding

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef sor fill:#00695c,stroke:#003d33,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
```

Two points where this design makes a deliberate choice rather than simply copying the target
picture. The disaster recovery site is a **warm standby**, not a symmetric hot estate — the
reasoning and the cost it avoids are in [D15](decisions.md#d15--disaster-recovery-posture).
And **every arrow into the core passes through the anti-corruption layer**, which the vision
does not name but which NFR-280 requires.

---

## 3. C4 Container

The major runnable pieces and the traffic between them. Placement follows principle **P9** —
regulated and core-adjacent work on-premises, elastic customer-facing work in the cloud. The two
environments are drawn separately so each stays legible in print; they meet only at the private
link, shown as a boundary node in both halves.

### 3.1 Cloud environment

```mermaid
flowchart TB
    app(["Mobile / Web Client"]):::person
    tpp(["Third-Party Provider"]):::person

    subgraph edge["Public edge subnets"]
        direction LR
        gw["API Gateway<br/>TLS, WAF, authN, rate limit"]:::svc
        obgw["Open Banking Ingress<br/>FAPI profile, per-TPP quota"]:::svc
    end

    subgraph appt["Private application subnets, 3 AZs"]
        direction LR
        bff["BFF<br/>one round trip per screen"]:::svc
        acct["Account and Balance API<br/>FR-010, FR-040"]:::svc
        rep["Reporting Service<br/>FR-020, FR-030"]:::svc
        ob["Open Banking API<br/>FR-150 to FR-180"]:::svc
        notif["Notification Service<br/>FR-130"]:::svc
        advisor["AI Advisor<br/>cloud only, FR-200"]:::svc
        offf["Offline Fraud Pipeline<br/>FR-110"]:::svc
    end

    subgraph datat["Isolated data subnets, 3 AZs"]
        direction LR
        cache[("Cache<br/>hot balances")]:::store
        rm[("Read Model<br/>writer + replicas")]:::store
        obrm[("Read Replicas<br/>dedicated to TPPs")]:::store
        mirror["Event Backbone<br/>cloud mirror"]:::bus
        lake[("Analytics Lake<br/>tiered object storage")]:::store
    end

    link[["PRIVATE LINK to on-premises<br/>mutual TLS, 2 diverse paths"]]:::boundary

    app --> gw
    tpp --> obgw
    gw --> bff
    obgw --> ob
    bff --> acct
    bff --> rep
    bff --> advisor
    bff --> notif
    acct --> cache
    acct --> rm
    rep --> rm
    ob --> obrm
    advisor -->|tokenised spend digest| lake
    mirror -->|projection| rm
    mirror --> lake
    mirror --> offf
    offf -.->|fraud verdict| mirror

    bff ==>|transfer command| link
    link ==>|event stream, mirrored| mirror
    link ==>|write-through on commit| cache
    notif -.->|push notification| app

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef boundary fill:#ef6c00,stroke:#b53d00,color:#fff
```

Everything here is read-only or read-mostly, none of it holds authoritative money state, and none
of it has a route to the mainframe. That is what allows this half to be scaled elastically and to
carry the full 99.999% system availability target (NFR-010, NFR-011).

### 3.2 On-premises environment and the core

```mermaid
flowchart TB
    link[["PRIVATE LINK from cloud<br/>mutual TLS, 2 diverse paths"]]:::boundary

    subgraph appzone["Application zone"]
        direction LR
        orch["Transfer Orchestrator<br/>SAGA, idempotency,<br/>store-and-forward"]:::svc
        rtf["Real-time Fraud Scorer<br/>blocks BEFORE any posting"]:::svc
        consent["Consent and Identity"]:::svc
        vault[("Customer PII Vault<br/>raw PII + per-customer keys")]:::sor
        ostore[("Transfer State Store<br/>RPO 0, cross-site sync")]:::sor
        bus["Event Backbone<br/>ordered, replayable"]:::bus
        cdc["CDC Producers<br/>three sources, one contract"]:::svc
    end

    subgraph corezone["Core zone — ONE admitted path"]
        direction LR
        acl["Anti-Corruption Layer<br/>the only route to the CBS"]:::acl
        cbs["CBS, COBOL on z/OS"]:::legacy
        db2[("DB2<br/>transactions")]:::legacy
        adabas[("ADABAS<br/>customers")]:::legacy
    end

    sqls[("SQL Server Estate<br/>third source, contents TBC")]:::sor
    banks["Interbank Network"]:::external

    link ==>|transfer command| orch
    orch -->|fraud check, 100 ms timeout| rtf
    orch --> ostore
    orch -->|exactly one CBS transaction| acl
    orch --> bus
    consent --> vault
    consent --> bus
    cdc --> bus
    bus ==>|mirrored to cloud| link
    orch ==>|write-through on commit| link
    bus -.->|offline fraud verdict| orch

    acl --> cbs
    acl -->|external settlement| banks
    cbs --- db2
    cbs --- adabas
    db2 -.->|log-based CDC| cdc
    adabas -.->|event replication| cdc
    sqls -.->|log-based CDC| cdc

    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef sor fill:#00695c,stroke:#003d33,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
    classDef boundary fill:#ef6c00,stroke:#b53d00,color:#fff
```

Three things are worth reading off these two diagrams together:

- **Nothing in the cloud half has a line into the core zone.** Reads never reach the mainframe
  (P2), which is what delivers both the latency target and the 93% reduction in mainframe
  operations.
- **Exactly one box touches the CBS**, and it is red. That is the anti-corruption layer (P3),
  and it is also the enforcement point for quota, idempotency and cost metering (P7).
- **The dotted lines out of DB2, ADABAS and SQL Server are the whole data path.** Change data
  capture flows one way, out of the sources and into the derived stores. Nothing flows back in
  except a transaction.

Consent enforcement and customer notification also cross the boundary; both are shown where they
belong, in the flow diagrams at §6.3, §6.4 and §6.5.

---

## 4. Data architecture

Where the truth lives, what is derived from it, and how long each copy is kept. Drawn
left-to-right because it is a pipeline.

```mermaid
flowchart LR
    subgraph sorbox["SYSTEMS OF RECORD — authoritative, never rebuilt"]
        direction TB
        db2[("DB2<br/>postings and balances")]:::legacy
        adabas[("ADABAS<br/>customer master")]:::legacy
        sqls[("SQL Server<br/>contents TBC, A-18")]:::sor
        ostore[("Transfer state<br/>RPO 0")]:::sor
        vault[("PII Vault<br/>+ per-customer keys")]:::sor
    end

    subgraph logbox["DURABLE EVENT LOG"]
        bus["Event Backbone<br/>replication factor 3<br/>30-day replayable retention"]:::bus
    end

    subgraph derbox["DERIVED — all rebuildable from the log"]
        direction TB
        cache[("Cache<br/>hours")]:::store
        rm[("Read Model<br/>90-day hot window")]:::store
        lake[("Analytics Lake<br/>13 months")]:::store
        arch[("Archive<br/>to 7 years, statutory")]:::store
        digest[("Spend Digest<br/>tokenised, advisor input")]:::store
    end

    db2 -.->|log-based CDC| bus
    adabas -.->|event replication| bus
    sqls -.->|log-based CDC| bus
    ostore -.->|lifecycle events| bus

    bus -->|idempotent projection| rm
    bus --> lake
    rm --> cache
    lake -->|nightly| digest
    lake -->|lifecycle policy| arch

    vault -.->|per-customer key,<br/>destroyed on erasure| derbox
    db2 -.->|nightly control totals| rm

    classDef sor fill:#00695c,stroke:#003d33,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
```

The left-hand group is authoritative and irreplaceable. The right-hand group is derived and can
be deleted and rebuilt at any time — which is exactly why the read path can be optimised as
aggressively as it is. The purple log is the hinge: it makes the derived stores reconstructible
without ever asking a source system a question.

The dotted line from the vault is the erasure mechanism (§3.5.7). Every derived copy is encrypted
under the customer's own key, so destroying that one key renders all of them unreadable at once —
including backups and archives, which no row-level delete can reach.

---

## 5. Deployment and network topology

Trust boundaries, subnet tiers and the disaster recovery site.

```mermaid
flowchart TB
    internet(["Internet"]):::external

    subgraph cloudvpc["CLOUD VPC — region inside the regulatory boundary"]
        subgraph pub["Public subnets, 3 AZs"]
            alb["Load Balancer + WAF"]:::svc
            nat["NAT Gateways"]:::svc
        end
        subgraph priv["Private application subnets, 3 AZs"]
            pods["Service containers<br/>autoscaling"]:::svc
        end
        subgraph iso["Isolated data subnets, 3 AZs — no route to NAT"]
            dbs[("Read model, cache,<br/>event mirror")]:::store
        end
        pep["Private endpoints"]:::svc
    end

    subgraph dc1["ON-PREMISES DC1 — production"]
        dmz1[["DMZ<br/>link termination"]]:::boundary
        az1["Application zone<br/>orchestrator, fraud, consent,<br/>vault, event backbone"]:::svc
        cz1["Core zone<br/>ACL, HSM, CBS, DB2, ADABAS"]:::acl
    end

    subgraph dc2["ON-PREMISES DC2 — disaster recovery"]
        dmz2[["DMZ"]]:::boundary
        az2["Application zone<br/>warm standby, D15"]:::svc
        cz2["Core zone, standby"]:::acl
    end

    internet -->|443 only| alb
    alb --> pods
    pods --> dbs
    pods --> pep
    pods --> nat
    nat -->|egress only| internet

    pods ==>|mutual TLS, 2 dedicated links,<br/>diverse paths, VPN fallback| dmz1
    dmz1 -->|firewall| az1
    az1 -->|single admitted path:<br/>ACL only, whitelisted, quota| cz1

    dc1 -.->|synchronous for transfer state, RPO 0<br/>asynchronous for bulk| dc2

    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef boundary fill:#ef6c00,stroke:#b53d00,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
```

The isolated data subnets have no route to a NAT gateway, so a compromised database cannot call
out. The core zone admits exactly one source — the anti-corruption layer — which is what NFR-280
requires and what makes the mainframe cost controllable as well as secure.

---

## 6. Flow diagrams

### 6.1 View account information and balance — FR-010, FR-040

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API Gateway (cloud)
    participant API as Account and Balance API
    participant $ as Cache
    participant RM as Read Model replica

    C->>GW: GET /v1/accounts/{id}/balance
    GW->>GW: validate token, rate limit
    GW->>API: authorised request
    API->>$: read by account key
    alt cache hit, ~85% of reads
        $-->>API: balance, last 50 transactions
    else cache miss
        API->>RM: query by customer_token
        RM-->>API: rows
        API->>$: populate
    end
    API-->>C: 200 OK + as_of + freshness_seconds<br/>p95 55 ms

    Note over C,RM: No CBS operation is consumed.<br/>The mainframe is not involved.
```

### 6.2 Transfer with real-time fraud check — FR-050 to FR-080, FR-100, FR-120

**This is the primary fraud-cancellation path.** A blocked transfer is rejected *before* any CBS
transaction is submitted, so nothing posts and no reversal exists.

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API Gateway (cloud)
    participant O as Transfer Orchestrator (on-prem)
    participant F as Real-time Fraud Scorer
    participant N as Notification Service
    participant ACL as Anti-Corruption Layer
    participant CBS as CBS / DB2
    participant $ as Read Cache

    C->>GW: POST /v1/transfers + Idempotency-Key
    GW->>GW: authN, step-up above threshold
    GW->>O: transfer command (private link)
    O->>O: dedupe, persist ACCEPTED (RPO 0)
    O->>F: score(features from cache)

    alt BLOCK — fraud detected in real time (FR-120)
        F-->>O: BLOCK + reason_codes
        O->>O: state REJECTED_FRAUD
        Note over O,ACL: NO CBS transaction is submitted.<br/>Nothing posts. No reversal is needed.
        O->>N: cancellation notice
        N-->>C: in-app + push: transfer cancelled (FR-130)
        O-->>C: 200 REJECTED_FRAUD + reason
    else ALLOW
        F-->>O: ALLOW, p99 under 80 ms
        O->>ACL: CoreTransferRequest + idempotency_key
        ACL->>CBS: exactly one CBS transaction
        CBS-->>ACL: cbs_transaction_id, sequence, balance
        ACL-->>O: committed
        O->>O: state POSTED
        O->>$: write through, authoritative post-state
        O-->>C: 200 POSTED + new balance
    end

    Note over O,ACL: On an indeterminate result the Orchestrator never blindly retries.<br/>It queries the CBS by idempotency key and converges.
```

### 6.3 Offline fraud detected after posting — FR-110, FR-125, FR-130

**This is the exception path.** Compensation exists only for fraud the real-time budget could not
catch, where a posting already exists.

```mermaid
sequenceDiagram
    autonumber
    participant B as Event Backbone
    participant OF as Offline Fraud Pipeline (cloud)
    participant CM as Case Management
    actor A as Fraud Analyst
    participant O as Transfer Orchestrator (on-prem)
    participant ACL as Anti-Corruption Layer
    participant CBS as CBS / DB2
    participant N as Notification Service
    actor C as Customer

    B-->>OF: transaction.posted.v1 stream
    OF->>OF: score against full history,<br/>cross-account patterns, ML models
    OF-->>B: fraud.verdict.v1 (OFFLINE)
    B->>CM: raise case
    alt above value threshold
        CM->>A: queue for review
        A-->>CM: approve reversal
    else below threshold
        CM->>CM: auto-approve
    end
    CM->>O: reverse(transfer_id)
    O->>ACL: CoreTransferRequest + original_transaction_ref
    ACL->>CBS: COMPENSATING transaction
    Note over ACL,CBS: The original posting is never edited.<br/>Both entries remain in the ledger. (P4)
    CBS-->>ACL: reversal posted
    ACL-->>O: committed
    O->>N: cancellation notice
    N-->>C: in-app + push: transaction cancelled (FR-130)
```

### 6.4 Open Banking request — FR-150 to FR-180

```mermaid
sequenceDiagram
    autonumber
    participant T as Third-Party Provider
    participant OBGW as Open Banking Ingress
    participant OB as Open Banking API
    participant CO as Consent Service (on-prem)
    participant RR as Dedicated Read Replicas

    T->>OBGW: mTLS + OAuth2 certificate-bound token
    OBGW->>OBGW: verify certificate binding,<br/>enforce per-TPP quota
    OBGW->>OB: GET /open-banking/v1/accounts
    OB->>CO: validate consent (short-TTL cached)
    alt consent valid and unexpired
        CO-->>OB: scopes granted
        OB->>RR: query, dedicated replicas
        RR-->>OB: rows
        OB-->>T: 200 OK + as_of
    else consent revoked or expired
        CO-->>OB: denied
        OB-->>T: 403 consent_required
    end

    Note over OBGW,RR: Dedicated ingress and replicas are a bulkhead:<br/>TPP load cannot degrade the bank's own customers,<br/>and never reaches the core.
```

### 6.5 AI advisor consultation — FR-190 to FR-210

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API Gateway
    participant AD as AI Advisor (cloud only)
    participant CO as Consent Service
    participant D as Spend Digest store
    participant M as Managed Model Service

    C->>GW: "How can I cut my monthly spend?"
    GW->>AD: authorised request
    AD->>CO: advisory consent for customer_token?
    alt consent absent
        CO-->>AD: denied
        AD-->>C: advisor unavailable, consent required
    else consent present
        CO-->>AD: granted
        AD->>D: retrieve digest by customer_token
        D-->>AD: categorised totals, trends,<br/>commitments, savings capacity
        AD->>M: instructions + digest + question
        Note over AD,M: Tokenised only. No name, no account number,<br/>no raw transactions. Cached stable prefix.
        M-->>AD: advice
        AD-->>C: response, in-region inference
    end
```

### 6.6 GDPR erasure — FR-240, NFR-270

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant CO as Consent and Identity
    participant V as PII Vault + HSM
    participant B as Event Backbone
    participant RM as Read Model
    participant $ as Cache
    participant L as Analytics Lake + Archive
    participant CBS as CBS ledger

    C->>CO: erase all my data
    CO->>CO: check statutory legal hold
    CO->>V: delete record, DESTROY per-customer key
    V-->>CO: key destroyed, irreversible
    CO-->>B: erasure.requested.v1
    par propagate to every store owner
        B-->>RM: PII columns now unreadable
        B-->>$: evict all keys for customer_token
        B-->>L: unreadable, partitions rewritten on next compaction
        B-->>B: tombstone on compacted topics
    end
    Note over V,L: Backups and archives are covered too —<br/>they were encrypted under the destroyed key.
    Note over CBS: The ledger keeps its legally required financial record,<br/>now bearing only a token that resolves to nothing.
    CO-->>C: erasure confirmed
```

---

## 7. Transfer state machine

The lifecycle FR-090 requires the customer to be able to see at any moment. Note that
`REJECTED_FRAUD` is reached **without any posting**, while `REVERSED` is reached only from
`POSTED`.

```mermaid
stateDiagram-v2
    [*] --> ACCEPTED: command persisted, replicated
    ACCEPTED --> SCORING: submit to real-time fraud scorer
    SCORING --> REJECTED_FRAUD: BLOCK — cancelled before posting (FR-120)
    SCORING --> QUEUED: core unavailable
    SCORING --> SUBMITTED: ALLOW
    QUEUED --> SUBMITTED: core recovered, store-and-forward drains
    SUBMITTED --> POSTED: CBS commit confirmed
    SUBMITTED --> REJECTED_FUNDS: insufficient funds
    SUBMITTED --> INDETERMINATE: timeout, outcome unknown
    INDETERMINATE --> POSTED: reconciliation by idempotency key
    INDETERMINATE --> FAILED: reconciliation shows no posting
    POSTED --> REVERSED: offline fraud confirmed — compensating<br/>transaction posted (FR-125)
    REJECTED_FRAUD --> [*]
    REJECTED_FUNDS --> [*]
    FAILED --> [*]
    POSTED --> [*]
    REVERSED --> [*]

    note right of QUEUED
        Shown to the customer as PENDING.
        Never presented as complete.
        This is why acceptance stays
        available through a core outage.
    end note

    note right of INDETERMINATE
        Never resolved by blind retry.
        A retry could double-post money.
    end note
```

---

## 8. Scaling and cost view

Why the read path scales out and the write path deliberately does not.

```mermaid
flowchart LR
    users(["1M users at Year 3<br/>300K daily active"]):::person

    subgraph readpath["QUERY PATH — scales out freely"]
        direction TB
        r1["Peak 1,100 req/s"]:::svc
        r2["Stateless services<br/>autoscaled"]:::svc
        r3[("Cache, 85% hit")]:::store
        r4[("Read replicas<br/>added without schema change")]:::store
    end

    subgraph writepath["WRITE PATH — deliberately throttled"]
        direction TB
        w1["Peak 80 tx/s"]:::svc
        w2[["Token bucket toward the core<br/>excess queued, never dropped"]]:::boundary
        w3["Anti-Corruption Layer"]:::acl
    end

    cbs["CBS — charged per operation"]:::legacy

    users --> r1 --> r2 --> r3 --> r4
    users --> w1 --> w2 --> w3 --> cbs
    r4 -.->|ZERO CBS operations| cbs

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef boundary fill:#ef6c00,stroke:#b53d00,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
```

| | Queries | Writes |
|---|---|---|
| Year-3 peak | 1,100 req/s | 80 tx/s |
| CBS operations per month | 0 | 20,000,000 |
| Scaling response | Add nodes and replicas | Throttle, queue, and buy mainframe capacity only if genuinely needed |
| Marginal cost of growth | Low and elastic | Charged per operation |

The asymmetry in the right-hand column is the whole argument. Queries are free to grow; writes
cost money every time, so the architecture keeps the write count equal to the number of times a
customer actually moves money — and no higher.
