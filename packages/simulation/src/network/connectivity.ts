// Virtual ping and virtual name lookup. A packet is walked hop by hop through the topology as it
// is; every step becomes a journey event, and the walk stops at the exact place the packet stops,
// with the reason. Nothing here touches a real network: addresses and names exist only as data
// in the topology.
import {
  networkTarget,
  type ConnectivityRequest,
  type ConnectivityResult,
  type Journey,
  type JourneyEvent,
  type Localized,
  type NetworkDevice,
  type NetworkDiagnostic,
  type NetworkEvaluationContext,
  type NetworkState,
} from "@ytl/contracts";
import { publicInterfaces, resolveAddressing, type InterfaceName, type Resolved } from "./addressing";
import { SYMPTOM, diagnostic, evidence, stamper } from "./diagnostics";
import { deviceIn, duplicateFault, duplicatesOf, gatewayFault, linkFaultAt, noAddressFault, type World } from "./faults";
import { formatIpv4, parseIpv4, sameSubnet } from "./ip";
import { buildGraph, type Hop } from "./links";
import { L, fill } from "./text";

/** A packet that is still being forwarded after this many routing steps is in a loop. */
export const HOP_LIMIT = 16;

export function makeWorld(state: NetworkState, context: NetworkEvaluationContext = {}): World {
  const graph = buildGraph(state);
  return { state, graph, addressing: resolveAddressing(state, graph), stamp: stamper(context) };
}

interface Trace {
  events: JourneyEvent[];
  node(deviceId: string, result: JourneyEvent["result"], message: Localized, reason?: Localized): void;
  hop(hop: Hop): void;
}

function createTrace(world: World): Trace {
  const events: JourneyEvent[] = [];
  const next = () => `e${events.length + 1}`;
  return {
    events,
    node(deviceId, result, message, reason) {
      events.push({ id: next(), at: { kind: "node", nodeId: deviceId }, result, message, ...(reason ? { reason } : {}), target: world.stamp(networkTarget.device(deviceId)) });
    },
    hop(hop) {
      const from = deviceIn(world, hop.from.deviceId);
      const to = deviceIn(world, hop.to.deviceId);
      const wireless = hop.link.kind === "wifi";
      const fibre = !wireless && world.state.cables.find((c) => c.id === hop.link.id)?.medium === "fiber";
      events.push({
        id: next(),
        at: { kind: "link", linkId: hop.link.id, fromNodeId: from.id, toNodeId: to.id },
        result: "ok",
        message: wireless
          ? fill(L("It travels over Wi-Fi from {from} to {to}.", "يمشي بالواي فاي من {from} إلى {to}."), { from: from.name, to: to.name })
          : fibre
            ? fill(L("It travels as light through the fibre from {from} to {to}.", "يمشي كضوء في الألياف من {from} إلى {to}."), { from: from.name, to: to.name })
            : fill(L("It travels over the Ethernet cable from {from} to {to}.", "يمشي في سلك الإيثرنت من {from} إلى {to}."), { from: from.name, to: to.name }),
        target: world.stamp(wireless ? networkTarget.wifiLink(hop.link.a!.deviceId) : networkTarget.cable(hop.link.id)),
      });
    },
  };
}

interface NatEntry {
  routerId: string;
  inside: number;
  outside: number;
}

interface Packet {
  /** What it is, for the sentences: "The ping", "The reply". */
  what: Localized;
  from: { deviceId: string; interface: InterfaceName };
  src: number;
  dst: number;
  nat: NatEntry[];
  /** A router passed it on without translating its private source address. */
  untranslatedAt?: string;
}

type Delivery =
  | { ok: true; at: { deviceId: string; interface: InterfaceName }; src: number; dst: number }
  | { ok: false; diagnostic: NetworkDiagnostic; incomplete?: boolean };

const virtualHosts = (isp: NetworkDevice): number[] => {
  const config = isp.config.isp!;
  return [config.dnsAddress, ...config.hosts, ...config.dnsRecords.map((r) => r.address)].map(parseIpv4).filter((ip): ip is number => ip !== null);
};

/** Walks one packet from its sender to wherever it ends up. Pushes every step into the trace. */
function forward(world: World, trace: Trace, packet: Packet): Delivery {
  let holder = packet.from;
  let { src, dst } = packet;
  const fail = (deviceId: string, found: NetworkDiagnostic, message: Localized, incomplete = false): Delivery => {
    trace.node(deviceId, "failed", message, found.message);
    return { ok: false, diagnostic: found, incomplete };
  };

  for (let steps = 0; steps < HOP_LIMIT; steps += 1) {
    const device = deviceIn(world, holder.deviceId);
    const out = world.addressing.of(holder.deviceId, holder.interface);
    const stuck = fill(L("{what} cannot leave {device}.", "{what} ما يقدر يطلع من {device}."), { what: packet.what, device: device.name });
    if (!out || out.ip === undefined || out.prefix === undefined) {
      return fail(device.id, noAddressFault(world, out ?? ({ deviceId: device.id, interface: holder.interface, source: "none", node: "" } as Resolved)), stuck);
    }
    const twins = duplicatesOf(world, out);
    if (twins.length) return fail(device.id, duplicateFault(world, out, twins), stuck);

    // Local or through the gateway?
    const direct = sameSubnet(dst, out.ip, out.prefix);
    if (!direct && (out.gatewayIp === undefined || !sameSubnet(out.gatewayIp, out.ip, out.prefix))) {
      if (holder.interface === "wan" || holder.interface === "isp") return fail(device.id, noRoute(world, device, dst), stuck);
      return fail(device.id, gatewayFault(world, out), stuck);
    }
    const nextHop = direct ? dst : out.gatewayIp!;
    trace.node(
      device.id,
      "info",
      direct
        ? fill(L("{device} sees that {dst} is on its own network and asks who has that address (ARP).", "{device} يشوف إن {dst} في نفس شبكته، ويسأل: مين عنده هذا العنوان؟ (ARP)."), { device: device.name, dst: formatIpv4(dst) })
        : fill(L("{device} sees that {dst} is outside its network, so it asks who has its gateway {gateway} (ARP).", "{device} يشوف إن {dst} برّا شبكته، فيسأل: مين عنده البوابة {gateway}؟ (ARP)."), {
            device: device.name,
            dst: formatIpv4(dst),
            gateway: formatIpv4(nextHop),
          }),
    );
    const segment = world.graph.segment(out.node);
    if (segment.size === 1) return fail(device.id, linkFaultAt(world, out.node), stuck);
    const owners = world.addressing.onSegment(segment).filter((r) => r.ip === nextHop && !(r.deviceId === device.id && r.interface === holder.interface));
    if (owners.length === 0) {
      const nobody = fill(L("Nobody answers for {address}.", "ما أحد يرد على {address}."), { address: formatIpv4(nextHop) });
      if (!direct) return fail(device.id, gatewayFault(world, out), nobody);
      return fail(device.id, hostUnreachable(world, device, dst), nobody);
    }
    if (owners.length > 1) return fail(device.id, duplicateFault(world, owners[0], owners.slice(1)), fill(L("More than one device answers for {address}.", "أكثر من جهاز يرد على {address}."), { address: formatIpv4(nextHop) }));
    const owner = owners[0];

    // Across the local network, link by link.
    const hops = world.graph.path(out.node, owner.node) ?? [];
    hops.forEach((hop, index) => {
      trace.hop(hop);
      if (index === hops.length - 1) return;
      const between = deviceIn(world, hop.to.deviceId);
      trace.node(
        between.id,
        "ok",
        between.kind === "ont"
          ? fill(L("{device} converts between light and an Ethernet signal and passes it on.", "{device} يحوّل بين الضوء وإشارة الإيثرنت ويمرّره."), { device: between.name })
          : fill(L("{device} passes the frame on toward {next}.", "{device} يمرّر الفريم ناحية {next}."), { device: between.name, next: deviceIn(world, hops[index + 1].to.deviceId).name }),
      );
    });

    // At the next device.
    const here = deviceIn(world, owner.deviceId);
    const mapping = owner.interface === "wan" ? packet.nat.find((entry) => entry.routerId === here.id && entry.outside === dst) : undefined;
    if (mapping) {
      trace.node(
        here.id,
        "info",
        fill(L("{device} recognises the reply to a packet it translated, and puts the private address {inside} back as the destination (NAT).", "{device} يعرف إن هذا رد على باكت هو حوّله، فيرجّع العنوان الخاص {inside} كوجهة (NAT)."), {
          device: here.name,
          inside: formatIpv4(mapping.inside),
        }),
      );
      dst = mapping.inside;
      holder = { deviceId: here.id, interface: "lan" };
      continue;
    }
    if (world.addressing.all.some((r) => r.deviceId === here.id && r.ip === dst)) return { ok: true, at: { deviceId: here.id, interface: owner.interface }, src, dst };

    if (here.kind === "isp") {
      const isp = world.addressing.of(here.id, "isp")!;
      if (!sameSubnet(src, isp.ip!, isp.prefix!)) {
        const found = packet.untranslatedAt ? natDisabled(world, deviceIn(world, packet.untranslatedAt), src) : noRoute(world, here, src);
        return fail(here.id, found, fill(L("{device} drops {what}: its source address {src} is a private one the provider cannot answer.", "{device} يرمي {what}: عنوان المصدر {src} عنوان خاص المزوّد ما يقدر يرد عليه."), { device: here.name, what: packet.what, src: formatIpv4(src) }));
      }
      if (virtualHosts(here).includes(dst)) {
        trace.node(here.id, "ok", fill(L("{device} carries it into the virtual internet, to {dst}.", "{device} يوصّله للإنترنت الافتراضي، إلى {dst}."), { device: here.name, dst: formatIpv4(dst) }));
        return { ok: true, at: { deviceId: here.id, interface: "isp" }, src, dst };
      }
      if (!sameSubnet(dst, isp.ip!, isp.prefix!)) {
        return fail(here.id, hostUnreachable(world, here, dst), fill(L("There is no host {dst} in the virtual internet.", "ما في جهاز {dst} في الإنترنت الافتراضي."), { dst: formatIpv4(dst) }));
      }
      holder = { deviceId: here.id, interface: "isp" };
      continue;
    }

    if (here.roles.includes("routing")) {
      const lan = world.addressing.of(here.id, "lan");
      if (lan?.ip !== undefined && sameSubnet(dst, lan.ip, lan.prefix!)) {
        trace.node(here.id, "ok", fill(L("{device} routes it to its local network.", "{device} يوجّهه لشبكته المحلية."), { device: here.name }));
        holder = { deviceId: here.id, interface: "lan" };
        continue;
      }
      if (owner.interface === "wan") {
        return fail(here.id, noRoute(world, here, dst), fill(L("{device} has nowhere to send {what}.", "{device} ما عنده مكان يرسل له {what}."), { device: here.name, what: packet.what }));
      }
      const wan = world.addressing.of(here.id, "wan");
      if (!wan || wan.ip === undefined) {
        return fail(here.id, noAddressFault(world, wan ?? ({ deviceId: here.id, interface: "wan", source: "none", node: "" } as Resolved)), fill(L("{device} has no working connection on its internet side.", "{device} ما عنده اتصال شغّال من جهة الإنترنت."), { device: here.name }));
      }
      if (here.config.nat) {
        trace.node(
          here.id,
          "info",
          fill(L("{device} replaces the private source address {inside} with its own outside address {outside} (NAT) and sends it on.", "{device} يبدّل عنوان المصدر الخاص {inside} بعنوانه الخارجي {outside} (NAT) ويرسله."), {
            device: here.name,
            inside: formatIpv4(src),
            outside: wan.address!,
          }),
        );
        packet.nat.push({ routerId: here.id, inside: src, outside: wan.ip });
        src = wan.ip;
      } else {
        trace.node(here.id, "info", fill(L("{device} sends it on without changing its source address (NAT is off).", "{device} يرسله بدون ما يغيّر عنوان المصدر (NAT مقفل)."), { device: here.name }));
        packet.untranslatedAt = here.id;
      }
      holder = { deviceId: here.id, interface: "wan" };
      continue;
    }
    return fail(here.id, hostUnreachable(world, here, dst), fill(L("{device} is not the destination and does not forward packets.", "{device} مو هو الوجهة وما يمرّر باكتات."), { device: here.name }));
  }
  const device = deviceIn(world, holder.deviceId);
  const looping = diagnostic(
    {
      code: "hop_limit",
      subject: device.id,
      severity: "blocking",
      observation: SYMPTOM.noReply,
      message: fill(L("The packet was still being passed around after {limit} routing steps, so the simulation stopped.", "الباكت ظل يدور بعد {limit} خطوة توجيه، فوقّفنا المحاكاة."), { limit: HOP_LIMIT }),
      explanation: L("A packet that never arrives is usually going in a circle between routers that each think the other knows the way.", "الباكت اللي ما يوصل غالباً يدور بين راوترات كل واحد منهم يحسب الثاني يعرف الطريق."),
      target: networkTarget.device(device.id),
    },
    world.stamp,
  );
  return fail(device.id, looping, L("The simulation stops here.", "المحاكاة توقف هنا."), true);
}

function hostUnreachable(world: World, device: NetworkDevice, dst: number): NetworkDiagnostic {
  return diagnostic(
    {
      code: "host_unreachable",
      subject: formatIpv4(dst),
      observation: SYMPTOM.noReply,
      message: fill(L("No device has the address {dst}.", "ما في جهاز عنوانه {dst}."), { dst: formatIpv4(dst) }),
      explanation: L("A ping is answered only by the device that owns the address. Check the address you typed and the address of the device you meant.", "البنق يرد عليه بس الجهاز اللي له هذا العنوان. راجع العنوان اللي كتبته وعنوان الجهاز اللي تقصده."),
      evidence: [evidence("Destination", "الوجهة", formatIpv4(dst))],
      target: networkTarget.device(device.id),
    },
    world.stamp,
  );
}

function noRoute(world: World, device: NetworkDevice, dst: number): NetworkDiagnostic {
  return diagnostic(
    {
      code: "no_route",
      subject: `${device.id}>${formatIpv4(dst)}`,
      observation: SYMPTOM.noReply,
      message: fill(L("{device} has no route to {dst}.", "{device} ما عنده مسار إلى {dst}."), { device: device.name, dst: formatIpv4(dst) }),
      explanation: L("A router forwards a packet only if the destination is on one of its own networks or it has a gateway to hand it to.", "الراوتر يوجّه الباكت بس إذا الوجهة في وحدة من شبكاته أو عنده بوابة يعطيه لها."),
      evidence: [evidence("Destination", "الوجهة", formatIpv4(dst))],
      target: networkTarget.device(device.id),
    },
    world.stamp,
  );
}

function natDisabled(world: World, router: NetworkDevice, src: number): NetworkDiagnostic {
  return diagnostic(
    {
      code: "nat_disabled",
      subject: router.id,
      observation: SYMPTOM.localOnly,
      message: fill(L("NAT is off on {device}, so packets leave with the private address {src}, which the internet cannot reply to.", "NAT مقفل في {device}، فالباكتات تطلع بالعنوان الخاص {src}، والإنترنت ما يقدر يرد عليه."), { device: router.name, src: formatIpv4(src) }),
      explanation: L(
        "Private addresses are reused in every home, so they mean nothing outside it. The router swaps them for its one outside address on the way out and swaps back on the way in. That swap is NAT.",
        "العناوين الخاصة تتكرر في كل بيت، فما لها معنى برّاه. الراوتر يبدّلها بعنوانه الخارجي الوحيد وهي طالعة، ويرجّعها وهي راجعة. هذا التبديل هو NAT.",
      ),
      evidence: [evidence("NAT", "NAT", "off", "on")],
      target: networkTarget.setting(router.id, "nat"),
    },
    world.stamp,
  );
}

function dnsFault(world: World, device: NetworkDevice, code: "dns_not_configured" | "dns_unreachable" | "dns_name_unknown", name: string, server?: string): NetworkDiagnostic {
  const target = networkTarget.setting(device.id, "nic.dns");
  const rule = L(
    "A name is turned into an address by asking a DNS server. That is a separate step from reaching the address, which is why a number can work while a name does not.",
    "الاسم يتحوّل لعنوان بسؤال خادم DNS. وهذي خطوة غير الوصول للعنوان نفسه، عشان كذا ممكن الرقم يشتغل والاسم لا.",
  );
  if (code === "dns_not_configured") {
    return diagnostic(
      { code, subject: device.id, observation: SYMPTOM.nameFails, message: fill(L("{device} has no DNS server set, so it cannot look up {name}.", "{device} ما انضبط له خادم DNS، فما يقدر يدوّر على {name}."), { device: device.name, name }), explanation: rule, evidence: [evidence("DNS server", "خادم DNS", "(none)")], target },
      world.stamp,
    );
  }
  if (code === "dns_unreachable") {
    return diagnostic(
      { code, subject: device.id, observation: SYMPTOM.nameFails, message: fill(L("{device} asks {server} for the name, but no DNS server answers there.", "{device} يسأل {server} عن الاسم، بس ما في خادم DNS يرد هناك."), { device: device.name, server: server ?? "" }), explanation: rule, evidence: [evidence("DNS server", "خادم DNS", server ?? "")], target },
      world.stamp,
    );
  }
  return diagnostic(
    { code, subject: name, observation: SYMPTOM.nameFails, message: fill(L("The DNS server answers, but it has no record for {name}.", "خادم DNS يرد، بس ما عنده سجل للاسم {name}."), { name }), explanation: rule, evidence: [evidence("Name", "الاسم", name)], target: networkTarget.device(device.id) },
    world.stamp,
  );
}

export function runConnectivity(state: NetworkState, request: ConnectivityRequest, context: NetworkEvaluationContext = {}): ConnectivityResult {
  const world = makeWorld(state, context);
  const trace = createTrace(world);
  const journeyId = context.executionId ?? `${request.kind}:${request.fromDeviceId}>${request.kind === "ping" ? request.to : request.name}`;
  const finish = (outcome: Journey["outcome"], summary: Localized, diagnostics: NetworkDiagnostic[], resolvedAddress?: string): ConnectivityResult => ({
    request,
    succeeded: outcome === "delivered",
    ...(resolvedAddress ? { resolvedAddress } : {}),
    journey: { id: journeyId, events: trace.events, outcome, summary },
    diagnostics,
    interfaces: publicInterfaces(world.addressing),
  });
  const failed = (found: NetworkDiagnostic[], incomplete = false, resolvedAddress?: string) => finish(incomplete ? "incomplete" : "failed", found[0].message, found, resolvedAddress);

  const source = state.devices.find((d) => d.id === request.fromDeviceId);
  if (!source || !source.config.nic) {
    const missing = diagnostic(
      {
        code: source ? "not_supported" : "unknown_reference",
        subject: request.fromDeviceId,
        message: source ? fill(L("{device} cannot run this test. Run it from a computer or a phone.", "{device} ما يقدر يسوي هذا الاختبار. سوّه من كمبيوتر أو جوال."), { device: source.name }) : L("The device that should send the test does not exist.", "الجهاز اللي المفروض يرسل الاختبار مو موجود."),
        explanation: L("Connectivity tests start from a client device.", "اختبارات الاتصال تبدأ من جهاز عميل."),
        target: networkTarget.device(request.fromDeviceId),
      },
      world.stamp,
    );
    return failed([missing]);
  }
  const nic = world.addressing.of(source.id, "nic");

  /** Asks the DNS server for a name. Returns the address, or the diagnostics of the failure. */
  const lookup = (name: string): { address: number } | { diagnostics: NetworkDiagnostic[]; incomplete?: boolean } => {
    if (!nic || nic.ip === undefined) {
      const found = noAddressFault(world, nic ?? ({ deviceId: source.id, interface: "nic", source: "none", node: "" } as Resolved));
      trace.node(source.id, "failed", fill(L("{device} cannot look up {name}.", "{device} ما يقدر يدوّر على {name}."), { device: source.name, name }), found.message);
      return { diagnostics: [found] };
    }
    const server = parseIpv4(nic.dns?.[0]);
    if (server === null) {
      const found = dnsFault(world, source, "dns_not_configured", name);
      trace.node(source.id, "failed", fill(L("{device} cannot look up {name}.", "{device} ما يقدر يدوّر على {name}."), { device: source.name, name }), found.message);
      return { diagnostics: [found] };
    }
    trace.node(source.id, "info", fill(L("{device} needs the address of {name}, so it asks its DNS server {server}.", "{device} يحتاج عنوان {name}، فيسأل خادم DNS حقه {server}."), { device: source.name, name, server: formatIpv4(server) }));
    const nat: NatEntry[] = [];
    const query = forward(world, trace, { what: L("the DNS question", "سؤال DNS"), from: { deviceId: source.id, interface: "nic" }, src: nic.ip, dst: server, nat });
    if (!query.ok) return { diagnostics: [dnsFault(world, source, "dns_unreachable", name, formatIpv4(server)), query.diagnostic], incomplete: query.incomplete };
    const at = deviceIn(world, query.at.deviceId);
    const isDnsServer = at.kind === "isp" && parseIpv4(at.config.isp!.dnsAddress) === server;
    if (!isDnsServer) {
      const found = dnsFault(world, source, "dns_unreachable", name, formatIpv4(server));
      trace.node(at.id, "failed", fill(L("{device} receives the question, but it is not a DNS server.", "{device} يستلم السؤال، بس هو مو خادم DNS."), { device: at.name }), found.message);
      return { diagnostics: [found] };
    }
    const record = at.config.isp!.dnsRecords.find((r) => r.name.toLowerCase() === name.toLowerCase());
    const address = parseIpv4(record?.address);
    if (address === null) {
      const found = dnsFault(world, source, "dns_name_unknown", name);
      trace.node(at.id, "failed", fill(L("The DNS server looks for {name} in its table.", "خادم DNS يدوّر على {name} في جدوله."), { name }), found.message);
      return { diagnostics: [found] };
    }
    trace.node(at.id, "ok", fill(L("The DNS server finds {name}: its address is {address}.", "خادم DNS يلقى {name}: عنوانه {address}."), { name, address: formatIpv4(address) }));
    const answer = forward(world, trace, { what: L("the DNS answer", "جواب DNS"), from: query.at, src: server, dst: query.src, nat });
    if (!answer.ok) return { diagnostics: [answer.diagnostic], incomplete: answer.incomplete };
    trace.node(source.id, "ok", fill(L("{device} now knows that {name} is {address}.", "{device} الحين يعرف إن {name} هو {address}."), { device: source.name, name, address: formatIpv4(address) }));
    return { address };
  };

  if (!source.powered) {
    const off = noAddressFault(world, nic!);
    trace.node(source.id, "failed", fill(L("{device} cannot send anything.", "{device} ما يقدر يرسل شي."), { device: source.name }), off.message);
    return failed([off]);
  }

  if (request.kind === "lookup") {
    const answer = lookup(request.name);
    if ("diagnostics" in answer) return failed(answer.diagnostics, answer.incomplete);
    return finish("delivered", fill(L("{name} is {address}.", "{name} هو {address}."), { name: request.name, address: formatIpv4(answer.address) }), [], formatIpv4(answer.address));
  }

  let target = parseIpv4(request.to);
  let resolvedAddress: string | undefined;
  if (target === null) {
    const answer = lookup(request.to);
    if ("diagnostics" in answer) return failed(answer.diagnostics, answer.incomplete);
    target = answer.address;
    resolvedAddress = formatIpv4(target);
  }
  if (!nic || nic.ip === undefined) {
    const found = noAddressFault(world, nic ?? ({ deviceId: source.id, interface: "nic", source: "none", node: "" } as Resolved));
    trace.node(source.id, "failed", fill(L("{device} cannot send the ping.", "{device} ما يقدر يرسل البنق."), { device: source.name }), found.message);
    return failed([found], false, resolvedAddress);
  }
  trace.node(source.id, "ok", fill(L("{device} ({address}) sends a ping to {dst}.", "{device} ({address}) يرسل بنق إلى {dst}."), { device: source.name, address: nic.address!, dst: formatIpv4(target) }));
  const nat: NatEntry[] = [];
  const there = forward(world, trace, { what: L("the ping", "البنق"), from: { deviceId: source.id, interface: "nic" }, src: nic.ip, dst: target, nat });
  if (!there.ok) return failed([there.diagnostic], there.incomplete, resolvedAddress);
  const answerer = deviceIn(world, there.at.deviceId);
  trace.node(
    answerer.id,
    "ok",
    answerer.kind === "isp" && there.dst !== world.addressing.of(answerer.id, "isp")?.ip
      ? fill(L("The host {dst} in the virtual internet receives the ping and sends a reply to {src}.", "الجهاز {dst} في الإنترنت الافتراضي يستلم البنق ويرسل رد إلى {src}."), { dst: formatIpv4(there.dst), src: formatIpv4(there.src) })
      : fill(L("{device} receives the ping and sends a reply to {src}.", "{device} يستلم البنق ويرسل رد إلى {src}."), { device: answerer.name, src: formatIpv4(there.src) }),
  );
  const back = forward(world, trace, { what: L("the reply", "الرد"), from: there.at, src: there.dst, dst: there.src, nat });
  if (!back.ok) return failed([back.diagnostic], back.incomplete, resolvedAddress);
  trace.node(source.id, "ok", fill(L("{device} receives the reply.", "{device} يستلم الرد."), { device: source.name }));
  return finish("delivered", fill(L("{device} reached {dst} and got a reply.", "{device} وصل إلى {dst} وجاه الرد."), { device: source.name, dst: request.to }), [], resolvedAddress);
}
