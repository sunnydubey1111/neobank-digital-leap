# Week 09 — Security architecture

## Key concepts (my study notes)
- **Bugs vs. flaws.** Bugs are implementation defects — code review and scanners find them. **Flaws
  are design defects, and no amount of code review will find them.** Security architecture exists
  to catch the second kind.
- **Finding flaws:** analyse the design principles, assess the **attack surface**, enumerate
  **threat agents**, identify gaps in controls.
- **Process phases:** Architecture Risk Assessment → security architecture and design →
  implementation → operations and monitoring.
- **Frameworks:** **TOGAF** (what problem is being solved, scope and goals) · **SABSA**
  (policy-driven — who, what, when, why) · **OSA** (control and component patterns, useful once the
  architecture already exists).
- **CIA:** **confidentiality** (unreadable to those who shouldn't read it) · **integrity** (the
  system behaves exactly as expected; compromised output causes loss) · **availability** (DoS makes
  the service useless even without reading or changing anything).
- **Cloud threats:** **insider threats** — including the *provider's* administrators, not only your
  own staff — and **DoS**, deflected at the perimeter and by shifting traffic.
- **Secure SDLC:** security requirements written *alongside* functional ones; risk analysis in the
  design phase; **SAST** (scans your source, no running app needed) and **SCA** (open-source
  dependencies, transitive ones included, plus licence risk); automated security tests gating
  deployment; impact analysis of patches after release.
- **Cost curve:** roughly **$100** to fix at requirements, **$1,500** in QA, **$10,000** in
  production. Design-time is the cheapest place to be right.

## What clicked
"Flaws cannot be found by code review" is the sentence that justifies the whole threat-modelling
section of the HLD. Whether every money movement must be a CBS transaction, or whether the read
path may reach the core, are decisions no linter will ever question — they have to be fixed in the
design or not at all.

**Insider threat including the cloud provider's own administrators** is what makes the PII Vault
on-premises rather than a managed cloud secrets service, and why the tokenisation boundary is
absolute: if only tokens ever leave the vault, a provider-side compromise yields pseudonymous data.

CIA also maps cleanly onto three requirements I'd been treating separately — confidentiality is the
token boundary and encryption, integrity is the ledger being append-only and idempotency on the
transfer path, and availability is the five-nines target and the DoS controls at the edge.

## Questions this raises for my NeoBank design
- Formal threat model per trust boundary — is STRIDE enough, or does the money path need its own? → [§3.6](../solution/hld.md)
- Where SAST/SCA sit in the pipeline, and what fails a build → [D1](../solution/decisions.md)
- Key management for the per-customer vault keys: HSM, rotation, and who can authorise destruction → [D10](../solution/decisions.md)
- Open Banking is deliberate exposure of customer data — what's the abuse case, and what quota stops it? → [§3.3.4](../solution/hld.md)
