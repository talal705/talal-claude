// PC lab, beginner: one full build from the workbench, a Test Yourself build, and a fault exercise.
// The lesson and the challenge start from a starter kit as delivered: every part on the workbench,
// nothing installed or connected (owner decision 9). The fault exercise starts from a computer brought
// in for repair: assembled, but a compatible mix of both sets, not a starter configuration.
// Every check is decided by the PC engine; tested by packages/curriculum/src/lessons.test.ts.
import { pcTarget, type MountRef, type PCAction } from "@ytl/contracts";
import type { Lesson, LessonExample, LessonHint } from "@ytl/curriculum";
import { pcRepairBuilds, pcStarterKits } from "../../catalog";
import { L } from "../helpers";

const kitB = pcStarterKits.find((kit) => kit.id === "i7-ddr5-rgb-aio")!;
const kitA = pcStarterKits.find((kit) => kit.id === "i5-ddr4-air")!;
// The fault exercise is a computer brought in for repair, not an assembled starter configuration (decision 9).
const finished = pcRepairBuilds.find((build) => build.id === "repair-i5-ddr5-air")!;

// IDs the engine assigns in both kits (asserted by the lesson tests).
const CASE = "case-1";
const BOARD = "motherboard-2";
const CPU = "cpu-3";
const RAM = ["ram-4", "ram-5"] as const;
const DRIVE = "storage-6";
const COOLER = "cooling-7";
const GPU = "gpu-8";
const PSU = "psu-9";
const FAN = "fan-10";
const at = (hostInstanceId: string, mountPointId: string): MountRef => ({ hostInstanceId, mountPointId });
const SLOT_A2 = at(BOARD, "dimm-a2");
const SLOT_B2 = at(BOARD, "dimm-b2");

const seat = (instanceId: string, target: MountRef): PCAction[] => [
  { type: "mount_part", instanceId, target },
  { type: "set_seating", instanceId, seating: "seated" },
];

const SKILLS = {
  "board-mounting": L("Fitting the motherboard in the case", "تركيب اللوحة الأم في الهيكل"),
  "cpu-install": L("Installing the processor", "تركيب المعالج"),
  firmware: L("Matching the BIOS to the processor", "توافق البايوس مع المعالج"),
  "memory-slots": L("Choosing the right memory slots", "اختيار فتحات الرام الصحيحة"),
  "memory-seating": L("Seating memory fully", "تركيب الرام للآخر"),
  cooling: L("Fitting the CPU cooler", "تركيب مبرّد المعالج"),
  "parts-install": L("Installing the remaining parts", "تركيب باقي القطع"),
  cabling: L("Connecting power and data cables", "توصيل كيبلات الطاقة والبيانات"),
  "startup-reading": L("Reading what the computer does at power-on", "قراءة اللي يسويه الكمبيوتر وقت التشغيل"),
  "fault-reasoning": L("Reasoning from a symptom to its cause", "الوصول من العَرَض للسبب"),
};

const slotHints: readonly [LessonHint, LessonHint, LessonHint] = [
  { text: L("The four slots are not equal. Where does the board's manual say two modules should go?", "الفتحات الأربع مو زي بعض. دليل اللوحة يقول الرامين يروحون وين؟") },
  { text: L("Look at the slot labels on the board. For two modules this board wants the second slot of each pair.", "شوف أسماء الفتحات على اللوحة. لرامين، هذي اللوحة تبي الفتحة الثانية من كل زوج."), target: pcTarget.mount(SLOT_A2) },
  { text: L("Put one module in A2 and the other in B2, then push each one in until both of its latches close.", "حط رام في A2 والثاني في B2، وادفع كل واحد لين يقفل القفلين حقينه."), target: pcTarget.mount(SLOT_B2) },
];


const touches = (ids: readonly string[]) => (action: PCAction) => "instanceId" in action && ids.includes(action.instanceId) && action.type !== "update_bios";
const isCabling = (action: PCAction) => action.type === "connect_cable_end" || action.type === "set_cable_tidy";
const isPowerUp = (action: PCAction) => action.type === "set_side_panel" || action.type === "set_wall_power" || action.type === "set_psu_switch";

export const firstBuild: Lesson = {
  id: "pc.beginner.first-build",
  version: 2,
  lab: "pc",
  level: "beginner",
  kind: "lesson",
  title: L("Build a computer from the workbench", "ركّب كمبيوتر من طاولة الشغل"),
  summary: L(
    "Starter B arrives as separate parts on the workbench: case, motherboard, Core i7, two DDR5 modules, liquid cooler, NVMe drive, graphics card, power supply and a case fan. Prepare the motherboard outside the case, move it in with its attached parts, then finish the remaining parts, cables and startup.",
    "المجموعة ب توصل قطع منفصلة على طاولة الشغل: هيكل، ولوحة أم، ومعالج Core i7، ورامين DDR5، ومبرّد مائي، وقرص NVMe، وكرت شاشة، ومزوّد طاقة، ومروحة هيكل. تجهّز اللوحة برا الكيس، وتنقلها مع قطعها للداخل، وتكمّل باقي القطع والكيبلات والتشغيل.",
  ),
  outcome: L(
    "Given a set of loose parts, you install every one in its place, secure it, connect every cable it needs and bring the computer to its operating system.",
    "إذا عندك قطع مفكوكة، تركّب كل وحدة في مكانها، تثبّتها، توصّل كل كيبل تحتاجه، وتوصّل الكمبيوتر لنظام التشغيل.",
  ),
  prerequisites: [],
  skills: SKILLS,
  start: { lab: "pc", actions: kitB.actions },
  nextLessonId: "pc.beginner.build-challenge",
  steps: [
    {
      id: "cpu",
      skill: "cpu-install",
      goal: L("Leave the motherboard on the workbench. Put the processor into its socket and close the socket lever.", "خلّ اللوحة على الطاولة. حط المعالج في مقبسه وسكّر ذراع المقبس."),
      check: {
        type: "all",
        label: L("The processor is seated and the lever is locked", "المعالج مركّب والذراع مقفّلة"),
        of: [
          { type: "pc.part_count", label: L("The processor is seated in the socket", "المعالج مركّب في المقبس"), category: "cpu", min: 1, mounted: true },
          { type: "pc.no_diagnostic", label: L("The socket lever is closed", "ذراع المقبس مسكّرة"), codes: ["cpu_lever_open"] },
        ],
      },
      hints: [
        { text: L("The processor goes in only one way. What holds it down once it is in?", "المعالج يدخل بطريقة وحدة بس. وش اللي يمسكه بعد ما يدخل؟") },
        { text: L("Select the processor and choose the board's CPU socket.", "اختر المعالج واختر مقبس المعالج في اللوحة."), target: pcTarget.mount(at(BOARD, "cpu-socket")) },
        { text: L("Seat it in the socket, then secure the socket lever (its one fastener).", "ركّبه في المقبس، وبعدين قفّل ذراع المقبس (المثبّت الوحيد حقه)."), target: pcTarget.part(CPU) },
      ],
      explanation: L(
        "The lever presses the processor onto hundreds of contacts in the socket. Left open, the processor sits there but does not make contact, and the self-test cannot start.",
        "الذراع تضغط المعالج على مئات نقاط التلامس في المقبس. لو بقت مفتوحة، المعالج قاعد بس ما يلامس، والفحص الذاتي ما يقدر يبدأ.",
      ),
    },
    {
      id: "bios",
      skill: "firmware",
      goal: L("Make sure the motherboard's BIOS supports this processor, and update it if it does not.", "تأكد إن بايوس اللوحة الأم يدعم هذا المعالج، وحدّثه إذا ما يدعمه."),
      check: { type: "pc.no_diagnostic", label: L("The BIOS version supports the installed processor", "إصدار البايوس يدعم المعالج المركّب"), codes: ["cpu_needs_bios_update"] },
      hints: [
        { text: L("A processor can fit the socket and still not be recognised. What decides that?", "المعالج ممكن يدخل المقبس وبرضو اللوحة ما تتعرّف عليه. وش اللي يحدد هذا؟") },
        { text: L("Look at the motherboard's BIOS version and the version its support list names for this processor.", "شوف إصدار البايوس في اللوحة والإصدار اللي تذكره قائمة الدعم لهذا المعالج."), target: pcTarget.part(BOARD) },
        { text: L("The board starts on an old BIOS; the Core i7-14700K needs 1205 or newer. Update the BIOS to a newer version.", "اللوحة تبدأ ببايوس قديم؛ و Core i7-14700K يحتاج 1205 أو أحدث. حدّث البايوس لإصدار أحدث."), target: pcTarget.part(BOARD) },
      ],
      explanation: L(
        "The board's own support list names the first BIOS version that knows each processor. 14th-generation processors came out after this board, so its first BIOS versions do not recognise them.",
        "قائمة الدعم حق اللوحة تذكر أول إصدار بايوس يعرف كل معالج. معالجات الجيل 14 طلعت بعد هذي اللوحة، فإصدارات البايوس الأولى ما تتعرّف عليها.",
      ),
    },
    {
      id: "seat-memory",
      skill: "memory-slots",
      goal: L(
        "Put both memory modules into the slots this board recommends for two modules, and push each one in until both latches close.",
        "حط الرامين في الفتحات اللي تنصح فيها هذي اللوحة لرامين، وادفع كل واحد لين يقفل القفلين.",
      ),
      prediction: {
        question: L("If a module is pushed in only half way, with one latch closed, what will happen when you press the power button?", "لو رام اندفع نص الطريق بس، وقفل واحد اللي قفل، وش بيصير لما تضغط زر التشغيل؟"),
        options: [
          { id: "starts", text: L("The computer starts normally", "الكمبيوتر يشتغل عادي") },
          { id: "self-test-fails", text: L("It gets power, but the self-test fails and the computer does not finish starting", "توصله كهرباء، بس الفحص الذاتي يفشل والكمبيوتر ما يكمّل التشغيل") },
          { id: "dead", text: L("Nothing at all happens, as if it were unplugged", "ما يصير شي أبداً، كأنه مفصول") },
        ],
        correctOptionId: "self-test-fails",
        explanation: L(
          "The power supply does its job, so the computer gets power. The board then tests its memory, cannot read a half-seated module, and stops before the computer can finish starting.",
          "مزوّد الطاقة يسوي شغله، فالكهرباء توصل. بعدين اللوحة تفحص الرام، وما تقدر تقرأ رام مركّب نص، فتوقف قبل ما يكمّل الكمبيوتر التشغيل.",
        ),
      },
      check: {
        type: "all",
        label: L("Both modules are in the recommended slots and fully seated", "الرامين في الفتحات المنصوح فيها ومركّبين للآخر"),
        of: [
          { type: "pc.memory_slots", label: L("The two fully seated modules are in slots A2 and B2", "الرامين المركّبين للآخر في الفتحتين A2 و B2"), slots: ["dimm-a2", "dimm-b2"] },
          { type: "pc.no_diagnostic", label: L("No module is left half seated or in a slot the board does not recommend", "ما في رام مركّب نص أو في فتحة ما تنصح فيها اللوحة"), codes: ["ram_partially_seated", "ram_population_not_recommended"] },
        ],
      },
      hints: slotHints,
      explanation: L(
        "A board with four slots runs two modules as a pair only when they sit in matching slots, one per channel. This board's manual names A2 and B2 for two modules. A module also has to be pushed in until both latches close: the contacts along its edge only all touch when it is fully down.",
        "اللوحة اللي فيها أربع فتحات تشغّل الرامين كزوج بس إذا كانوا في فتحتين متقابلتين، وحدة لكل قناة. دليل هذي اللوحة يحدد A2 و B2 لرامين. والرام لازم يندفع لين يقفل القفلين: نقاط التلامس على طرفه ما تلامس كلها إلا إذا نزل للآخر.",
      ),
      example: L(
        "Watch one module: choose the first module, choose slot A2 as its place, then use Push in fully. The card now says it is seated. Do the same for the second module yourself.",
        "شوف رام واحد: اختر الرام الأول، واختر الفتحة A2 مكان له، وبعدين استخدم «ادفعه للآخر». البطاقة الحين تقول إنه مركّب. سوّ نفس الشي للرام الثاني بنفسك.",
      ),
      followUp: {
        goal: L("A friend has two modules in slots A1 and A2 on this same board. Which change follows the board's recommendation?", "صاحبك عنده رامين في الفتحتين A1 و A2 على نفس اللوحة. أي تغيير يتبع نصيحة اللوحة؟"),
        options: [
          { id: "leave", text: L("Leave them: any two slots are the same", "يتركهم: أي فتحتين نفس الشي") },
          { id: "move-a1-b2", text: L("Move the module from A1 to B2", "ينقل الرام من A1 إلى B2") },
          { id: "move-a2-b1", text: L("Move the module from A2 to B1", "ينقل الرام من A2 إلى B1") },
        ],
        check: { type: "choice", label: L("Chooses the move that ends with modules in A2 and B2", "يختار النقلة اللي تخلّي الرامين في A2 و B2"), correctOptionId: "move-a1-b2" },
        hints: slotHints,
        explanation: L("A1 and A2 are on the same channel. Moving the A1 module to B2 leaves one module on each channel, in the slots the manual names.", "A1 و A2 على نفس القناة. نقل رام A1 إلى B2 يخلّي رام على كل قناة، في الفتحات اللي يحددها الدليل."),
      },
    },
    {
      id: "drive",
      skill: "parts-install",
      goal: L("Before the cooler covers the board, fit the NVMe drive in M.2_1 on the workbench and secure its latch.", "قبل ما المبرّد يغطي اللوحة، ركّب قرص NVMe في M.2_1 واللوحة على الطاولة، وثبّت قفله."),
      check: {
        type: "all",
        label: L("The M.2 drive is seated and secured", "قرص M.2 مركّب ومثبّت"),
        of: [
          { type: "pc.part_count", label: L("The drive is seated on the board", "القرص مركّب على اللوحة"), category: "storage", min: 1, mounted: true },
          { type: "pc.no_diagnostic", label: L("The drive latch is secured", "قفل القرص مثبّت"), codes: ["fasteners_missing"] },
        ],
      },
      hints: [
        { text: L("This kit uses an NVMe drive. It fits directly on the board, without a SATA data cable.", "هذي التجميعة فيها قرص NVMe. يركب مباشرة على اللوحة بدون كيبل بيانات SATA.") },
        { text: L("Choose the drive, then the board's M.2_1 slot.", "اختر القرص، وبعده فتحة M.2_1 في اللوحة."), target: pcTarget.mount(at(BOARD, "m2-1")) },
        { text: L("Seat the drive fully and secure its one latch.", "ركّب القرص للآخر وثبّت قفله الواحد."), target: pcTarget.part(DRIVE) },
      ],
      explanation: L("The M.2 drive moves with the motherboard into the case. A 2.5-inch SATA drive instead belongs in a case drive bay and needs power and data cables.", "قرص M.2 ينتقل مع اللوحة للكيس. أما قرص SATA بحجم 2.5 بوصة، فمكانه في درج بالكيس ويحتاج كيبل طاقة وكيبل بيانات."),
    },
    {
      id: "cooler",
      skill: "cooling",
      goal: L("With the motherboard still on the workbench, seat and fasten the cooler pump block on the processor. Leave the radiator for after the board is in the case.", "واللوحة لسه على الطاولة، ركّب راس المضخة فوق المعالج وشدّه. خلّ الرادياتير لبعد تركيب اللوحة في الكيس."),
      check: {
        type: "all",
        label: L("The cooler is on the processor and fully fastened", "المبرّد على المعالج ومشدود كامل"),
        of: [
          { type: "pc.part_count", label: L("The cooler is seated", "المبرّد مركّب"), category: "cooling", min: 1, mounted: true },
          { type: "pc.no_diagnostic", label: L("The pump block is seated and all its mounting points are fastened", "راس المضخة مركّب وكل نقاط تثبيته مشدودة"), codes: ["cooler_not_secured", "cooler_missing"] },
        ],
      },
      hints: [
        { text: L("Fit only the pump block now. The radiator is a separate mounting step after the board goes into the case.", "ركّب راس المضخة بس الحين. الرادياتير له خطوة تركيب ثانية بعد ما تدخل اللوحة للكيس.") },
        { text: L("The pump block goes on the board's cooler mounting position, above the already seated processor.", "راس المضخة يروح على مكان تثبيت المبرّد في اللوحة، فوق المعالج المركّب."), target: pcTarget.mount(at(BOARD, "cooler-mount")) },
        { text: L("Seat the block and fasten its four mounting points. Select the motherboard next to move the prepared assembly into the case.", "ركّب الراس وشدّ نقاط تثبيته الأربع. بعدها تختار اللوحة عشان تنقل التجميعة المجهّزة للكيس."), target: pcTarget.mount(at(BOARD, "cooler-mount")) },
      ],
      explanation: L(
        "The block takes heat from the processor only with even pressure from all of its mounting points. The radiator then sheds that heat into the air the fans move; left hanging, it cannot.",
        "الراس يسحب الحرارة من المعالج بس إذا الضغط متساوي من كل نقاط تثبيته. وبعدين الرادياتير يطلّع هذي الحرارة للهوا اللي تحرّكه المراوح؛ ولو بقى معلّق ما يقدر.",
      ),
    },
    {
      id: "board",
      skill: "board-mounting",
      goal: L("Move the prepared motherboard into the case with its CPU, memory, M.2 drive and cooler block still attached; fasten all nine tray screws.", "انقل اللوحة المجهّزة للكيس مع المعالج والرام وقرص M.2 وراس المبرّد اللي عليها، وشدّ براغيها التسعة."),
      check: {
        type: "all",
        label: L("The motherboard is seated in the case and fully screwed down", "اللوحة الأم مركّبة في الهيكل ومشدودة كلها"),
        of: [
          { type: "pc.part_count", label: L("The motherboard is seated on the tray", "اللوحة الأم مركّبة على الصينية"), category: "motherboard", min: 1, mounted: true },
          { type: "pc.no_diagnostic", label: L("No part is left with screws missing", "ما في قطعة ناقصة براغي"), codes: ["fasteners_missing"] },
        ],
      },
      hints: [
        { text: L("The motherboard is ready on the bench. Its attached parts stay with it when you move it into the case.", "اللوحة جاهزة على الطاولة. القطع اللي ركّبتها عليها تبقى معها لما تنقلها للكيس.") },
        { text: L("Select the motherboard, then choose the case's motherboard tray as its place.", "اختر اللوحة الأم، وبعدين اختر صينية اللوحة في الهيكل مكان لها."), target: pcTarget.mount(at(CASE, "motherboard-tray")) },
        { text: L("Place the board on the tray, push it home, then secure all nine standoff screws.", "حط اللوحة على الصينية، ادفعها لمكانها، وبعدين شدّ البراغي التسعة كلها."), target: pcTarget.part(BOARD) },
      ],
      explanation: L(
        "The tray's standoffs hold the board away from the metal of the case, and the screws hold it still so slots and connectors line up. A board that is only resting there can shift and short out.",
        "الأعمدة اللي في الصينية تبعد اللوحة عن حديد الهيكل، والبراغي تثبّتها عشان الفتحات والمداخل تكون في مكانها. اللوحة اللي بس محطوطة ممكن تتحرك وتسوي تماس.",
      ),
    },
    {
      id: "parts",
      skill: "parts-install",
      goal: L("With the prepared board secured in the case, install the radiator, graphics card, power supply and case fan. Fasten all their screws.", "بعد ما تثبّت اللوحة المجهّزة في الكيس، ركّب الرادياتير وكرت الشاشة والباور ومروحة الكيس، وشدّ كل براغيها."),
      check: {
        type: "all",
        label: L("Drive, graphics card, power supply and fan are all installed", "القرص وكرت الشاشة ومزوّد الطاقة والمروحة كلهم مركّبين"),
        of: [
          { type: "pc.no_diagnostic", label: L("No remaining mounting role or screw is missing", "ما في مكان تركيب أو برغي ناقص"), codes: ["part_not_mounted", "fasteners_missing"] },
          { type: "pc.part_count", label: L("The drive is seated", "القرص مركّب"), category: "storage", min: 1, mounted: true },
          { type: "pc.part_count", label: L("The graphics card is seated", "كرت الشاشة مركّب"), category: "gpu", min: 1, mounted: true },
          { type: "pc.part_count", label: L("The power supply is seated", "مزوّد الطاقة مركّب"), category: "psu", min: 1, mounted: true },
          { type: "pc.part_count", label: L("The case fan is seated", "مروحة الهيكل مركّبة"), category: "fan", min: 1, mounted: true },
        ],
      },
      hints: [
        { text: L("The M.2 drive is already on the board. Now fit the radiator, graphics card, power supply and case fan.", "قرص M.2 صار على اللوحة. الحين ركّب الرادياتير وكرت الشاشة والباور ومروحة الكيس.") },
        { text: L("The graphics card goes in the first PCIe slot; the radiator goes at the top of the case, and the power supply and fan in their case positions.", "كرت الشاشة في أول فتحة PCIe؛ والرادياتير فوق الكيس، والباور والمروحة في أماكنهم بالكيس."), target: pcTarget.mount(at(CASE, "rad-top")) },
        { text: L("Fasten the top radiator with eight screws, the graphics card with two, the power supply with four and the rear fan with four.", "شدّ الرادياتير العلوي بثمانية براغي، وكرت الشاشة ببرغيين، والباور بأربعة، والمروحة الخلفية بأربعة."), target: pcTarget.mount(at(CASE, "psu-bay")) },
      ],
      explanation: L(
        "Each part has exactly one kind of place it fits, and the engine refuses the others with the reason. Securing each one keeps it from sagging or working loose; the graphics card in particular is heavy.",
        "كل قطعة لها نوع مكان واحد تركب فيه، والنظام يرفض الأماكن الثانية ويقول السبب. تثبيت كل وحدة يمنعها تميل أو ترتخي؛ وخصوصاً كرت الشاشة لأنه ثقيل.",
      ),
    },
    {
      id: "cables",
      skill: "cabling",
      goal: L("Connect every cable the build needs: power to the board, the processor and the graphics card, the cooler's pump, and the case's power button.", "وصّل كل كيبل تحتاجه التجميعة: الطاقة للوحة والمعالج وكرت الشاشة، ومضخة المبرّد، وزر تشغيل الهيكل."),
      check: {
        type: "pc.no_diagnostic",
        label: L("Nothing that needs a cable is left without one", "ما في شي يحتاج كيبل وهو بدونه"),
        codes: ["required_power_missing", "power_cable_source_loose", "power_switch_not_connected", "power_switch_wrong_header", "storage_not_detected", "pump_not_connected", "cooler_fan_not_connected"],
      },
      hints: [
        { text: L("A detachable cable has two ends. Which ends are still loose, at the part and at the power supply?", "الكيبل اللي ينفصل له طرفين. أي أطراف للحين مو موصّلة، عند القطعة وعند مزوّد الطاقة؟") },
        { text: L("Start with the 24-pin cable: one end in the power supply, the other in the board's 24-pin socket. Then the two CPU power cables and the graphics card cable.", "ابدأ بكيبل الـ 24 سنّ: طرف في مزوّد الطاقة، والطرف الثاني في مدخل الـ 24 سنّ في اللوحة. وبعدين كيبلين طاقة المعالج وكيبل كرت الشاشة."), target: pcTarget.port({ kind: "part", instanceId: BOARD, portId: "atx-24" }) },
        { text: L("Also connect the pump lead to AIO_PUMP and the case's power button lead to the PWRSW pins. Lighting leads are optional.", "ووصّل سلك المضخة على AIO_PUMP، وسلك زر تشغيل الهيكل على سنون PWRSW. أسلاك الإضاءة اختيارية."), target: pcTarget.port({ kind: "part", instanceId: BOARD, portId: "panel-pwrsw" }) },
      ],
      explanation: L(
        "The board, the processor and the graphics card each have their own power socket, and a modular cable carries power only when both of its ends are in. The pump must run or the processor overheats, and the power button only works through its two pins on the board.",
        "اللوحة والمعالج وكرت الشاشة كل واحد له مدخل طاقة خاص، والكيبل المودولار ما يوصّل كهرباء إلا إذا طرفينه موصّلين. المضخة لازم تشتغل وإلا المعالج يحمى، وزر التشغيل ما يشتغل إلا عن طريق سنّينه في اللوحة.",
      ),
    },
    {
      id: "power-on",
      skill: "startup-reading",
      goal: L("Close the side panel, connect the mains, switch the power supply on and press the power button. Get the computer to its operating system.", "سكّر الغطاء الجانبي، وصّل الكهرباء، شغّل مفتاح مزوّد الطاقة واضغط زر التشغيل. وصّل الكمبيوتر لنظام التشغيل."),
      check: { type: "pc.startup", label: L("Startup ends at the operating system and holds the load", "التشغيل ينتهي عند نظام التشغيل ويتحمّل الضغط"), outcome: ["operational"] },
      hints: [
        { text: L("Three things have to be on before the power button can do anything. What are they?", "في ثلاث أشياء لازم تكون شغّالة قبل ما زر التشغيل يسوي شي. وش هي؟") },
        { text: L("Use the power panel: mains cable, power supply switch, then the power button. Read the stages under it.", "استخدم لوحة الطاقة: كيبل الكهرباء، ومفتاح مزوّد الطاقة، وبعدين زر التشغيل. اقرأ المراحل اللي تحته."), target: pcTarget.setting("power-button") },
        { text: L("If a stage shows a red X, its line names the fault; fix that part, switch off and press the power button again.", "إذا مرحلة طلعت عليها إشارة خطأ حمراء، سطرها يذكر العطل؛ صلّح هذي القطعة، اطفِ الجهاز واضغط زر التشغيل مرة ثانية."), target: pcTarget.setting("power-button") },
      ],
      explanation: L(
        "At power-on the supply feeds the board, the board tests its processor and memory, the firmware checks graphics and finds the drive, and the operating system starts. Spinning fans and lights alone do not prove any of this; only the stages do.",
        "وقت التشغيل المزوّد يغذّي اللوحة، واللوحة تفحص المعالج والرام، والبايوس يفحص الرسوميات ويلقى القرص، ونظام التشغيل يبدأ. المراوح اللي تدور والأنوار لحالها ما تثبت شي من هذا؛ المراحل بس هي اللي تثبته.",
      ),
    },
  ],
};

export const firstBuildExample: LessonExample = {
  lessonId: firstBuild.id,
  steps: [
    { stepId: "cpu", solution: { lab: "pc", actions: kitB.solution.filter(touches([CPU])) } },
    { stepId: "bios", solution: { lab: "pc", actions: kitB.solution.filter((action) => action.type === "update_bios") } },
    { stepId: "seat-memory", solution: { lab: "pc", actions: [...seat(RAM[0], SLOT_A2), ...seat(RAM[1], SLOT_B2)] }, followUp: { lab: "choice", optionId: "move-a1-b2" } },
    { stepId: "drive", solution: { lab: "pc", actions: kitB.solution.filter(touches([DRIVE])) } },
    { stepId: "cooler", solution: { lab: "pc", actions: kitB.solution.filter((action) => touches([COOLER])(action) && "role" in action && action.role === "block") } },
    { stepId: "board", solution: { lab: "pc", actions: kitB.solution.filter(touches([BOARD])) } },
    { stepId: "parts", solution: { lab: "pc", actions: kitB.solution.filter((action) => touches([GPU, PSU, FAN])(action) || (touches([COOLER])(action) && "role" in action && action.role === "radiator")) } },
    { stepId: "cables", solution: { lab: "pc", actions: kitB.solution.filter(isCabling) } },
    { stepId: "power-on", solution: { lab: "pc", actions: [...kitB.solution.filter(isPowerUp), { type: "press_power" }] } },
  ],
};

export const buildChallenge: Lesson = {
  id: "pc.beginner.build-challenge",
  version: 1,
  lab: "pc",
  level: "beginner",
  kind: "challenge",
  title: L("Test yourself: from parts on the workbench to a running computer", "اختبر نفسك: من قطع على الطاولة لكمبيوتر شغّال"),
  summary: L(
    "Starter A arrives as separate parts on the workbench: a Core i5 on a DDR4 board, air cooled, with a SATA drive and a power supply whose cables are fixed. Build it and get it running with no step-by-step guidance.",
    "المجموعة أ توصل قطع منفصلة على طاولة الشغل: Core i5 على لوحة DDR4، بتبريد هوائي، مع قرص SATA ومزوّد طاقة كيبلاته ثابتة. ركّبها وشغّلها بدون إرشاد خطوة بخطوة.",
  ),
  outcome: L("Without guidance, you take a different set of loose parts to a running operating system.", "بدون إرشاد، توصّل مجموعة قطع مفكوكة ثانية لنظام تشغيل شغّال."),
  prerequisites: [firstBuild.id],
  skills: SKILLS,
  start: { lab: "pc", actions: kitA.actions },
  nextLessonId: "pc.beginner.memory-fault",
  steps: [
    {
      id: "running",
      skill: "parts-install",
      goal: L("Build this computer and make it start and reach its operating system.", "ركّب هذا الكمبيوتر وخلّه يشتغل ويوصل لنظام التشغيل."),
      check: { type: "pc.startup", label: L("Startup ends at the operating system and holds the load", "التشغيل ينتهي عند نظام التشغيل ويتحمّل الضغط"), outcome: ["operational"] },
      hints: [
        { text: L("This set differs from the first build. What does a SATA drive need that an NVMe drive does not?", "هذي المجموعة غير عن التجميعة الأولى. وش يحتاج قرص SATA وما يحتاجه قرص NVMe؟") },
        { text: L("A SATA drive needs a data cable to the board (two come with the board) and a SATA power plug from the power supply.", "قرص SATA يحتاج كيبل بيانات للوحة (يجون اثنين مع اللوحة) وراس طاقة SATA من مزوّد الطاقة."), target: pcTarget.port({ kind: "part", instanceId: DRIVE, portId: "sata-data" }) },
        { text: L("Read the stage with the red X after each press of the power button; it names the next thing to fix. The BIOS also needs updating for this processor.", "اقرأ المرحلة اللي عليها إشارة الخطأ الحمراء بعد كل ضغطة على زر التشغيل؛ تذكر الشي اللي تصلّحه بعده. والبايوس بعد يحتاج تحديث لهذا المعالج."), target: pcTarget.setting("power-button") },
      ],
      explanation: L(
        "Prepare the processor, memory, any M.2 drive and the cooler on the motherboard outside the case. Move that assembly into the case, then fit the remaining parts, cables and power. The startup stages tell you which of these is still missing.",
        "جهّز المعالج والرام وأي قرص M.2 والمبرّد على اللوحة برا الكيس. انقلها للكيس، وبعدين ركّب باقي القطع والكيبلات والكهرباء. مراحل التشغيل تقول لك أي وحدة منهم للحين ناقصة.",
      ),
    },
  ],
};

export const buildChallengeExample: LessonExample = {
  lessonId: buildChallenge.id,
  steps: [{ stepId: "running", solution: { lab: "pc", actions: [...kitA.solution, { type: "press_power" }] } }],
};

export const memoryFault: Lesson = {
  id: "pc.beginner.memory-fault",
  version: 3,
  lab: "pc",
  level: "beginner",
  kind: "fault",
  title: L("Find the fault: power, but the self-test stops", "دوّر على العطل: في كهرباء، بس الفحص الذاتي يوقف"),
  summary: L(
    "Someone brought in this computer, assembled from a mix of parts, for repair. It gets power when you press the button, but it never finishes starting: a status light on the motherboard stays on. Work out why, then repair it.",
    "واحد جاب هذا الكمبيوتر للتصليح، مجمّع من قطع مخلوطة. توصله كهرباء لما تضغط الزر، بس ما يكمّل التشغيل أبداً: لمبة حالة في اللوحة الأم تبقى شغّالة. اعرف ليش، وبعدين صلّحه.",
  ),
  outcome: L("From the symptom and the startup stages, you name a half-seated memory module as the cause and repair it.", "من العَرَض ومراحل التشغيل، تحدد إن السبب رام مركّب نص وتصلّحه."),
  prerequisites: [firstBuild.id],
  skills: SKILLS,
  start: { lab: "pc", actions: [...finished.actions, { type: "set_side_panel", open: true }, { type: "set_seating", instanceId: RAM[1], seating: "partial" }] },
  steps: [
    {
      id: "name-cause",
      skill: "fault-reasoning",
      goal: L("Press the power button, read which startup stage fails, and choose the most likely cause.", "اضغط زر التشغيل، اقرأ أي مرحلة تشغيل تفشل، واختر السبب الأرجح."),
      options: [
        { id: "psu-off", text: L("The power supply is switched off", "مزوّد الطاقة مقفل") },
        { id: "memory", text: L("A memory module is not fully seated", "في رام مو مركّب للآخر") },
        { id: "no-drive", text: L("There is no drive to start from", "ما في قرص يشتغل منه") },
        { id: "case-fans", text: L("The case fans are not plugged in", "مراوح الهيكل مو موصّلة") },
      ],
      check: { type: "choice", label: L("Names the half-seated memory module as the cause", "يحدد إن السبب رام مركّب نص"), correctOptionId: "memory" },
      hints: [
        { text: L("Which stage passes and which is the first to fail? What does each of the four causes stop?", "أي مرحلة تعدّي وأي مرحلة أول وحدة تفشل؟ وكل سبب من الأربعة وش يوقّف؟") },
        { text: L("The power stage passes and the self-test fails. Look at the parts the self-test needs.", "مرحلة الكهرباء تعدّي والفحص الذاتي يفشل. شوف القطع اللي يحتاجها الفحص الذاتي."), target: pcTarget.part(RAM[1]) },
        { text: L("One memory module has only one latch closed. A switched-off supply would fail the power stage instead, a missing drive would show up after the self-test, and unplugged case fans stop nothing.", "في رام قفل واحد بس اللي قافل فيه. المزوّد المقفل كان بيفشّل مرحلة الكهرباء، والقرص الناقص كان بيبان بعد الفحص الذاتي، ومراوح الهيكل المفصولة ما توقف شي."), target: pcTarget.part(RAM[1]) },
      ],
      explanation: L(
        "The stages tell you where to look. Power passes, so the supply and its switch are fine. The self-test fails, and that test checks the processor and the memory, before any drive is involved.",
        "المراحل تقول لك وين تدوّر. الكهرباء تعدّي، يعني المزوّد ومفتاحه سليمين. الفحص الذاتي يفشل، وهذا الفحص يفحص المعالج والرام، قبل ما يدخل أي قرص في الموضوع.",
      ),
    },
    {
      id: "repair",
      skill: "memory-seating",
      goal: L("Repair the fault and get the computer to its operating system.", "صلّح العطل ووصّل الكمبيوتر لنظام التشغيل."),
      check: {
        type: "all",
        label: L("The module is fully seated and the computer runs", "الرام مركّب للآخر والكمبيوتر شغّال"),
        of: [
          { type: "pc.no_diagnostic", label: L("No memory module is half seated", "ما في رام مركّب نص"), codes: ["ram_partially_seated"] },
          { type: "pc.startup", label: L("Startup ends at the operating system", "التشغيل ينتهي عند نظام التشغيل"), outcome: ["operational"] },
        ],
      },
      hints: [
        { text: L("Work inside a computer is done with the power off. What do you do first?", "الشغل داخل الكمبيوتر يكون والكهرباء مطفية. وش تسوي أول؟") },
        { text: L("Find the module whose card says it is partly in.", "دوّر على الرام اللي بطاقته تقول إنه داخل نص."), target: pcTarget.part(RAM[1]) },
        { text: L("Switch the computer off, push that module in fully, then press the power button again.", "اطفِ الكمبيوتر، ادفع هذا الرام للآخر، وبعدين اضغط زر التشغيل مرة ثانية."), target: pcTarget.part(RAM[1]) },
      ],
      explanation: L(
        "With both latches closed every contact on the module touches the slot, the board can read it, and the self-test passes. Nothing else in the build had to change.",
        "لما يقفل القفلين كل نقاط التلامس في الرام تلامس الفتحة، واللوحة تقدر تقرأه، والفحص الذاتي يعدّي. ما احتاج شي ثاني في التجميعة يتغيّر.",
      ),
    },
  ],
};

export const memoryFaultExample: LessonExample = {
  lessonId: memoryFault.id,
  steps: [
    { stepId: "name-cause", solution: { lab: "choice", optionId: "memory" } },
    { stepId: "repair", solution: { lab: "pc", actions: [{ type: "set_seating", instanceId: RAM[1], seating: "seated" }, { type: "press_power" }] } },
  ],
};
