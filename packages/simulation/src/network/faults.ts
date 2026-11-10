// Turns what the engine found (a link that is down, an interface without an address, a gateway
// nobody answers for) into the diagnostic that names the fault. Used by the connectivity tests
// and by the standing check of a topology, so both name a fault the same way.
import { networkTarget, type NetworkDevice, type NetworkDiagnostic, type NetworkState, type TutorTargetRef } from "@ytl/contracts";
import type { Addressing, Resolved } from "./addressing";
import { SYMPTOM, diagnostic, evidence, type Stamp } from "./diagnostics";
import { cidr, networkOf } from "./ip";
import { deviceOfNode, groupOfPort, nodeKey, type Graph, type Link, type NodeKey } from "./links";
import { L, fill, portLabel } from "./text";

export interface World {
  state: NetworkState;
  graph: Graph;
  addressing: Addressing;
  stamp: Stamp;
}

export const deviceIn = (world: World, id: string): NetworkDevice => world.state.devices.find((d) => d.id === id)!;

const endLabel = (world: World, end: Link["a"]) => {
  if (!end) return L("nothing", "ولا شي");
  const device = deviceIn(world, end.deviceId);
  const port = device.ports.find((p) => p.id === end.portId);
  return port ? portLabel(device, port) : device.name;
};

/** A link that does not carry frames, as a diagnostic. */
export function linkFault(world: World, link: Link): NetworkDiagnostic {
  const problem = link.problem!;
  const cableTarget = link.kind === "cable" ? networkTarget.cable(link.id) : networkTarget.wifiLink(link.a!.deviceId);
  const ends: TutorTargetRef[] = [link.a, link.b].flatMap((end) => (end?.portId ? [networkTarget.port({ deviceId: end.deviceId, portId: end.portId })] : []));
  switch (problem.code) {
    case "link_disconnected": {
      const plugged = problem.looseEnd === "a" ? link.b : link.a;
      const loose = problem.looseEnd === "both" ? "a" : problem.looseEnd;
      return diagnostic(
        {
          code: "link_disconnected",
          subject: link.id,
          observation: SYMPTOM.noReply,
          message:
            problem.looseEnd === "both"
              ? L("This cable is not plugged in at either end.", "هذا السلك مو موصّل من الطرفين.")
              : fill(L("One end of this cable is in {port}; the other end is not plugged in.", "طرف من هذا السلك في {port}، والطرف الثاني مو موصّل."), { port: endLabel(world, plugged) }),
          explanation: L("A link needs both ends plugged in. With one end loose, nothing travels over the cable.", "الوصلة تحتاج الطرفين موصّلين. إذا طرف واحد حر، ما يمشي شي في السلك."),
          evidence: [evidence("End A", "الطرف A", link.a ? endLabel(world, link.a).en : "loose"), evidence("End B", "الطرف B", link.b ? endLabel(world, link.b).en : "loose")],
          target: networkTarget.cableEnd(link.id, loose),
          related: [cableTarget, ...ends],
        },
        world.stamp,
      );
    }
    case "device_off": {
      const device = deviceIn(world, problem.deviceId);
      return diagnostic(
        {
          code: "device_off",
          subject: device.id,
          observation: SYMPTOM.noReply,
          message: fill(L("{device} is switched off.", "{device} مطفي."), { device: device.name }),
          explanation: L("A device that is off does not pass anything on, and its links are down.", "الجهاز المطفي ما يمرّر شي، ووصلاته تكون طافية."),
          target: networkTarget.device(device.id),
          related: [cableTarget],
        },
        world.stamp,
      );
    }
    case "cable_fault":
      return diagnostic(
        {
          code: "cable_fault",
          subject: link.id,
          observation: SYMPTOM.noReply,
          message: fill(L("This Ethernet cable fails its wiremap test. {summary}", "سلك الإيثرنت هذا ما نجح في فحص الأسلاك. {summary}"), { summary: problem.wiremap.summary }),
          explanation: L(
            "Each of the eight wires must reach the right pin at the other end, and the wires that carry one signal must be one twisted pair. Otherwise the link does not come up.",
            "كل سلك من الثمانية لازم يوصل للبن الصحيح في الطرف الثاني، والأسلاك اللي تشيل إشارة وحدة لازم تكون زوج مجدول واحد. غير كذا الوصلة ما تشتغل.",
          ),
          evidence: problem.wiremap.pins.filter((pin) => pin.status !== "ok").map((pin) => evidence(`Pin ${pin.pin}`, `البن ${pin.pin}`, pin.status, "ok")),
          target: cableTarget,
          related: ends,
        },
        world.stamp,
      );
    case "crossover_needed": {
      const kind = (which: string) => (which === "crossover" ? L("crossover", "كروس أوفر") : L("straight-through", "مباشر (سترايت)"));
      return diagnostic(
        {
          code: "crossover_needed",
          subject: link.id,
          observation: SYMPTOM.noReply,
          message: fill(L("These two ports need a {needs} cable, and this one is {has}.", "هذين المنفذين يحتاجون سلك {needs}، وهذا السلك {has}."), { needs: kind(problem.needs), has: kind(problem.has) }),
          explanation: L(
            "Two ports with the same pin layout send on the same pins, so a crossover cable is needed between them; ports with different layouts take a straight-through cable. A port with Auto-MDIX adapts to either, but neither of these two has it.",
            "منفذين بنفس ترتيب البنات يرسلون على نفس البنات، فيحتاجون سلك كروس أوفر بينهم. والمنافذ المختلفة تاخذ سلك مباشر. المنفذ اللي فيه Auto-MDIX يتأقلم مع النوعين، بس ولا واحد من هذين فيه.",
          ),
          evidence: [evidence("Cable", "السلك", problem.has, problem.needs)],
          target: cableTarget,
          related: ends,
        },
        world.stamp,
      );
    }
    case "wifi_not_joined": {
      const client = deviceIn(world, link.a!.deviceId);
      const why = {
        no_network_chosen: L("No Wi-Fi network has been chosen on it.", "ما انختار له شبكة واي فاي."),
        network_not_found: L("No powered access point offers the network name it is looking for.", "ما في أكسس بوينت شغّال يعرض اسم الشبكة اللي يدوّر عليها."),
        wrong_passphrase: L("The network exists, but the passphrase does not match.", "الشبكة موجودة، بس كلمة السر ما تطابق."),
      }[problem.why];
      return diagnostic(
        {
          code: "wifi_not_joined",
          subject: client.id,
          observation: SYMPTOM.noAddress,
          message: fill(L("{device} has not joined a Wi-Fi network. {why}", "{device} ما دخل شبكة واي فاي. {why}"), { device: client.name, why }),
          explanation: L("A Wi-Fi client joins the access point whose network name and passphrase both match its own.", "جهاز الواي فاي يدخل الأكسس بوينت اللي اسم شبكته وكلمة سره يطابقون اللي عنده."),
          evidence: [evidence("Network name", "اسم الشبكة", client.config.wifiClient?.ssid || "(none)")],
          target: networkTarget.setting(client.id, "wifiClient"),
          related: [networkTarget.device(client.id)],
        },
        world.stamp,
      );
    }
  }
}

/** The first thing wrong with the links at a place, or a "nothing is plugged in" fault when there is no link at all. */
export function linkFaultAt(world: World, node: NodeKey): NetworkDiagnostic {
  const down = world.graph.linksAt(node).find((link) => !link.up && link.problem);
  if (down) return linkFault(world, down);
  const device = deviceIn(world, deviceOfNode(node));
  const port = device.ports.find((p) => nodeKey(device.id, groupOfPort(device, p)) === node) ?? device.ports[0];
  const where = port ? portLabel(device, port) : device.name;
  return diagnostic(
    {
      code: "link_disconnected",
      subject: port ? `${device.id}/${port.id}` : device.id,
      observation: SYMPTOM.noReply,
      message: fill(L("Nothing is plugged into {port}.", "ما في شي موصّل في {port}."), { port: where }),
      explanation: L("Without a cable (or a Wi-Fi connection) the device is not part of any network.", "بدون سلك (أو اتصال واي فاي) الجهاز مو جزء من أي شبكة."),
      target: port ? networkTarget.port({ deviceId: device.id, portId: port.id }) : networkTarget.device(device.id),
    },
    world.stamp,
  );
}

/** The provider side cabled into a LAN port while the WAN port is empty. Null when that is not the case. */
export function wanLanSwapped(world: World, router: NetworkDevice): NetworkDiagnostic | null {
  if (!router.roles.includes("routing")) return null;
  const wanPort = router.ports.find((p) => p.role === "wan");
  if (!wanPort) return null;
  const wanNode = nodeKey(router.id, "wan");
  if (world.graph.linksAt(wanNode).some((link) => link.a && link.b)) return null;
  const lanSegment = world.graph.segment(nodeKey(router.id, "lan"));
  const provider = world.state.devices.find(
    (d) => d.id !== router.id && (d.kind === "isp" || d.kind === "ont") && (lanSegment.has(nodeKey(d.id, "bridge")) || lanSegment.has(nodeKey(d.id, "isp"))),
  );
  if (!provider) return null;
  const lanLink = world.graph.linksAt(nodeKey(router.id, "lan")).find((link) => [link.a, link.b].some((end) => end && end.deviceId !== router.id && world.graph.segment(end.node).has(nodeKey(provider.id, provider.kind === "isp" ? "isp" : "bridge"))) && link.up);
  const usedEnd = lanLink ? [lanLink.a, lanLink.b].find((end) => end?.deviceId === router.id) : undefined;
  const usedPort = router.ports.find((p) => p.id === usedEnd?.portId);
  return diagnostic(
    {
      code: "wan_lan_swapped",
      subject: router.id,
      observation: SYMPTOM.localOnly,
      message: fill(L("The cable from {provider} is in {used} of {router}. Its {wan} port is empty.", "السلك الجاي من {provider} موصّل في {used} في {router}. ومنفذ {wan} فاضي."), {
        provider: provider.name,
        used: usedPort?.label ?? "LAN",
        router: router.name,
        wan: wanPort.label,
      }),
      explanation: L(
        "A router connects two networks: the provider's side goes into WAN, your own devices go into LAN. With the provider's cable in a LAN port, the router has no way out to the internet.",
        "الراوتر يوصل بين شبكتين: جهة المزوّد تدخل في WAN، وأجهزتك تدخل في LAN. إذا سلك المزوّد في منفذ LAN، الراوتر ما عنده طريق للإنترنت.",
      ),
      evidence: [evidence("Provider cable is in", "سلك المزوّد موصّل في", usedPort?.label ?? "LAN", wanPort.label)],
      target: networkTarget.port({ deviceId: router.id, portId: wanPort.id }),
      related: usedPort ? [networkTarget.port({ deviceId: router.id, portId: usedPort.id })] : [],
    },
    world.stamp,
  );
}

/** Why this interface has no address. */
export function noAddressFault(world: World, resolved: Resolved): NetworkDiagnostic {
  const device = deviceIn(world, resolved.deviceId);
  if (!device.powered) return linkFault(world, { id: device.id, kind: "cable", a: null, b: null, up: false, problem: { code: "device_off", deviceId: device.id } });
  if (resolved.interface === "wan") {
    const swapped = wanLanSwapped(world, device);
    if (swapped) return swapped;
  }
  const setting = networkTarget.setting(device.id, `${resolved.interface}.mode`);
  switch (resolved.problem) {
    case "link_disconnected":
      return linkFaultAt(world, resolved.node);
    case "dhcp_disabled": {
      const server = deviceIn(world, resolved.problemDeviceId!);
      return diagnostic(
        {
          code: "dhcp_disabled",
          subject: device.id,
          observation: SYMPTOM.noAddress,
          message: fill(L("{device} asks for an address automatically, but DHCP is switched off on {server}.", "{device} يطلب عنوان تلقائي، بس DHCP مقفل في {server}."), { device: device.name, server: server.name }),
          explanation: L(
            "A device set to automatic gets its address, mask, gateway and DNS from a DHCP server on its network. With the server off, either switch it on or type the settings by hand.",
            "الجهاز المضبوط على تلقائي ياخذ العنوان والقناع والبوابة و DNS من خادم DHCP في شبكته. إذا الخادم مقفل، يا تشغّله يا تكتب الإعدادات يدوي.",
          ),
          evidence: [evidence("DHCP server", "خادم DHCP", "off", "on")],
          target: networkTarget.setting(server.id, "dhcp.enabled"),
          related: [setting],
        },
        world.stamp,
      );
    }
    case "dhcp_pool_exhausted": {
      const server = deviceIn(world, resolved.problemDeviceId!);
      return diagnostic(
        {
          code: "dhcp_pool_exhausted",
          subject: device.id,
          observation: SYMPTOM.noAddress,
          message: fill(L("{server} has no free address left to give {device}.", "{server} ما بقى عنده عنوان فاضي يعطيه لـ {device}."), { device: device.name, server: server.name }),
          explanation: L("A DHCP server hands out addresses from a fixed range. When every address in the range is in use, the next device gets none.", "خادم DHCP يوزّع عناوين من نطاق محدد. إذا كل عناوين النطاق مستخدمة، الجهاز اللي بعده ما ياخذ شي."),
          target: networkTarget.setting(server.id, "dhcp.pool"),
          related: [setting],
        },
        world.stamp,
      );
    }
    case "dhcp_no_server":
      return diagnostic(
        {
          code: "dhcp_no_server",
          subject: device.id,
          observation: SYMPTOM.noAddress,
          message: fill(L("{device} asks for an address automatically, but no DHCP server is on its network.", "{device} يطلب عنوان تلقائي، بس ما في خادم DHCP في شبكته."), { device: device.name }),
          explanation: L("A DHCP request only reaches devices on the same local network. If no router or provider answers there, the device stays without an address.", "طلب DHCP يوصل بس للأجهزة اللي في نفس الشبكة المحلية. إذا ما رد عليه راوتر أو مزوّد هناك، الجهاز يبقى بدون عنوان."),
          target: setting,
        },
        world.stamp,
      );
    default:
      return diagnostic(
        {
          code: "no_address",
          subject: `${device.id}/${resolved.interface}`,
          observation: SYMPTOM.noAddress,
          message: fill(L("{device} has no IPv4 address set.", "{device} ما انضبط له عنوان IPv4."), { device: device.name }),
          explanation: L("To send anything, an interface needs an address and a mask, typed by hand or received from DHCP.", "عشان يرسل أي شي، المنفذ يحتاج عنوان وقناع، يدوي أو من DHCP."),
          target: setting,
        },
        world.stamp,
      );
  }
}

/** A routing interface on the same local network as `host`, if there is one: what its gateway should be. */
export function localRouter(world: World, host: Resolved): Resolved | undefined {
  const segment = world.graph.segment(host.node);
  return world.addressing.onSegment(segment).find((r) => r.deviceId !== host.deviceId && (r.interface === "lan" || r.interface === "isp") && r.ip !== undefined);
}

/** The host's address does not belong to the router's network. Null when it does, or when there is no router to compare with. */
export function subnetMismatch(world: World, host: Resolved): NetworkDiagnostic | null {
  const router = localRouter(world, host);
  if (!router || host.ip === undefined || host.prefix === undefined) return null;
  if (host.prefix === router.prefix && networkOf(host.ip, host.prefix) === networkOf(router.ip!, router.prefix!)) return null;
  const device = deviceIn(world, host.deviceId);
  const routerDevice = deviceIn(world, router.deviceId);
  const sameNumbers = networkOf(host.ip, router.prefix!) === networkOf(router.ip!, router.prefix!);
  return diagnostic(
    {
      code: "subnet_mismatch",
      subject: device.id,
      observation: SYMPTOM.noReply,
      message: sameNumbers
        ? fill(L("{device} uses the mask {mask}, but this network's mask is {expected}.", "{device} يستخدم القناع {mask}، بس قناع هذي الشبكة {expected}."), { device: device.name, mask: host.mask!, expected: router.mask! })
        : fill(L("{device} has the address {address}, which is not in this network ({network}).", "{device} عنوانه {address}، وهذا مو من هذي الشبكة ({network})."), {
            device: device.name,
            address: cidr(host.address!, host.mask),
            network: cidr(router.address!, router.mask),
          }),
      explanation: L(
        "The mask says which part of an address names the network. Two devices talk directly only when that part is the same for both; otherwise each thinks the other is somewhere else.",
        "القناع يحدد أي جزء من العنوان هو اسم الشبكة. جهازين يكلّمون بعض مباشرة بس إذا هذا الجزء نفسه عند الاثنين. غير كذا كل واحد يحسب الثاني في مكان ثاني.",
      ),
      evidence: [evidence("This device", "هذا الجهاز", cidr(host.address!, host.mask)), evidence(routerDevice.name.en, routerDevice.name.ar, cidr(router.address!, router.mask))],
      target: networkTarget.setting(device.id, `${host.interface}.${sameNumbers ? "mask" : "address"}`),
      related: [networkTarget.setting(routerDevice.id, "lan.address")],
    },
    world.stamp,
  );
}

/** Why the host's gateway cannot be used: missing, in another subnet, not the router's address, or nobody there. */
export function gatewayFault(world: World, host: Resolved): NetworkDiagnostic {
  const device = deviceIn(world, host.deviceId);
  const target = networkTarget.setting(device.id, `${host.interface}.gateway`);
  const mismatch = subnetMismatch(world, host);
  if (mismatch) return mismatch;
  const router = localRouter(world, host);
  const rule = L(
    "Anything addressed outside your own network is handed to the gateway, which must be the router's address on your network.",
    "أي شي رايح برّا شبكتك ينعطى للبوابة، والبوابة لازم تكون عنوان الراوتر في شبكتك.",
  );
  if (host.gatewayIp === undefined) {
    return diagnostic(
      {
        code: "gateway_missing",
        subject: device.id,
        observation: SYMPTOM.localOnly,
        message: fill(L("{device} has no gateway set, so it cannot send anything outside its own network.", "{device} ما انضبطت له بوابة، فما يقدر يرسل شي برّا شبكته."), { device: device.name }),
        explanation: rule,
        evidence: [evidence("Gateway", "البوابة", "(none)", router?.address)],
        target,
      },
      world.stamp,
    );
  }
  if (router && router.ip !== host.gatewayIp) {
    return diagnostic(
      {
        code: "gateway_wrong",
        subject: device.id,
        observation: SYMPTOM.localOnly,
        message: fill(L("{device} uses {gateway} as its gateway, but no device has that address. The router here is {router}.", "{device} بوابته {gateway}، بس ما في جهاز بهذا العنوان. الراوتر هنا عنوانه {router}."), {
          device: device.name,
          gateway: host.gateway!,
          router: router.address!,
        }),
        explanation: rule,
        evidence: [evidence("Gateway", "البوابة", host.gateway!, router.address)],
        target,
        related: [networkTarget.setting(router.deviceId, "lan.address")],
      },
      world.stamp,
    );
  }
  return diagnostic(
    {
      code: "gateway_unreachable",
      subject: device.id,
      observation: SYMPTOM.localOnly,
      message: fill(L("Nothing on {device}'s network answers for its gateway {gateway}.", "ما في شي في شبكة {device} يرد على بوابته {gateway}."), { device: device.name, gateway: host.gateway! }),
      explanation: rule,
      evidence: [evidence("Gateway", "البوابة", host.gateway!)],
      target,
    },
    world.stamp,
  );
}

/** Two or more interfaces on one local network with the same address. */
export function duplicateFault(world: World, first: Resolved, others: Resolved[]): NetworkDiagnostic {
  const devices = [first, ...others].map((r) => deviceIn(world, r.deviceId));
  return diagnostic(
    {
      code: "duplicate_address",
      subject: `${first.address}@${[first, ...others].map((r) => r.deviceId).sort().join("+")}`,
      observation: L("The connection works one moment and not the next, or answers come from the wrong device.", "الاتصال يشتغل مرة ومرة لا، أو الرد يجي من جهاز غلط."),
      message: fill(L("{a} and {b} both use the address {address}.", "{a} و {b} يستخدمون نفس العنوان {address}."), { a: devices[0].name, b: devices[1].name, address: first.address! }),
      explanation: L(
        "Every device on a network needs its own address. When two share one, the others cannot tell which of them a packet is for.",
        "كل جهاز في الشبكة يحتاج عنوان خاص فيه. إذا جهازين لهم نفس العنوان، الباقين ما يعرفون الباكت لأي واحد منهم.",
      ),
      evidence: devices.map((d) => evidence(d.name.en, d.name.ar, first.address!)),
      target: networkTarget.setting(first.deviceId, `${first.interface}.address`),
      related: others.map((r) => networkTarget.setting(r.deviceId, `${r.interface}.address`)),
    },
    world.stamp,
  );
}

/** Other interfaces on the same local network that have this interface's address. */
export function duplicatesOf(world: World, resolved: Resolved): Resolved[] {
  if (resolved.ip === undefined) return [];
  const segment = world.graph.segment(resolved.node);
  return world.addressing.onSegment(segment).filter((r) => r !== resolved && r.ip === resolved.ip && !(r.deviceId === resolved.deviceId && r.interface === resolved.interface));
}
