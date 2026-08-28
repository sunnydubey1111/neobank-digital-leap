# Week 06 — Data streaming

## Key concepts (my study notes)
- **Message vs. event.** A *message* is data sent to a **specific address** (the sender knows the
  recipient). An *event* is data **emitted for anyone listening** (the emitter does not know who
  consumes it). Both are asynchronous, both decouple — but only one names a destination.
- **Message broker:** validation, transformation, routing; decouples endpoints. **Message queue:**
  each message consumed **once** by a single consumer, then acknowledged and deleted.
  Producer → queue → consumer; **AMQP** as the protocol.
- **Pub/sub vs. queue:** in a queue the message is gone once *any* consumer takes it; in pub/sub it
  survives until *all* subscribers have had it.
- **Event streaming:** an ordered, time-sequenced, **replayable log**. Consumers don't subscribe —
  they read from any position and **advance their own offset**. SEP / CEP / **ESP** (collect,
  enhance, analyze, dispatch; Kafka as the platform).
- **Topologies:** **mediator** (queue + mediator orchestrates multi-step processing) vs. **broker**
  (no mediator, processors chain by publishing new events).

## What clicked
The distinction between *queue* and *stream* is the whole reason the design has a replayable log
rather than a work queue. Consumer-controlled offsets are what make the read model, analytics lake
and offline fraud pipeline independent of each other and rebuildable — if it were a queue, the
first consumer would take the event and the others would never see it.

Mediator vs. broker topology also named something I'd already chosen without a word for it: the
Transfer Orchestrator is a **mediator** (money movement needs coordinated steps and a known
outcome), while everything downstream of the log is **broker** style.

## Questions this raises for my NeoBank design
- Retention on the log — long enough to rebuild a projection from scratch? → [§3.5.2](../solution/hld.md), [D8](../solution/decisions.md)
- Ordering guarantee per account, and what the partition key should be → [§3.4](../solution/hld.md)
- Consumer lag: what's the alarm threshold before the read model is visibly stale? → [D5](../solution/decisions.md)
- Schema evolution on events consumed by three different projections → NFR-320
