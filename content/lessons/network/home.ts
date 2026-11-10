// Network lab, beginner: a first home network. One lesson, one Test Yourself challenge and one
// fault exercise. Device and cable IDs are the ones the engine assigns in creation order
// (asserted by the lesson tests). Tested by packages/curriculum/src/lessons.test.ts.
import { networkTarget, type NetworkAction } from "@ytl/contracts";
import type { Lesson, LessonExample } from "@ytl/curriculum";
import { network } from "@ytl/simulation";
import { L } from "../helpers";

const plug = (cableId: string, endId: "a" | "b", deviceId: string, portId: string): NetworkAction => ({ type: "connect_cable_end", cableId, endId, to: { deviceId, portId } });

const SKILLS = {
  "provider-path": L("Following the path from the provider to the router", "تتبّع الطريق من المزوّد للراوتر"),
  "wan-lan": L("Telling the WAN port from the LAN ports", "التفريق بين منفذ WAN ومنافذ LAN"),
  dhcp: L("Getting an address automatically (DHCP)", "أخذ عنوان تلقائي (DHCP)"),
  "connectivity-test": L("Testing a connection and reading the result", "اختبار الاتصال وقراءة النتيجة"),
  "fault-reasoning": L("Reasoning from a symptom to its cause", "الوصول من العَرَض للسبب"),
  gateway: L("Setting the right gateway", "ضبط البوابة الصحيحة"),
  wifi: L("Joining a Wi-Fi network", "الدخول لشبكة واي فاي"),
};

/** Provider, ONT, router and a computer on the table, with one fibre and two Ethernet cables, nothing plugged in. */
const UNCABLED: NetworkAction[] = [
  { type: "add_device", kind: "isp" },
  { type: "add_device", kind: "ont" },
  { type: "add_device", kind: "router" },
  { type: "add_device", kind: "wired_client" },
  { type: "add_cable", medium: "fiber" },
  { type: "add_cable", medium: "rj45" },
  { type: "add_cable", medium: "rj45" },
];

export const homeLesson: Lesson = {
  id: "network.beginner.first-home-network",
  version: 1,
  lab: "network",
  level: "beginner",
  kind: "lesson",
  title: L("Connect an ONT, a router and a computer", "وصّل ONT وراوتر وكمبيوتر"),
  summary: L(
    "Build the path from the virtual provider to a computer: fibre to the ONT, Ethernet to the router's WAN port, a LAN port to the computer. The computer then gets its address by itself. Everything here is simulated; no real device or address is contacted.",
    "ابنِ الطريق من المزوّد الافتراضي للكمبيوتر: ألياف للـ ONT، إيثرنت لمنفذ WAN في الراوتر، ومنفذ LAN للكمبيوتر. وبعدها الكمبيوتر ياخذ عنوانه لحاله. كل شي هنا محاكاة؛ ما نتصل بأي جهاز أو عنوان حقيقي.",
  ),
  outcome: L(
    "Given a provider, an ONT, a router and a computer, you cable them in the right order and ports so that the computer receives an address by DHCP and reaches a name on the virtual internet.",
    "إذا عندك مزوّد و ONT وراوتر وكمبيوتر، توصّلهم بالترتيب والمنافذ الصحيحة لين الكمبيوتر ياخذ عنوان بـ DHCP ويوصل لاسم في الإنترنت الافتراضي.",
  ),
  prerequisites: [],
  skills: SKILLS,
  start: { lab: "network", actions: UNCABLED },
  nextLessonId: "network.beginner.gateway-challenge",
  steps: [
    {
      id: "fibre",
      skill: "provider-path",
      goal: L("Connect the provider's fibre to the ONT.", "وصّل ألياف المزوّد بالـ ONT."),
      check: { type: "net.link", label: L("A working fibre link joins the provider and the ONT's PON port", "في وصلة ألياف شغّالة بين المزوّد ومنفذ PON في الـ ONT"), a: { kind: "isp", portRole: "fiber_drop" }, b: { kind: "ont", portRole: "pon" } },
      hints: [
        { text: L("The internet arrives as light in a glass fibre. Which box turns that light into something a router can use?", "الإنترنت يوصل كضوء في ليف زجاجي. أي جهاز يحوّل هذا الضوء لشي يقدر الراوتر يستخدمه؟") },
        { text: L("Find the fibre cable and the ONT's PON port.", "دوّر على سلك الألياف ومنفذ PON في الـ ONT."), target: networkTarget.port({ deviceId: "ont-1", portId: "pon" }) },
        { text: L("Plug one end of the fibre cable into the provider's fibre port and the other end into the ONT's PON port.", "وصّل طرف من سلك الألياف في منفذ الألياف عند المزوّد، والطرف الثاني في منفذ PON في الـ ONT."), target: networkTarget.port({ deviceId: "ont-1", portId: "pon" }) },
      ],
      explanation: L(
        "The ONT is where the provider's fibre ends. It turns light into an Ethernet signal and back. A fibre connector and an Ethernet plug are different shapes on purpose: neither fits the other's port.",
        "الـ ONT هو المكان اللي ينتهي فيه ليف المزوّد. يحوّل الضوء لإشارة إيثرنت والعكس. وفيشة الألياف وفيشة الإيثرنت شكلهم مختلف عن قصد: ولا وحدة تركب في منفذ الثانية.",
      ),
    },
    {
      id: "wan",
      skill: "wan-lan",
      goal: L("Connect the ONT to the router with an Ethernet cable, using the router port meant for the provider's side.", "وصّل الـ ONT بالراوتر بسلك إيثرنت، واستخدم منفذ الراوتر المخصص لجهة المزوّد."),
      prediction: {
        question: L("Which router port should the cable from the ONT go into?", "السلك الجاي من الـ ONT يدخل في أي منفذ بالراوتر؟"),
        options: [
          { id: "wan", text: L("WAN", "WAN") },
          { id: "lan", text: L("Any LAN port", "أي منفذ LAN") },
          { id: "either", text: L("It makes no difference", "ما تفرق") },
        ],
        correctOptionId: "wan",
        explanation: L("The router keeps two networks apart: the provider's side on WAN, your devices on LAN.", "الراوتر يفصل بين شبكتين: جهة المزوّد على WAN، وأجهزتك على LAN."),
      },
      check: { type: "net.link", label: L("A working Ethernet link joins the ONT and the router's WAN port", "في وصلة إيثرنت شغّالة بين الـ ONT ومنفذ WAN في الراوتر"), a: { kind: "ont", portRole: "uplink" }, b: { kind: "router", portRole: "wan" } },
      hints: [
        { text: L("A router has two sides. Which side faces the provider, and which faces your own devices?", "الراوتر له جهتين. أي جهة تواجه المزوّد، وأي جهة تواجه أجهزتك؟") },
        { text: L("Look at the labels on the router's ports. One port is different from the other four.", "شوف أسماء منافذ الراوتر. في منفذ واحد يختلف عن الأربعة الباقين."), target: networkTarget.port({ deviceId: "router-1", portId: "wan" }) },
        { text: L("Plug an Ethernet cable into the ONT's ETH port and into the router's WAN port.", "وصّل سلك إيثرنت في منفذ ETH في الـ ONT وفي منفذ WAN في الراوتر."), target: networkTarget.port({ deviceId: "router-1", portId: "wan" }) },
      ],
      explanation: L(
        "The router asks the provider for an outside address on its WAN port only. With the ONT in a LAN port the router has no way out, and your home network and the provider's network are mixed together.",
        "الراوتر يطلب عنوان خارجي من المزوّد على منفذ WAN بس. إذا الـ ONT في منفذ LAN، الراوتر ما عنده مخرج، وشبكة بيتك تختلط بشبكة المزوّد.",
      ),
      followUp: {
        goal: L("At a friend's home the cable from the ONT is in the router's LAN 2 port, and nothing outside the house loads. What do you change?", "في بيت صاحبك السلك الجاي من الـ ONT في منفذ LAN 2 بالراوتر، وما يفتح شي من برّا البيت. وش تغيّر؟"),
        options: [
          { id: "move-to-wan", text: L("Move that cable from LAN 2 to WAN", "أنقل السلك من LAN 2 إلى WAN") },
          { id: "restart", text: L("Switch the router off and on", "أطفي الراوتر وأشغّله") },
          { id: "new-cable", text: L("Replace the cable", "أبدّل السلك") },
        ],
        check: { type: "choice", label: L("Moves the provider's cable to the WAN port", "ينقل سلك المزوّد لمنفذ WAN"), correctOptionId: "move-to-wan" },
        hints: [
          { text: L("Which port does the router use to talk to the provider?", "أي منفذ يستخدمه الراوتر عشان يكلّم المزوّد؟") },
          { text: L("The cable is fine and the router is on. Look at where the cable is plugged in.", "السلك سليم والراوتر شغّال. شوف السلك موصّل وين.") },
          { text: L("The provider's cable belongs in WAN. In a LAN port the router never gets its outside address.", "سلك المزوّد مكانه WAN. في منفذ LAN الراوتر ما ياخذ عنوانه الخارجي أبداً.") },
        ],
        explanation: L("Nothing is broken; the cable is on the wrong side of the router. Restarting or replacing things does not move it.", "ما في شي خربان؛ السلك في الجهة الغلط من الراوتر. إعادة التشغيل أو التبديل ما ينقله."),
      },
    },
    {
      id: "computer",
      skill: "dhcp",
      goal: L("Connect the computer to the router and let it get an address automatically.", "وصّل الكمبيوتر بالراوتر وخلّه ياخذ عنوان تلقائي."),
      check: {
        type: "all",
        label: L("The computer is on the router's local network with an address from DHCP", "الكمبيوتر في شبكة الراوتر المحلية وعنده عنوان من DHCP"),
        of: [
          { type: "net.link", label: L("A working link joins the computer and one of the router's LAN ports", "في وصلة شغّالة بين الكمبيوتر ومنفذ LAN في الراوتر"), a: { kind: "wired_client", portRole: "nic" }, b: { kind: "router", portRole: "lan" } },
          { type: "net.address", label: L("The computer has an address it received by DHCP", "الكمبيوتر عنده عنوان أخذه بـ DHCP"), device: { kind: "wired_client" }, interface: "nic", source: "dhcp" },
        ],
      },
      hints: [
        { text: L("Nobody typed an address into the computer. Who could give it one?", "ما أحد كتب عنوان في الكمبيوتر. مين ممكن يعطيه عنوان؟") },
        { text: L("Use the last Ethernet cable and one of the router's LAN ports.", "استخدم سلك الإيثرنت الأخير ومنفذ من منافذ LAN في الراوتر."), target: networkTarget.port({ deviceId: "router-1", portId: "lan-1" }) },
        { text: L("Plug the cable into the computer's Ethernet port and into LAN 1 on the router. Leave the computer on automatic (DHCP); its address appears in the address table.", "وصّل السلك في منفذ الإيثرنت بالكمبيوتر وفي LAN 1 بالراوتر. خلّ الكمبيوتر على تلقائي (DHCP)؛ عنوانه يطلع في جدول العناوين."), target: networkTarget.port({ deviceId: "pc-1", portId: "eth0" }) },
      ],
      explanation: L(
        "The router runs a DHCP server on its LAN side. A device set to automatic asks on its local network, and the router answers with an address, a mask, the gateway (the router itself) and a DNS server.",
        "الراوتر يشغّل خادم DHCP على جهة LAN. الجهاز المضبوط على تلقائي يسأل في شبكته المحلية، والراوتر يرد عليه بعنوان، وقناع، وبوابة (الراوتر نفسه)، وخادم DNS.",
      ),
    },
    {
      id: "test",
      skill: "connectivity-test",
      goal: L("Check your work: the computer should reach school.test on the virtual internet.", "تأكد من شغلك: الكمبيوتر لازم يوصل إلى school.test في الإنترنت الافتراضي."),
      check: { type: "net.ping", label: L("A virtual ping from the computer to school.test gets a reply", "بنق افتراضي من الكمبيوتر إلى school.test يجيه رد"), from: { kind: "wired_client" }, to: "school.test", succeeds: true },
      hints: [
        { text: L("A name has to become an address before anything can be sent to it. Then the packet has to go out and the reply has to come back.", "الاسم لازم يتحوّل لعنوان قبل ما ينرسل له أي شي. وبعدين الباكت لازم يطلع والرد لازم يرجع.") },
        { text: L("Run a ping from the computer to school.test and play its journey step by step.", "سوّ بنق من الكمبيوتر إلى school.test وشغّل رحلته خطوة خطوة."), target: networkTarget.device("pc-1") },
        { text: L("If the journey stops, the last step names the device and the reason. Fix that link or setting and test again.", "إذا الرحلة وقفت، آخر خطوة تذكر الجهاز والسبب. صلّح هذي الوصلة أو الإعداد واختبر مرة ثانية."), target: networkTarget.device("pc-1") },
      ],
      explanation: L(
        "The journey shows each part doing its job: the computer asks the DNS server for the name, hands packets to its gateway, the router swaps the private address for its outside one (NAT), and the provider carries them to the virtual internet and back.",
        "الرحلة تبيّن كل جزء وهو يسوي شغله: الكمبيوتر يسأل خادم DNS عن الاسم، ويعطي الباكتات لبوابته، والراوتر يبدّل العنوان الخاص بعنوانه الخارجي (NAT)، والمزوّد يوصّلها للإنترنت الافتراضي ويرجّعها.",
      ),
    },
  ],
};

export const homeLessonExample: LessonExample = {
  lessonId: homeLesson.id,
  steps: [
    { stepId: "fibre", solution: { lab: "network", actions: [plug("cable-1", "a", "isp-1", "drop-1"), plug("cable-1", "b", "ont-1", "pon")] } },
    { stepId: "wan", solution: { lab: "network", actions: [plug("cable-2", "a", "ont-1", "eth"), plug("cable-2", "b", "router-1", "wan")] }, followUp: { lab: "choice", optionId: "move-to-wan" } },
    { stepId: "computer", solution: { lab: "network", actions: [plug("cable-3", "a", "router-1", "lan-1"), plug("cable-3", "b", "pc-1", "eth0")] } },
    { stepId: "test", solution: { lab: "network", actions: [] } },
  ],
};

export const gatewayChallenge: Lesson = {
  id: "network.beginner.gateway-challenge",
  version: 1,
  lab: "network",
  level: "beginner",
  kind: "challenge",
  title: L("Test yourself: get a phone online through a fibre gateway", "اختبر نفسك: وصّل جوال بالإنترنت عن طريق راوتر ألياف مدمج"),
  summary: L(
    "A provider, an integrated fibre gateway, a phone and one fibre cable. Nothing is connected. Get the phone to reach a name on the virtual internet, with no step-by-step guidance.",
    "مزوّد، وراوتر ألياف مدمج، وجوال، وسلك ألياف واحد. ولا شي موصّل. وصّل الجوال لاسم في الإنترنت الافتراضي، بدون إرشاد خطوة بخطوة.",
  ),
  outcome: L("Without guidance, you connect an integrated gateway to the provider and join a Wi-Fi client to it so that the client reaches a name on the virtual internet.", "بدون إرشاد، توصّل راوتر مدمج بالمزوّد وتدخّل جهاز واي فاي عليه لين يوصل لاسم في الإنترنت الافتراضي."),
  prerequisites: [homeLesson.id],
  skills: SKILLS,
  start: { lab: "network", actions: [{ type: "add_device", kind: "isp" }, { type: "add_device", kind: "fiber_gateway" }, { type: "add_device", kind: "wifi_client" }, { type: "add_cable", medium: "fiber" }] },
  nextLessonId: "network.beginner.wrong-gateway-fault",
  steps: [
    {
      id: "phone-online",
      skill: "wifi",
      goal: L("Make the phone reach library.test.", "خلّ الجوال يوصل إلى library.test."),
      check: { type: "net.ping", label: L("A virtual ping from the phone to library.test gets a reply", "بنق افتراضي من الجوال إلى library.test يجيه رد"), from: { kind: "wifi_client" }, to: "library.test", succeeds: true },
      hints: [
        { text: L("The phone has no cable. What two things does it need before it can send anything?", "الجوال ما له سلك. وش الشيئين اللي يحتاجهم قبل ما يرسل أي شي؟") },
        { text: L("Look at the gateway's fibre port and at the phone's Wi-Fi settings.", "شوف منفذ الألياف في الراوتر المدمج وإعدادات الواي فاي في الجوال."), target: networkTarget.setting("phone-1", "wifiClient") },
        { text: L("Connect the fibre from the provider to the gateway's PON port. Then give the phone the gateway's network name and passphrase, exactly as they appear in the gateway's Wi-Fi settings.", "وصّل الألياف من المزوّد لمنفذ PON في الراوتر المدمج. وبعدين عطِ الجوال اسم شبكة الراوتر وكلمة سرها، بالضبط زي ما هم في إعدادات الواي فاي بالراوتر."), target: networkTarget.setting("phone-1", "wifiClient") },
      ],
      explanation: L(
        "An integrated gateway is the ONT and the router in one box, so the fibre goes straight into it. A Wi-Fi client joins the network whose name and passphrase both match its own; once joined, it gets its address by DHCP like a wired device.",
        "الراوتر المدمج هو الـ ONT والراوتر في جهاز واحد، فالألياف تدخل فيه مباشرة. وجهاز الواي فاي يدخل الشبكة اللي اسمها وكلمة سرها يطابقون اللي عنده؛ وبعد ما يدخل ياخذ عنوانه بـ DHCP زي الجهاز السلكي.",
      ),
    },
  ],
};

export const gatewayChallengeExample: LessonExample = {
  lessonId: gatewayChallenge.id,
  steps: [
    {
      stepId: "phone-online",
      solution: { lab: "network", actions: [plug("cable-1", "a", "isp-1", "drop-1"), plug("cable-1", "b", "gateway-1", "pon"), { type: "set_wifi_client", deviceId: "phone-1", ssid: "HomeLab", passphrase: "learn-1234" }] },
    },
  ],
};

export const wrongGatewayFault: Lesson = {
  id: "network.beginner.wrong-gateway-fault",
  version: 1,
  lab: "network",
  level: "beginner",
  kind: "fault",
  title: L("Find the fault: home works, the internet does not", "دوّر على العطل: البيت شغّال، والإنترنت لا"),
  summary: L(
    "This computer has its address typed in by hand. It reaches the phone at home, but nothing outside. Work out why, then repair it.",
    "هذا الكمبيوتر عنوانه مكتوب يدوي. يوصل للجوال في البيت، بس ما يوصل لشي برّا. اعرف ليش، وبعدين صلّحه.",
  ),
  outcome: L("From a test that works locally and fails outside, you name the wrong gateway as the cause and correct it.", "من اختبار ينجح داخل البيت ويفشل برّا، تحدد إن السبب بوابة غلط وتصحّحها."),
  prerequisites: [homeLesson.id],
  skills: SKILLS,
  start: {
    lab: "network",
    actions: [...network.HOME_WITH_ONT, { type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.254", dns: ["203.0.113.53"] } }],
  },
  steps: [
    {
      id: "name-cause",
      skill: "fault-reasoning",
      goal: L("Ping 203.0.113.10 from the computer, see where the journey stops, and choose the cause.", "سوّ بنق من الكمبيوتر إلى 203.0.113.10، شوف الرحلة توقف وين، واختر السبب."),
      options: [
        { id: "cable", text: L("A cable is unplugged", "في سلك مفصول") },
        { id: "dhcp", text: L("DHCP is switched off on the router", "DHCP مقفل في الراوتر") },
        { id: "gateway", text: L("The computer's gateway is not the router's address", "بوابة الكمبيوتر مو عنوان الراوتر") },
        { id: "dns", text: L("The DNS server is wrong", "خادم DNS غلط") },
      ],
      check: { type: "choice", label: L("Names the wrong gateway as the cause", "يحدد إن السبب بوابة غلط"), correctOptionId: "gateway" },
      hints: [
        { text: L("The phone at home answers. What does a packet for an address outside the home need that a packet for the phone does not?", "الجوال في البيت يرد. الباكت الرايح لعنوان برّا البيت وش يحتاج وما يحتاجه الباكت الرايح للجوال؟") },
        { text: L("The journey stops at the computer itself, before any cable. Look at the computer's address settings.", "الرحلة توقف عند الكمبيوتر نفسه، قبل أي سلك. شوف إعدادات العنوان في الكمبيوتر."), target: networkTarget.setting("pc-1", "nic.gateway") },
        { text: L("The computer hands outside packets to 192.168.1.254, and no device has that address. The router is 192.168.1.1. You pinged a number, so DNS was never used; the address is typed by hand, so DHCP is not involved.", "الكمبيوتر يعطي الباكتات الرايحة برّا لـ 192.168.1.254، وما في جهاز بهذا العنوان. الراوتر عنوانه 192.168.1.1. وإنت سوّيت بنق لرقم، يعني DNS ما انستخدم؛ والعنوان مكتوب يدوي، يعني DHCP ما له دخل."), target: networkTarget.setting("pc-1", "nic.gateway") },
      ],
      explanation: L(
        "Local traffic goes straight to the other device, so it works. Anything for another network is handed to the gateway, and the gateway must be the router's own address on your network. Each wrong answer would look different: an unplugged cable stops local traffic too, and a DNS fault only affects names.",
        "الحركة المحلية تروح مباشرة للجهاز الثاني، فتشتغل. وأي شي رايح لشبكة ثانية ينعطى للبوابة، والبوابة لازم تكون عنوان الراوتر نفسه في شبكتك. وكل جواب غلط كان بيبان بشكل مختلف: السلك المفصول يوقّف الحركة المحلية بعد، وعطل DNS يأثر على الأسماء بس.",
      ),
    },
    {
      id: "repair",
      skill: "gateway",
      goal: L("Correct the setting so that the computer reaches 203.0.113.10.", "صحّح الإعداد لين الكمبيوتر يوصل إلى 203.0.113.10."),
      check: {
        type: "all",
        label: L("The computer reaches the internet host and nothing blocks the network", "الكمبيوتر يوصل لجهاز الإنترنت وما في شي موقّف الشبكة"),
        of: [
          { type: "net.ping", label: L("A virtual ping from the computer to 203.0.113.10 gets a reply", "بنق افتراضي من الكمبيوتر إلى 203.0.113.10 يجيه رد"), from: { kind: "wired_client" }, to: "203.0.113.10", succeeds: true },
          { type: "net.no_diagnostic", label: L("The network check reports no gateway fault", "فحص الشبكة ما يطلّع عطل في البوابة"), codes: ["gateway_wrong", "gateway_missing", "gateway_unreachable", "subnet_mismatch"] },
        ],
      },
      hints: [
        { text: L("Which device should the computer hand its outside packets to?", "الكمبيوتر المفروض يعطي باكتاته الرايحة برّا لأي جهاز؟") },
        { text: L("Open the computer's address settings and look at the gateway field.", "افتح إعدادات العنوان في الكمبيوتر وشوف خانة البوابة."), target: networkTarget.setting("pc-1", "nic.gateway") },
        { text: L("Set the gateway to 192.168.1.1, the router's address on this network, or switch the computer back to automatic (DHCP).", "اضبط البوابة على 192.168.1.1، عنوان الراوتر في هذي الشبكة، أو رجّع الكمبيوتر على تلقائي (DHCP)."), target: networkTarget.setting("pc-1", "nic.gateway") },
      ],
      explanation: L(
        "With the router's own address as the gateway, the computer finds it by ARP and the router sends the packet on. Switching back to automatic works for the same reason: DHCP hands out the right gateway.",
        "لما تكون البوابة عنوان الراوتر نفسه، الكمبيوتر يلقاه بـ ARP والراوتر يكمّل إرسال الباكت. والرجوع للتلقائي يشتغل لنفس السبب: DHCP يعطي البوابة الصحيحة.",
      ),
    },
  ],
};

export const wrongGatewayFaultExample: LessonExample = {
  lessonId: wrongGatewayFault.id,
  steps: [
    { stepId: "name-cause", solution: { lab: "choice", optionId: "gateway" } },
    { stepId: "repair", solution: { lab: "network", actions: [{ type: "set_interface", deviceId: "pc-1", interface: "nic", config: { mode: "static", address: "192.168.1.50", mask: "255.255.255.0", gateway: "192.168.1.1", dns: ["203.0.113.53"] } }] } },
  ],
};
