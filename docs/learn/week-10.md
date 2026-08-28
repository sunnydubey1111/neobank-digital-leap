# Week 10 — DevOps architecture

## Key concepts (my study notes)
- **DevOps is a culture, not a job title or a toolchain.** Engineer empowerment across the whole
  lifecycle (dev → test → deploy → monitor), test-driven development, automate everything
  automatable, monitor deliberately (**don't flood with metrics and alerts**), and provide
  self-service so the platform team never becomes the bottleneck.
- **Waterfall vs. Agile:** waterfall finishes each phase before the next and breaks when
  requirements move; agile delivers small increments and re-evaluates continuously. DevOps adds
  the delivery machinery on top of agile.
- **Continuous integration:** merge to a shared trunk several times a day, each integration
  verified by automated build and tests. Small changes make the culprit easy to find.
- **Branching models:** **feature branch** (isolated work, pull requests as the review point) ·
  **trunk-based** (short-lived branches, small frequent merges — keeps releases flowing as team
  size grows) · **Gitflow** (long-lived branches for develop/release/hotfix; more coordination,
  more drift, more merge risk).
- **Continuous delivery:** the release process itself is automated, so deploying is a decision
  rather than a project. Deploy small batches early — they're the ones you can troubleshoot.
- **One consistent artifact** through every phase — built once, stored in an artifact repository,
  and the *same* artifact promoted through test to production. Containers make that artifact
  self-describing: Dockerfile → image (read-only template) → container.
- **Two properties of a good delivery flow:** deploy **quickly** (do tests and verification offline,
  before rollout, so rollout is short and abortable) and deploy **safely** (bring new instances up
  and verify them *before* taking old ones down — otherwise you cut availability while you deploy).
- **The loop:** plan → code → build → test → release → deploy → operate → monitor.

## What clicked
"Deploy safely" is the concrete reason the design specifies rolling deploys with surge capacity
rather than replace-in-place. With a 99.999% target there is no budget for losing half the fleet
during a routine release — the deployment strategy is part of the availability argument, not an
operational afterthought.

The **one-artifact** rule is also why the design insists that pre-production be topologically
identical to production. If the artifact is promoted unchanged but the environment differs, the
testing proved less than it appears to.

And "don't flood with metrics and alerts" is a genuine constraint on the monitoring requirement —
the brief asks for technical *and* business insight, which is an argument for a small number of
meaningful indicators rather than a wall of dashboards.

## Questions this raises for my NeoBank design
- Deployment strategy per tier: rolling for stateless cloud services, but what for the on-premises orchestrator? → [§3.7](../solution/hld.md)
- Release cadence against "weeks to launch a new channel" — what actually gates a release? → [hld.md §5](../solution/hld.md)
- Schema changes on the read model without downtime — expand-and-contract, and how rollback works → [§3.7](../solution/hld.md)
- 60 developers across 8 streams: trunk-based, or feature branches with review? → [D1](../solution/decisions.md)
- The mainframe cannot be redeployed on this cadence — where exactly does the pipeline stop? → [D3](../solution/decisions.md)
