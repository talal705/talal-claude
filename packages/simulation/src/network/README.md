# Network lab engine

Pure TypeScript over the data types in `packages/contracts/src/network.ts`. No rendering, no
React, no DOM. Deterministic: the same topology and the same request always give the same result,
event for event.

## Nothing here touches a real network

Every router, cable, packet, address, name and ping exists only as data inside the simulator.
The engine imports nothing but the contracts package and its own files; it opens no socket, runs
no operating-system command and resolves no real name. `no-real-network.test.ts` checks this.
The virtual provider's addresses come from ranges reserved for shared address space
(100.64.0.0/10) and documentation (203.0.113.0/24), and its names end in `.test`, so nothing in a
lesson can be mistaken for, or sent to, a real destination.

## What is modelled

- **Devices and roles.** Provider, ONT, router, switch, access point, integrated fibre gateway
  (its own kind), wired client, Wi-Fi client. Each carries explicit roles, so a box that combines
  several still shows them separately. All devices are generic educational devices.
- **Links.** A cable carries frames when both ends are plugged in, both devices are on, and, for
  Ethernet, the cable passes its wiremap and suits the two ports. A fibre connector does not fit
  an RJ45 port and the reverse. A Wi-Fi client joins the powered access point whose network name
  and passphrase match its own.
- **Addressing.** Static settings as typed, or a DHCP lease from a server on the same local
  network. Leases are derived from the topology each time, in device order.
- **Forwarding.** ARP on the local network, a default gateway for everything else, NAT at the
  router's WAN side, a provider that carries packets to a small virtual internet with a DNS
  server and a name table.
- **Tests.** A virtual ping and a virtual name lookup. Each returns a journey: one event per
  step, ending at the exact place the packet stopped, with the reason. A reply is further events
  in the same journey.
- **Diagnostics.** `runConnectivity` reports why a test failed; `diagnoseNetwork` reports what is
  wrong with a topology without sending anything. Both word a fault the same way.

## Simplifications (stated to the learner where they matter)

- **Ethernet wiring.** T568A and T568B are both valid; neither is treated as faster or better.
  A cable passes on continuity and pairing, the way a wiremap tester judges it: a cable whose
  colours follow neither standard but whose pins and pairs are right passes, and says so. Which
  cable a link needs (straight-through or crossover) depends on the two ports' pin layouts;
  Auto-MDIX is a capability of an individual port. Generic devices here have it; a crossover
  lesson uses ports without it.
- **Cable category** (Cat 5e, 6, 6a) is recorded because the exercise asks the learner to choose
  one, but it never decides whether a link works here. Speed, length and interference are not
  modelled.
- **Open and short** are crimp faults a lesson places on a plug; a plug the learner arranges has
  swapped wires or split pairs at most.
- **Fibre.** A fibre cable is ready-made and either connected or not. Fibre termination is a
  different skill from crimping RJ45 and is not an exercise. Optical power, wavelengths and PON
  splitting are not modelled; the ONT simply passes frames between its fibre and Ethernet sides.
- **Wi-Fi.** Joining is by network name and passphrase only. No radio, channel, range, signal
  strength or security protocol.
- **DHCP.** No timers, renewals or leases that expire. A server hands out its range in order and
  skips addresses typed by hand on the same network. When a local router and the provider could
  both answer (the provider's cable in a LAN port), the local router answers.
- **ARP** is one question and one answer per hop; there is no cache. A duplicate address always
  stops the packet, where a real network would behave erratically.
- **Routing.** One default gateway per interface; no routing tables or protocols. A packet still
  being forwarded after 16 routing steps ends the simulation as incomplete.
- **NAT** is a single translation table per test: source address out, destination address back.
  No ports, no port forwarding, no unsolicited inbound traffic. With NAT off, the provider drops
  packets that carry a private source address.
- **DNS.** One virtual server with a fixed name table. A router does not act as a DNS proxy: a
  router with no DNS list of its own passes on the server it learned on its WAN side.
- **IPv4 only.** No IPv6, VLANs, spanning tree, firewalls or MAC addresses. A switch forwards
  along the one shortest path; loops between switches are not modelled.
- **Ping** is one request and one reply. No timing, loss or latency figures are produced.

## Files

| File | Purpose |
|---|---|
| `devices.ts` | Generic devices: ports, roles, default settings |
| `reducer.ts` | Actions, rejections, the port list for non-drag cabling, undo/redo, replay |
| `wiremap.ts` | Plug and cable checks |
| `links.ts` | Which links carry frames, and the graph they form |
| `addressing.ts` | Static addresses and DHCP leases |
| `connectivity.ts` | Ping and name lookup, hop by hop, as a journey |
| `faults.ts`, `diagnostics.ts` | Wording of every fault |
| `diagnose.ts` | Standing check of a topology |
| `text.ts`, `ip.ts` | Sentences in both languages; IPv4 arithmetic |
