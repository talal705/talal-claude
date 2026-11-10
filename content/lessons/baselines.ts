// Baseline checks: a few questions per lab that suggest where to start. Only the
// Beginner level exists, so each suggestion is either a Beginner lesson or its challenge.
import type { Baseline } from "@ytl/curriculum";
import { L } from "./helpers";

const pc: Baseline = {
  id: "pc.baseline",
  lab: "pc",
  title: L("Where should you start with building a PC?", "من وين تبدأ في تجميع الكمبيوتر؟"),
  intro: L("Three questions. Answer what you know and choose “I don't know” for the rest; there is no score.", "ثلاث أسئلة. جاوب اللي تعرفه واختر «ما أعرف» للباقي؛ ما في درجات."),
  allKnownLessonId: "pc.beginner.build-challenge",
  questions: [
    {
      id: "slots",
      question: L("A board has four memory slots, A1, A2, B1 and B2, and you have two modules. Where do most boards want them?", "لوحة فيها أربع فتحات رام، A1 و A2 و B1 و B2، وعندك رامين. أغلب اللوحات تبيهم وين؟"),
      options: [
        { id: "a1-a2", text: L("A1 and A2", "A1 و A2") },
        { id: "a2-b2", text: L("A2 and B2", "A2 و B2") },
        { id: "any", text: L("Any two slots", "أي فتحتين") },
      ],
      correctOptionId: "a2-b2",
      skill: "memory-slots",
      lessonId: "pc.beginner.first-build",
    },
    {
      id: "seated",
      question: L("A memory module has one latch closed and one open. What happens at power-on?", "رام قفل واحد فيه مسكّر والثاني مفتوح. وش يصير وقت التشغيل؟"),
      options: [
        { id: "normal", text: L("It starts normally", "يشتغل عادي") },
        { id: "no-post", text: L("Power comes on but the self-test fails", "الكهرباء توصل بس الفحص الذاتي يفشل") },
        { id: "nothing", text: L("Nothing at all happens", "ما يصير شي أبداً") },
      ],
      correctOptionId: "no-post",
      skill: "memory-seating",
      lessonId: "pc.beginner.first-build",
    },
    {
      id: "stages",
      question: L("The fans spin, but a status light on the motherboard stays on and the computer never finishes starting. Which stage most likely failed?", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل التشغيل أبداً. أي مرحلة غالباً فشلت؟"),
      options: [
        { id: "power", text: L("Power", "الكهرباء") },
        { id: "self-test", text: L("The self-test", "الفحص الذاتي") },
        { id: "os", text: L("Loading the operating system", "تحميل نظام التشغيل") },
      ],
      correctOptionId: "self-test",
      skill: "startup-reading",
      lessonId: "pc.beginner.first-build",
    },
  ],
};

const network: Baseline = {
  id: "network.baseline",
  lab: "network",
  title: L("Where should you start with home networks?", "من وين تبدأ في شبكات البيت؟"),
  intro: L("Three questions. Answer what you know and choose “I don't know” for the rest; there is no score.", "ثلاث أسئلة. جاوب اللي تعرفه واختر «ما أعرف» للباقي؛ ما في درجات."),
  allKnownLessonId: "network.beginner.gateway-challenge",
  questions: [
    {
      id: "ont",
      question: L("Which box turns the provider's fibre into an Ethernet signal?", "أي جهاز يحوّل ألياف المزوّد لإشارة إيثرنت؟"),
      options: [
        { id: "ont", text: L("The ONT", "الـ ONT") },
        { id: "switch", text: L("A switch", "السويتش") },
        { id: "ap", text: L("An access point", "الأكسس بوينت") },
      ],
      correctOptionId: "ont",
      skill: "provider-path",
      lessonId: "network.beginner.first-home-network",
    },
    {
      id: "wan",
      question: L("Which router port does the cable from the ONT go into?", "السلك الجاي من الـ ONT يدخل في أي منفذ بالراوتر؟"),
      options: [
        { id: "wan", text: L("WAN", "WAN") },
        { id: "lan", text: L("LAN", "LAN") },
        { id: "any", text: L("Any of them", "أي واحد") },
      ],
      correctOptionId: "wan",
      skill: "wan-lan",
      lessonId: "network.beginner.first-home-network",
    },
    {
      id: "dhcp",
      question: L("A computer set to automatic gets its address from…", "الكمبيوتر المضبوط على تلقائي ياخذ عنوانه من…"),
      options: [
        { id: "dhcp", text: L("a DHCP server on its network, usually the router", "خادم DHCP في شبكته، غالباً الراوتر") },
        { id: "dns", text: L("the DNS server", "خادم DNS") },
        { id: "itself", text: L("itself, at random", "نفسه، عشوائي") },
      ],
      correctOptionId: "dhcp",
      skill: "dhcp",
      lessonId: "network.beginner.first-home-network",
    },
  ],
};

export const baselines: readonly Baseline[] = [
  pc,
  network,
];
