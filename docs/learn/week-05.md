# Week 05 — Network architecture


## Key concepts (my study notes)
- **Public vs. private cloud.** **VPC** = isolated private cloud; isolation via **subnets /
  VLAN / VPN**. **NAT** = private machines reach out without being reachable.
- Public vs. private subnets (only LB/gateway public). Operational models: centralized /
  distributed / mixed. **Scale up vs. out**; **NAU** limits.
- **VPC peering** (point-to-point) vs. **Transit Gateway** (hub). Keep high-throughput in one
  AZ to cut cost.

## What clicked
This is how "segregate the legacy core" (NFR-073) and "GDPR residency" (NFR-071) become
concrete — VPC design, private subnets, controlled cloud↔on-prem channel. Also a cost lever.

## Questions this raises for my NeoBank design
- Subnet layout; how is the mainframe channel segregated & audited (NFR-073)? → [hld.md §6](../solution/hld.md)
- Cloud↔mainframe connectivity: VPN vs. Direct Connect?
- Single VPC vs. multiple + Transit Gateway? Region for GDPR? → [D6](../solution/decisions.md)
