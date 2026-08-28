# Week 13 — Observability, monitoring and logging

## Key concepts (my study notes)
- **Observability vs. monitoring.** Monitoring is passive and watches the state of *elements*;
  observability focuses on the state of the **system** and its ability to serve its purpose. It is
  proactive — it adds visibility where visibility is lacking, and links raw data to KPIs that stand
  for actual user experience.
- **Three building blocks:** **logs** (historical, establish context) · **metrics** (current state,
  pull/polling or pushed telemetry; drive most fault management because they're event-driven) ·
  **traces** (the path of one unit of work through the sequence of services).
- **Patterns:** **log aggregation** (every instance ships to a central server; searchable, alertable
  — and it needs real infrastructure) · **application metrics** (push or pull into a central metrics
  service) · **audit logging** (record user activity as a first-class record) · **distributed
  tracing** (each external request gets a unique ID carried across services, so you can see where
  the time actually went) · **exception tracking** · **health-check API** (a service can be *running*
  yet unable to serve — out of connections, say — so `/health` must be checked and the load balancer
  must stop routing to it).
- **Cloud-native logging:** logs must live **outside the node**. Containers are ephemeral — when the
  pod dies, so do its files. The application logs to **STDOUT/STDERR** and the *environment* decides
  where that goes; that also normalises logging across services written in different languages.
- **Business metrics, not just technical ones:** instrument the flows that matter to the business —
  sign-ups, orders placed — so monitoring reports the health of the business, not only the health of
  the servers.
- **Alert examples:** a service unresponsive for 1 minute · error responses above 1% of requests ·
  average response time on key endpoints above a threshold.

## What clicked
The brief asks for "monitoring metrics for technical **and business** insights", and this lesson is
what makes that a two-part requirement rather than a phrase. Technical telemetry answers *is the
platform up*; business telemetry answers *are transfers completing, are consents being granted, is
the advisor being used*. The design needs both, and they are not the same instrumentation.

**Health-check APIs** also sharpened the availability argument: a five-nines target is meaningless
if a stalled instance keeps receiving traffic because it is technically still running. Liveness and
readiness are part of how the number is achieved, not an operational detail.

Distributed tracing is the only way to defend the latency budget in §3.8 — a p95 of 55 ms
decomposed across gateway, BFF, cache and read model can only be verified per hop with trace IDs
propagated end to end.

And one constraint the design already carries becomes sharper here: telemetry must **never carry
personal data** (NFR-310). Logs, traces and metrics all leave the trust boundary, so they identify
the customer by token or not at all — otherwise crypto-shredding would have a hole in it.

## Questions this raises for my NeoBank design
- The four golden signals per service vs. the five SLIs — what's reported to whom? → [§2.2.1](../solution/hld.md)
- Trace-ID propagation across the private link and into the anti-corruption layer — does the mainframe hop stay visible? → [§3.7](../solution/hld.md)
- Log retention against GDPR: how long, and tokenised throughout? → [§3.5.7](../solution/hld.md)
- Alert thresholds that don't flood the on-call — which ones actually page a human? → [§3.7](../solution/hld.md)
- Audit logging is a regulatory obligation here, not a convenience — is it a separate immutable store? → [D10](../solution/decisions.md)
