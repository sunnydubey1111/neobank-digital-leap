# Diagrams — NeoBank *Digital Leap*

Every diagram is authored as Mermaid text and renders directly on GitHub and in the published
site. They are organised on the C4 model — context, then containers, then the views that cut
across them, then one sequence per flow.

Referenced throughout the [High Level Design](hld.md). Rationale for what these diagrams show
is in the [Decision Log](decisions.md).

---

## 1. C4 Context

Who uses the platform, and what it depends on.

```mermaid
flowchart TB
    cust(["Retail Customer<br/>mobile app and web"]):::person
    analyst(["Fraud Analyst<br/>reviews flagged cases"]):::person
    tpp(["Third-Party Provider<br/>fintech under Open Banking"]):::person

    sys["<b>NeoBank Digital Platform</b><br/>accounts, transfers, fraud,<br/>reporting, Open Banking, AI advisor"]:::system

    cbs["Core Banking System<br/>COBOL on z/OS, DB2 and ADABAS<br/>system of record for money"]:::legacy
    banks["Interbank Settlement Network"]:::external
    idp["Identity Provider<br/>OpenID Connect and MFA"]:::external
    llm["Managed Model Service<br/>in-region inference"]:::external
    reg["Regulator<br/>audit and Open Banking supervision"]:::external

    cust -->|views balances, transfers funds| sys
    analyst -->|reviews and approves reversals| sys
    tpp -->|Open Banking REST, under consent| sys

    sys -->|executes every money movement<br/>as a CBS transaction| cbs
    sys -->|captures committed changes<br/>via CDC| cbs
    sys -->|settles external transfers| banks
    sys -->|authenticates customers| idp
    sys -->|tokenised spend digest only| llm
    sys -->|audit records, 7-year retention| reg

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef system fill:#1168bd,stroke:#0b4884,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
```

The brown box is the constraint the whole design is organised around: it cannot be changed, it
must not be bypassed, and it charges for every operation.

---

## 2. C4 Container

The major runnable pieces and the traffic between them. Placement follows principle **P9** —
regulated and core-adjacent work on-premises, elastic customer-facing work in the cloud.

The two environments are drawn separately so each stays legible in print. They meet at one
place only: the private link, shown as a boundary node in both halves.

### 2.1 Cloud environment

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
        rm[("Read Model<br/>writer + 3 replicas")]:::store
        obrm[("Read Replicas<br/>dedicated to TPPs")]:::store
        mirror["Event Backbone<br/>cloud mirror"]:::bus
        lake[("Analytics Lake<br/>tiered object storage")]:::store
    end

    link[["PRIVATE LINK to on-premises<br/>mutual TLS, 2 diverse paths"]]:::link

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
    offf -->|fraud verdict| mirror

    bff ==>|transfer command| link
    link ==>|event stream, mirrored| mirror
    link ==>|write-through on commit| cache
    notif -.->|push| app

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef link fill:#ef6c00,stroke:#b53d00,color:#fff
```

Everything here is read-only or read-mostly, none of it holds authoritative money state, and
none of it has a route to the mainframe. That is what allows this half to be scaled elastically
and to carry a 99.999% target (NFR-010).

### 2.2 On-premises environment and the core

```mermaid
flowchart TB
    link[["PRIVATE LINK from cloud<br/>mutual TLS, 2 diverse paths"]]:::link

    subgraph appzone["Application zone"]
        direction LR
        orch["Transfer Orchestrator<br/>SAGA, idempotency,<br/>store-and-forward"]:::svc
        rtf["Real-time Fraud Scorer<br/>p99 under 80 ms"]:::svc
        consent["Consent and Identity"]:::svc
        vault[("Customer PII Vault<br/>raw PII + per-customer DEKs")]:::store
        bus["Event Backbone<br/>ordered, replayable"]:::bus
        cdc["CDC Producers<br/>DB2 log, ADABAS replication"]:::svc
    end

    subgraph corezone["Core zone — ONE admitted path"]
        direction LR
        acl["Anti-Corruption Layer<br/>the only route to the CBS"]:::acl
        cbs["CBS, COBOL on z/OS"]:::legacy
        db2[("DB2<br/>transactions")]:::legacy
        adabas[("ADABAS<br/>customers")]:::legacy
    end

    banks["Interbank Network"]:::external

    link ==>|transfer command| orch
    orch -->|fraud check, 100 ms timeout| rtf
    orch -->|exactly one CBS transaction| acl
    orch --> bus
    consent --> vault
    consent --> bus
    cdc --> bus
    bus ==>|mirrored to cloud| link
    orch ==>|write-through on commit| link
    bus -->|fraud verdict returns| orch

    acl --> cbs
    acl -->|external settlement| banks
    cbs --- db2
    cbs --- adabas
    db2 -.->|log-based CDC| cdc
    adabas -.->|event replication| cdc

    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
    classDef external fill:#6e6e6e,stroke:#4a4a4a,color:#fff
    classDef link fill:#ef6c00,stroke:#b53d00,color:#fff
```

Three things are worth reading off these two diagrams together:

- **Nothing in the cloud half has a line into the core zone.** Reads never reach the mainframe
  (P2), which is what delivers both the latency target and the 93% reduction in mainframe
  operations.
- **Exactly one box touches the CBS**, and it is red. That is the anti-corruption layer (P3),
  and it is also the enforcement point for quota, idempotency and cost metering (P7).
- **The dotted lines out of DB2 and ADABAS are the whole data path.** Change data capture flows
  one way, out of the core and into the derived stores. Nothing flows back in except a
  transaction.

Consent enforcement and customer notification also cross the boundary; both are shown where they
belong, in the flow diagrams at §5.3, §5.4 and §5.5.

---

## 3. Data architecture

Where the truth lives, what is derived from it, and how long each copy is kept.

```mermaid
flowchart LR
    subgraph sor["SYSTEMS OF RECORD, never derived"]
        db2[("DB2<br/>postings and balances")]:::sor
        adabas[("ADABAS<br/>customer master")]:::sor
        orchdb[("Transfer state<br/>synchronously replicated, RPO 0")]:::sor
        vault[("PII Vault<br/>raw PII + per-customer DEKs")]:::sor
    end

    subgraph log["DURABLE EVENT LOG"]
        bus["Event Backbone<br/>replication factor 3, acks=all<br/>30-day retention, replayable"]:::bus
    end

    subgraph derived["DERIVED, all rebuildable from the log"]
        cache[("Cache<br/>hours")]:::der
        rm[("Read Model<br/>90-day hot window")]:::der
        lake[("Analytics Lake<br/>13 months standard")]:::der
        arch[("Archive<br/>to 7 years, statutory")]:::der
        digest[("Spend Digest<br/>advisor input, tokenised")]:::der
    end

    db2 -->|log-based CDC| bus
    adabas -->|event replication or delta extract| bus
    orchdb -->|transfer lifecycle events| bus

    bus -->|idempotent projection<br/>by account and sequence number| rm
    bus --> lake
    rm --> cache
    lake -->|nightly| digest
    lake -->|lifecycle policy| arch

    vault -.->|per-customer key,<br/>destroyed on erasure| rm
    vault -.-> cache
    vault -.-> lake
    vault -.-> arch
    vault -.-> digest

    db2 -.->|nightly control-total<br/>reconciliation| rm

    classDef sor fill:#c62828,stroke:#8e0000,color:#fff
    classDef bus fill:#6a1b9a,stroke:#4a148c,color:#fff
    classDef der fill:#2e7d32,stroke:#1b5e20,color:#fff
```

Red is authoritative and irreplaceable. Green is derived and can be deleted and rebuilt at any
time — which is exactly why the read path can be optimised as aggressively as it is. The purple
log is the hinge: it is what makes the green boxes reconstructible without ever asking the
mainframe a question.

The dotted lines from the vault are the erasure mechanism (§3.5.7). Every derived copy is
encrypted under the customer's own key, so destroying that one key renders all of them
unreadable at once — including backups and archives, which no row-level delete can reach.

---

## 4. Deployment and network topology

Trust boundaries, subnet tiers and the disaster recovery site.

```mermaid
flowchart TB
    internet(["Internet"]):::ext

    subgraph cloudvpc["CLOUD VPC, region inside the regulatory boundary"]
        subgraph pub["Public subnets, 3 AZs"]
            alb["Load Balancer + WAF"]:::svc
            nat["NAT Gateways"]:::svc
        end
        subgraph priv["Private application subnets, 3 AZs — no inbound from internet"]
            pods["Service containers<br/>autoscaling 2 to 45 nodes"]:::svc
        end
        subgraph iso["Isolated data subnets, 3 AZs — no route to NAT"]
            dbs[("Read model, cache,<br/>event mirror")]:::store
        end
        pep["Private endpoints<br/>object storage, secrets, keys"]:::svc
    end

    subgraph dc1["ON-PREMISES DC1, production"]
        dmz1["DMZ<br/>link termination, reverse proxy"]:::dmz
        az1["Application zone<br/>orchestrator, fraud, consent,<br/>vault, event backbone"]:::svc
        cz1["Core zone<br/>ACL, HSM, CBS, DB2, ADABAS"]:::core
    end

    subgraph dc2["ON-PREMISES DC2, disaster recovery"]
        dmz2["DMZ"]:::dmz
        az2["Application zone, warm standby"]:::svc
        cz2["Core zone, standby"]:::core
    end

    internet -->|443 only| alb
    alb --> pods
    pods --> dbs
    pods --> pep
    pods --> nat
    nat -->|egress only| internet

    pods <-->|"mutual TLS over 2 dedicated links,<br/>diverse paths, VPN as third fallback"| dmz1
    dmz1 -->|firewall| az1
    az1 -->|"single admitted path:<br/>ACL only, whitelisted, quota'd"| cz1

    dc1 <-->|synchronous replication<br/>transfer state, RPO 0| dc2
    dmz2 -.->|failover only| pods

    classDef ext fill:#6e6e6e,stroke:#4a4a4a,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef dmz fill:#ef6c00,stroke:#b53d00,color:#fff
    classDef core fill:#c62828,stroke:#8e0000,color:#fff
```

The isolated data subnets have no route to a NAT gateway, so a compromised database cannot call
out. The core zone admits exactly one source — the anti-corruption layer — which is what
NFR-280 requires and what makes the mainframe cost controllable as well as secure.

---

## 5. Flow diagrams

### 5.1 View account information and balance — FR-010, FR-040

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API Gateway (cloud)
    participant BFF as BFF
    participant API as Account and Balance API
    participant $ as Cache
    participant RM as Read Model replica

    C->>GW: GET /v1/accounts/{id}/balance
    GW->>GW: validate token, rate limit
    GW->>BFF: authorised request
    BFF->>API: fetch balance + recent transactions
    API->>$: read by account key
    alt cache hit, ~85% of reads
        $-->>API: balance, last 50 txns
    else cache miss
        API->>RM: SELECT by customer_token
        RM-->>API: rows
        API->>$: populate
    end
    API-->>BFF: payload + as_of + freshness_seconds
    BFF-->>C: 200 OK, p95 55 ms

    Note over C,RM: The mainframe is not involved.<br/>No CBS operation is consumed.
```

### 5.2 Transfer with real-time fraud check — FR-050 to FR-080, FR-100

```mermaid
sequenceDiagram
    autonumber
    actor C as Customer
    participant GW as API Gateway (cloud)
    participant O as Transfer Orchestrator (on-prem)
    participant F as Real-time Fraud Scorer
    participant ACL as Anti-Corruption Layer
    participant CBS as CBS / DB2
    participant $ as Read Cache
    participant B as Event Backbone

    C->>GW: POST /v1/transfers + Idempotency-Key
    GW->>GW: authN, step-up if above threshold
    GW->>O: transfer command (private link)
    O->>O: dedupe on idempotency key
    O->>O: persist ACCEPTED, replicated, RPO 0
    O->>F: score(features from cache)
    alt BLOCK
        F-->>O: BLOCK + reason_codes
        O->>B: fraud.verdict.v1
        O-->>C: 200 REJECTED_FRAUD + reason
    else ALLOW
        F-->>O: ALLOW, p99 under 80 ms
        O->>ACL: CoreTransferRequest + idempotency_key
        ACL->>CBS: exactly one CBS transaction
        CBS-->>ACL: cbs_transaction_id, sequence, balance
        ACL-->>O: committed
        O->>O: mark POSTED
        O->>$: write through, authoritative post-state
        O->>B: transfer.completed.v1
        O-->>C: 200 POSTED + new balance
    end

    Note over O,ACL: On timeout the Orchestrator never blindly retries.<br/>It queries the CBS by idempotency key and converges.
```

### 5.3 Offline fraud detection and compensating reversal — FR-110 to FR-130

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

    B->>OF: transaction.posted.v1 stream
    OF->>OF: score against full history,<br/>cross-account patterns, ML models
    OF->>B: fraud.verdict.v1 (OFFLINE)
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
    O->>B: transfer.completed.v1 (REVERSED)
    B->>N: notify
    N->>C: in-app + push: transaction cancelled
```

### 5.4 Open Banking request — FR-150 to FR-180

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

    Note over OBGW,RR: Dedicated ingress and dedicated replicas are a bulkhead:<br/>TPP load cannot degrade the bank's own customers,<br/>and never reaches the core.
```

### 5.5 AI advisor consultation — FR-190 to FR-210

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
        AD->>M: prompt = instructions + digest + question
        Note over AD,M: Tokenised only. No name, no account number,<br/>no raw transactions. Cached stable prefix.
        M-->>AD: advice
        AD-->>C: response, in-region inference
    end
```

### 5.6 GDPR erasure — FR-240, NFR-270

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
    CO->>V: delete record, DESTROY per-customer DEK
    V-->>CO: key destroyed, irreversible
    CO->>B: erasure.requested.v1
    par propagate to every store owner
        B->>RM: PII columns now unreadable
        B->>$: evict all keys for customer_token
        B->>L: unreadable, partitions rewritten on next compaction
        B->>B: tombstone on compacted topics
    end
    Note over V,L: Backups and archives are covered too —<br/>they were encrypted under the destroyed key.
    Note over CBS: The ledger keeps its legally required financial record,<br/>now bearing only a token that resolves to nothing.
    CO-->>C: erasure confirmed
```

---

## 6. Transfer state machine

The lifecycle FR-090 requires the customer to be able to see at any moment.

```mermaid
stateDiagram-v2
    [*] --> ACCEPTED: command persisted, replicated
    ACCEPTED --> SCORING: submit to fraud scorer
    SCORING --> REJECTED_FRAUD: BLOCK verdict
    SCORING --> QUEUED: core unavailable
    SCORING --> SUBMITTED: ALLOW verdict
    QUEUED --> SUBMITTED: core recovered, store-and-forward drains
    SUBMITTED --> POSTED: CBS commit confirmed
    SUBMITTED --> REJECTED_FUNDS: insufficient funds
    SUBMITTED --> INDETERMINATE: timeout, outcome unknown
    INDETERMINATE --> POSTED: reconciliation by idempotency key
    INDETERMINATE --> FAILED: reconciliation shows no posting
    POSTED --> REVERSED: offline fraud confirmed,<br/>compensating transaction posted
    REJECTED_FRAUD --> [*]
    REJECTED_FUNDS --> [*]
    FAILED --> [*]
    POSTED --> [*]
    REVERSED --> [*]

    note right of INDETERMINATE
        Never resolved by blind retry.
        A retry could double-post money.
    end note

    note right of QUEUED
        Why write-path submission stays
        available through a core outage.
    end note
```

---

## 7. Scaling and cost view

Why the read path scales out and the write path deliberately does not.

```mermaid
flowchart LR
    users(["1M users<br/>300K daily active"]):::person

    subgraph readpath["READ PATH — scales out freely"]
        r1["Peak 1,100 req/s"]:::svc
        r2["Stateless services<br/>2 to 45 nodes"]:::svc
        r3["Cache, 85% hit"]:::store
        r4["Read replicas,<br/>add without schema change"]:::store
    end

    subgraph writepath["WRITE PATH — deliberately throttled"]
        w1["Peak 80 tx/s"]:::svc
        w2["Token bucket toward the core<br/>excess queued, never dropped"]:::warn
        w3["ACL, single admitted path"]:::acl
    end

    cbs["CBS<br/>charged per operation"]:::legacy

    users --> r1 --> r2 --> r3 --> r4
    users --> w1 --> w2 --> w3 --> cbs

    r4 -.->|"0 CBS operations"| cbs

    classDef person fill:#08427b,stroke:#052e56,color:#fff
    classDef svc fill:#1168bd,stroke:#0b4884,color:#fff
    classDef store fill:#2e7d32,stroke:#1b5e20,color:#fff
    classDef warn fill:#ef6c00,stroke:#b53d00,color:#fff
    classDef acl fill:#c62828,stroke:#8e0000,color:#fff
    classDef legacy fill:#8b5a2b,stroke:#5c3c1d,color:#fff
```

| | Reads | Writes |
|---|---|---|
| Year-3 peak | 1,100 req/s | 80 tx/s |
| CBS operations per month | 0 | 20,000,000 |
| Scaling response | Add nodes and replicas | Throttle, queue, and buy mainframe capacity only if genuinely needed |
| Marginal cost of growth | Low, and elastic | High, and charged per operation |

The asymmetry in the right-hand column is the whole argument. Reads are free to grow; writes
cost money every time, so the architecture spends its effort keeping the write count equal to
the number of times a customer actually moves money — and no higher.

---

**Editing.** These are text; edit the fenced blocks and they re-render. Preview at
<https://mermaid.live>. For the Word submission, `node tools/build-submission.mjs` renders every
block to PNG and embeds it in a single document; see `tools/export-diagrams.md` in the
repository root.
