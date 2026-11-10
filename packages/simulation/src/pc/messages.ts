// English and Arabic text for every PC diagnostic. Three levels per code, matching the tutor's hint ladder:
// observation (symptom only), message (what and where), explanation (the rule).
import type { Localized, PCDiagnosticCode, StartupOutcome, StartupStage } from "@ytl/contracts";

export type TextParams = Record<string, Localized | string | number>;

const fill = (template: string, lang: "en" | "ar", p: TextParams): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = p[key];
    if (v === undefined) return "";
    return typeof v === "object" ? v[lang] : String(v);
  });

interface Entry {
  o?: [string, string];
  m: [string, string];
  x: [string, string];
}

const T: Record<PCDiagnosticCode, Entry> = {
  // ---------- Rejected actions: the message states the cause in one sentence, without the product name ----------
  unknown_reference: {
    m: ["That part, cable or position is not in this build.", "هذي القطعة أو الكيبل أو المكان مو موجود في تجميعتك."],
    x: ["The step points at something that is not in the current build ({what}).", "الخطوة تأشّر على شي مو موجود في التجميعة الحالية ({what})."],
  },
  invalid_action: {
    m: ["{why}", "{why}"],
    x: ["This step does not make sense in the build's current state.", "هذي الخطوة ما تمشي مع وضع التجميعة الحين."],
  },
  power_is_on: {
    m: ["The computer is on. Switch it off before you change any hardware.", "الكمبيوتر شغّال. طفّه قبل ما تغيّر أي قطعة."],
    x: [
      "Parts and cables are never added or removed while the machine has power. Switch it off first, then make the change.",
      "ما نركّب ولا نشيل قطع أو كيبلات والجهاز فيه كهرباء. طفّه أول، وبعدين سوّ التغيير.",
    ],
  },
  mount_kind_mismatch: {
    m: ["This place is made for a different kind of part, so this one does not go here.", "هذا المكان معمول لنوع ثاني من القطع، فهذي ما تركب هنا."],
    x: ["Every position in a computer takes one kind of part: memory in memory slots, the CPU in its socket, drives in bays or M.2 slots.", "كل مكان في الكمبيوتر له نوع واحد من القطع: الرام في فتحات الرام، المعالج في مقبسه، والأقراص في أماكنها أو في فتحات M.2."],
  },
  mount_occupied: {
    m: ["Another part is already installed here.", "في قطعة ثانية مركّبة هنا."],
    x: ["Take out the part that is there first, or choose a free place.", "شيل القطعة اللي هنا أول، أو اختر مكان فاضي."],
  },
  mount_blocked: {
    m: ["A part installed next to this place is covering it.", "في قطعة مركّبة جنب هذا المكان ومغطّيته."],
    x: [
      "Some places share the same space: a radiator covers the fan positions behind it, and fans there block the radiator.",
      "بعض الأماكن تتشارك نفس المساحة: الرادياتير يغطّي أماكن المراوح اللي وراه، والمراوح هناك تسدّ مكان الرادياتير.",
    ],
  },
  host_not_ready: {
    m: ["{why}", "{why}"],
    x: ["Some steps have an order: the part underneath has to be in place first.", "بعض الخطوات لها ترتيب: لازم القطعة اللي تحت تكون في مكانها أول."],
  },
  cpu_socket_mismatch: {
    m: [
      "This CPU is made for the {have} socket and this board's socket is {want}; the contacts do not line up, so it cannot be placed.",
      "هذا المعالج معمول لمقبس {have}، ومقبس هذي اللوحة {want}. نقاط التلامس ما تتطابق، فما ينحط.",
    ],
    x: [
      "A CPU fits only the socket type it was made for. Other sockets have a different size, contact layout and keying.",
      "المعالج ما يركب إلا في نوع المقبس اللي انعمل له. المقابس الثانية مقاسها وتوزيع نقاطها ومفاتيحها تختلف.",
    ],
  },
  ram_generation_mismatch: {
    m: [
      "This is a {have} module and the slot is {want}: the notch is in a different place, so it physically cannot go in.",
      "هذي رام {have} والفتحة {want}: مكان الشقّ يختلف، فما تدخل أبدًا.",
    ],
    x: [
      "DDR4 and DDR5 modules look alike, but the key notch in the row of contacts sits in a different place. A module of one generation cannot enter a slot of the other, and forcing it would damage both.",
      "رامات DDR4 و DDR5 شكلها متشابه، بس الشقّ اللي في صف نقاط التلامس مكانه يختلف. رام من جيل ما تدخل في فتحة الجيل الثاني، ولو غصبتها تخرب الثنتين.",
    ],
  },
  ram_module_type_mismatch: {
    m: ["This is a {have} module and the slot takes {want}: the length is different, so it does not fit.", "هذي رام {have} والفتحة تاخذ {want}: الطول يختلف، فما تركب."],
    x: ["Desktop boards take full-length UDIMM modules; laptop SO-DIMM modules are shorter.", "لوحات الكمبيوتر المكتبي تاخذ رامات UDIMM بالطول الكامل؛ ورامات اللابتوب SO-DIMM أقصر."],
  },
  board_form_factor_unsupported: {
    m: ["This board is {have} size and this case's tray takes {want}, so it does not fit.", "هذي اللوحة مقاسها {have} وصينية هذا الهيكل تاخذ {want}، فما تركب."],
    x: ["A case lists the board sizes its tray and standoff holes support.", "كل هيكل يذكر مقاسات اللوحات اللي تركب على صينيته وثقوبه."],
  },
  gpu_too_long: {
    m: ["The card is {have} long and this case takes cards up to {want}, so it does not fit.", "طول الكرت {have} وهذا الهيكل ياخذ كروت لين {want}، فما يدخل."],
    x: [
      "Every case states a maximum graphics card length. A longer card hits the front of the case before it reaches the slot.",
      "كل هيكل يذكر أقصى طول لكرت الشاشة. الكرت الأطول يصدم في مقدّمة الهيكل قبل ما يوصل الفتحة.",
    ],
  },
  cooler_too_tall: {
    m: ["The cooler is {have} tall and this case takes coolers up to {want}, so the side panel would not close.", "ارتفاع المبرّد {have} وهذا الهيكل ياخذ مبرّدات لين {want}، فالغطا الجانبي ما يتسكّر."],
    x: [
      "Every case states a maximum CPU cooler height, measured from the CPU to the side panel.",
      "كل هيكل يذكر أقصى ارتفاع لمبرّد المعالج، من المعالج لين الغطا الجانبي.",
    ],
  },
  cooler_socket_unsupported: {
    m: ["This cooler has mounting for {have} and this board's socket is {want}, so it cannot be fixed here.", "هذا المبرّد تثبيته لمقابس {have} ومقبس هذي اللوحة {want}، فما يتثبّت هنا."],
    x: ["Each cooler lists the sockets its mounting hardware supports.", "كل مبرّد يذكر المقابس اللي تركب عليها عدّة تثبيته."],
  },
  radiator_size_unsupported: {
    m: ["This radiator is {have} and this position takes {want}, so it does not fit here.", "هذا الرادياتير مقاسه {have} وهذا المكان ياخذ {want}، فما يركب هنا."],
    x: ["Each radiator position supports specific sizes. Choose one that lists this radiator's size.", "كل مكان رادياتير له مقاسات محددة. اختر مكان يذكر مقاس هذا الرادياتير."],
  },
  psu_form_factor_unsupported: {
    m: ["This power supply is {have} size and the bay takes {want}, so it does not fit.", "مزوّد الطاقة هذا مقاسه {have} والحجرة تاخذ {want}، فما يركب."],
    x: ["The power supply bay accepts specific form factors only.", "حجرة مزوّد الطاقة تاخذ مقاسات محددة بس."],
  },
  psu_too_long: {
    m: ["This power supply is {have} long and the bay takes up to {want}, so it does not fit.", "طول مزوّد الطاقة {have} والحجرة تاخذ لين {want}، فما يدخل."],
    x: ["Every case states a maximum power supply length.", "كل هيكل يذكر أقصى طول لمزوّد الطاقة."],
  },
  fan_size_unsupported: {
    m: ["This fan is {have} and this position takes {want}, so the screw holes do not line up.", "هذي المروحة مقاسها {have} وهذا المكان ياخذ {want}، فثقوب البراغي ما تتطابق."],
    x: ["Fan positions have screw holes for specific sizes only.", "أماكن المراوح فيها ثقوب براغي لمقاسات محددة بس."],
  },
  drive_bay_mismatch: {
    m: ["This drive is {have} and this bay takes {want}, so it does not fit.", "هذا القرص مقاسه {have} وهذا المكان ياخذ {want}، فما يركب."],
    x: ["Drive bays are sized for 2.5-inch or 3.5-inch drives.", "أماكن الأقراص مقاسها 2.5 أو 3.5 بوصة."],
  },
  m2_length_unsupported: {
    m: ["This drive is {have} and the slot has fixing points for {want}, so it cannot be held down.", "هذا القرص مقاسه {have} والفتحة فيها نقاط تثبيت لـ {want}، فما يتثبّت."],
    x: ["M.2 drives come in several lengths: 2280 means 22 mm wide and 80 mm long. The slot needs a fixing point at that length.", "أقراص M.2 لها أطوال: 2280 يعني العرض 22 مم والطول 80 مم. الفتحة لازم يكون فيها نقطة تثبيت عند هذا الطول."],
  },
  m2_interface_unsupported: {
    m: ["This drive talks {have} and this slot supports {want}, so the drive would not be seen here.", "هذا القرص يشتغل بـ {have} وهذي الفتحة تدعم {want}، فالقرص ما ينقرا هنا."],
    x: [
      "M.2 is only the shape. An M.2 drive talks either NVMe (over PCIe) or SATA, and each M.2 slot supports one or both.",
      "M.2 هو الشكل بس. قرص M.2 يشتغل يا بـ NVMe (عن طريق PCIe) يا بـ SATA، وكل فتحة M.2 تدعم وحدة منهم أو الثنتين.",
    ],
  },
  connector_mismatch: {
    m: ["This plug is {have} and the socket is {want}: they are different connectors, so it does not go in.", "هذا الراس {have} والمدخل {want}: نوعين مختلفين، فما يدخل."],
    x: ["Each connector has its own shape so that only the right cable fits.", "كل موصّل له شكله عشان ما يدخل فيه إلا الكيبل الصح."],
  },
  eps_pcie_not_interchangeable: {
    m: [
      "This plug is {have} and the socket is {want}: CPU power and graphics power look alike but are keyed differently, so it does not go in.",
      "هذا الراس {have} والمدخل {want}: كيبل طاقة المعالج وكيبل طاقة كرت الشاشة شكلهم متشابه بس مفاتيحهم تختلف، فما يدخل.",
    ],
    x: [
      "Both are 8-pin, but their pins are shaped differently and 12 V and ground sit on opposite rows. EPS plugs go to the motherboard's CPU power socket; PCIe plugs go to graphics cards.",
      "الثنين 8 سنون، بس شكل السنون يختلف، و 12 فولت والأرضي معكوسين بينهم. رؤوس EPS تروح لمدخل طاقة المعالج في اللوحة الأم، ورؤوس PCIe تروح لكرت الشاشة.",
    ],
  },
  rgb_argb_not_interchangeable: {
    m: [
      "This plug is {have} and the header is {want}: the two lighting types use different voltages and pins, so it does not go on.",
      "هذا الراس {have} والمدخل {want}: نوعين الإضاءة يختلفون في الفولت وعدد السنون، فما يركب.",
    ],
    x: [
      "Addressable lighting runs on 5 V with 3 pins; classic RGB runs on 12 V with 4 pins. Putting 12 V on a 5 V device burns its LEDs, which is why the connectors differ.",
      "الإضاءة القابلة للعنونة (ARGB) تشتغل على 5 فولت بـ 3 سنون، و RGB العادية على 12 فولت بـ 4 سنون. لو وصل 12 فولت لقطعة 5 فولت تحترق لمباتها، وعشان كذا الموصّلين يختلفون.",
    ],
  },
  modular_cable_mismatch: {
    m: [
      "This cable is {have} and this power supply takes {want} cables: the plug looks the same but the wiring is different, so it must not be used here.",
      "هذا الكيبل {have} ومزوّد الطاقة هذا ياخذ كيبلات {want}: الراس شكله نفسه بس التوصيل داخله يختلف، فلا تستخدمه هنا.",
    ],
    x: [
      "On the power supply side, each manufacturer cable type has its own pin assignment. A cable of another type can put the wrong voltage on a pin and destroy parts, even though it seems to fit. Use only cables made for this unit's cable type.",
      "من جهة مزوّد الطاقة، كل نوع كيبلات عند الشركة له توزيع سنون خاص. كيبل من نوع ثاني ممكن يودّي فولت غلط على سنّ ويخرّب القطع، حتى لو بان إنه راكب. استخدم بس الكيبلات المعمولة لنوع كيبلات هذا المزوّد.",
    ],
  },
  port_occupied: {
    m: ["A cable is already plugged in here.", "في كيبل موصّل هنا."],
    x: ["Unplug the cable that is there first, or choose a free socket.", "افصل الكيبل اللي هنا أول، أو اختر مدخل فاضي."],
  },
  seating_blocked: {
    m: ["The part is only resting in place. Push it fully home before you secure it.", "القطعة محطوطة بس وما دخلت مكانها. ثبّتها لين الآخر قبل ما تقفل عليها."],
    x: ["Screws, latches and levers hold a part that is already fully home. Securing a part that is only resting leaves it loose.", "البراغي والمشابك والأذرع تمسك قطعة دخلت مكانها لين الآخر. لو قفلت على قطعة محطوطة بس، تبقى رخوة."],
  },

  // ---------- Build diagnostics ----------
  part_missing: {
    o: ["{symptom}", "{symptom}"],
    m: ["The build has no {category}.", "التجميعة ما فيها {category}."],
    x: ["{why}", "{why}"],
  },
  part_not_mounted: {
    o: ["{symptom}", "{symptom}"],
    m: ["{part} is still on the bench.", "{part} للحين على الطاولة."],
    x: ["A part does its job only once it is installed in its place.", "القطعة ما تشتغل إلا لما تتركّب في مكانها."],
  },
  part_not_seated: {
    o: ["{symptom}", "{symptom}"],
    m: ["{part} is resting on {mount} but has not been pushed home.", "{part} محطوطة على {mount} بس ما دخلت مكانها."],
    x: ["Lining a part up is not the same as seating it. Until it is fully home its contacts do not connect.", "إنك تحط القطعة على مكانها مو نفس إنك تثبّتها. لين ما تدخل لين الآخر، نقاط تلامسها ما توصل."],
  },
  ram_partially_seated: {
    o: ["Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."],
    m: ["{part} in {mount} is not fully seated.", "{part} في {mount} مو داخلة لين الآخر."],
    x: [
      "The module is the right type for the slot, but one end was not pushed down until its latch clicked. Some contacts do not touch, so the memory check at startup fails. Press both ends down firmly.",
      "الرام نوعها صح للفتحة، بس طرف منها ما انضغط لين يطقّ المشبك. بعض نقاط التلامس ما توصل، ففحص الرام وقت التشغيل يفشل. اضغط الطرفين بقوة.",
    ],
  },
  cpu_lever_open: {
    o: ["Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."],
    m: ["The lever of the CPU socket is not locked.", "ذراع مقبس المعالج مو مقفّلة."],
    x: ["The lever presses the CPU onto the socket's contacts. Left open, the CPU does not make contact.", "الذراع تضغط المعالج على نقاط المقبس. لو بقت مفتوحة، المعالج ما يوصل."],
  },
  fasteners_missing: {
    m: ["{part} is not fully secured ({done} of {total}).", "{part} مو مثبّتة كامل ({done} من {total})."],
    x: ["The part works, but an unsecured part can shift, sag or work loose. This does not stop the computer starting.", "القطعة تشتغل، بس القطعة اللي مو مثبّتة ممكن تتحرك أو ترتخي. هذا ما يمنع الكمبيوتر يشتغل."],
  },
  cooler_not_secured: {
    o: ["The computer starts, then slows down badly or shuts off under load.", "الكمبيوتر يشتغل، وبعدين يبطّي مرة أو يطفي وقت الضغط."],
    m: ["{part} is not fully fastened onto the CPU.", "{part} مو مشدود زين على المعالج."],
    x: ["A cooler needs even pressure from all its mounting points to take heat from the CPU. Loose mounting leaves a gap and the CPU overheats under load.", "المبرّد يحتاج ضغط متساوي من كل نقاط تثبيته عشان يسحب الحرارة من المعالج. لو التثبيت رخو يصير في فراغ والمعالج يحمى وقت الضغط."],
  },
  wall_power_disconnected: {
    o: ["Pressing the power button does nothing: no fans, no lights.", "تضغط زر التشغيل وما يصير شي: لا مراوح ولا أنوار."],
    m: ["The power supply is not plugged into the wall.", "مزوّد الطاقة مو موصّل بالكهرباء."],
    x: ["The power supply turns mains electricity into what the computer needs. Without the mains cable nothing has power.", "مزوّد الطاقة يحوّل كهرباء الجدار للي يحتاجه الكمبيوتر. بدون كيبل الكهرباء ما يوصل تيار لأي شي."],
  },
  psu_switch_off: {
    o: ["Pressing the power button does nothing: no fans, no lights.", "تضغط زر التشغيل وما يصير شي: لا مراوح ولا أنوار."],
    m: ["The switch on the power supply is off.", "مفتاح مزوّد الطاقة مطفّي."],
    x: ["The rocker switch at the back of the power supply cuts all its output. It must be on (I) before the case button can start the computer.", "المفتاح اللي ورا مزوّد الطاقة يقطع كل الكهرباء منه. لازم يكون على (I) قبل ما زر الهيكل يشغّل الكمبيوتر."],
  },
  required_power_missing: {
    o: ["{symptom}", "{symptom}"],
    m: ["{port} on {part} has no power cable.", "{port} في {part} ما فيه كيبل طاقة."],
    x: ["{why}", "{why}"],
  },
  power_cable_source_loose: {
    o: ["{symptom}", "{symptom}"],
    m: ["The cable in {port} is not plugged into the power supply.", "الكيبل اللي في {port} مو موصّل بمزوّد الطاقة."],
    x: ["A detachable cable has two ends. The end at the part is connected, but the end at the power supply is loose, so no power reaches the part.", "الكيبل اللي ينفصل له طرفين. الطرف اللي عند القطعة موصّل، بس الطرف اللي عند مزوّد الطاقة مو موصّل، فالكهرباء ما توصل للقطعة."],
  },
  psu_connector_unavailable: {
    m: ["{part} has no suitable cable for {port}.", "{part} ما فيه كيبل يناسب {port}."],
    x: ["The build needs more power plugs of this type than the power supply has. Wattage alone does not make a power supply suitable; it also needs the right connectors.", "التجميعة تحتاج رؤوس طاقة من هذا النوع أكثر من اللي في مزوّد الطاقة. الواط لحاله ما يخلّي المزوّد مناسب؛ لازم يكون فيه الموصّلات الصح بعد."],
  },
  power_switch_not_connected: {
    o: ["Pressing the power button does nothing: no fans, no lights.", "تضغط زر التشغيل وما يصير شي: لا مراوح ولا أنوار."],
    m: ["The case's power button lead is not connected to the motherboard.", "سلك زر التشغيل حق الهيكل مو موصّل باللوحة الأم."],
    x: ["The button on the case only closes a contact. Its two-pin lead has to reach the power button pins on the motherboard, or the board never gets the signal to start.", "زر الهيكل بس يقفل تلامس. سلكه أبو سنّين لازم يوصل لسنون زر التشغيل في اللوحة الأم، وإلا اللوحة ما توصلها إشارة التشغيل."],
  },
  power_switch_wrong_header: {
    o: ["Pressing the power button does nothing: no fans, no lights.", "تضغط زر التشغيل وما يصير شي: لا مراوح ولا أنوار."],
    m: ["The power button lead is on the wrong pins of the system panel header.", "سلك زر التشغيل راكب على سنون غلط في لوحة النظام."],
    x: ["All front-panel leads use the same two-pin plug, so it fits in several places. Only the pair marked for the power button starts the computer.", "كل أسلاك الواجهة الأمامية راسها نفسه أبو سنّين، فيدخل في أكثر من مكان. بس الزوج المخصص لزر التشغيل هو اللي يشغّل الكمبيوتر."],
  },
  cpu_not_supported_by_board: {
    o: ["Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."],
    m: ["{part} is not on the CPU support list of {host}.", "{part} مو في قائمة المعالجات المدعومة للوحة {host}."],
    x: ["Fitting the socket is not enough. A board works only with the processors its manufacturer lists for that exact model.", "إن المعالج يدخل المقبس ما يكفي. اللوحة تشتغل بس مع المعالجات اللي الشركة كاتبتها لهذا الموديل بالذات."],
  },
  cpu_needs_bios_update: {
    o: ["Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."],
    m: ["The BIOS on {host} is older than {part} needs.", "البايوس في {host} أقدم من اللي يحتاجه {part}."],
    x: [
      "The CPU fits the socket and is on the board's support list, but only from a later BIOS version. With an older BIOS the board does not recognise the processor. Update the BIOS to the listed version or newer.",
      "المعالج يدخل المقبس وموجود في قائمة دعم اللوحة، بس من إصدار بايوس أحدث. مع بايوس أقدم اللوحة ما تتعرّف على المعالج. حدّث البايوس للإصدار المكتوب أو أحدث.",
    ],
  },
  ram_capacity_exceeded: {
    o: ["Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."],
    m: ["The installed memory is more than {host} supports.", "الرام المركّبة أكثر من اللي تدعمه {host}."],
    x: ["A board has a maximum per module and a maximum in total. Capacity per module, per kit and total installed are three different numbers.", "اللوحة لها حدّ لكل رام وحدّ للمجموع. سعة الرام الوحدة، وسعة الطقم، والمجموع المركّب: ثلاثة أرقام مختلفة."],
  },
  ram_population_not_recommended: {
    m: ["The memory works here, but the board's manual recommends other slots.", "الرام تشتغل هنا، بس دليل اللوحة ينصح بفتحات ثانية."],
    x: ["The manual names the slots to fill first for each number of modules. Other slots still work; the recommended ones give the intended two-channel layout and the best signal.", "الدليل يذكر الفتحات اللي تتعبّى أول لكل عدد رامات. الفتحات الثانية تشتغل بعد؛ بس الموصى فيها تعطيك ترتيب القناتين الصح وأحسن إشارة."],
  },
  ram_single_module: {
    m: ["One memory module is installed, so memory runs on a single channel.", "مركّب رام وحدة، فالذاكرة تشتغل على قناة وحدة."],
    x: ["The computer works. Two matching modules in the recommended slots run on two channels, which is faster.", "الكمبيوتر يشتغل. رامتين متطابقتين في الفتحات الموصى فيها يشتغلون على قناتين، وهذا أسرع."],
  },
  ram_profile_note: {
    m: ["{part} runs at {default} MT/s until its profile is switched on.", "{part} تشتغل على {default} MT/s لين تفعّل البروفايل حقها."],
    x: [
      "The advertised {rated} MT/s is reached only with the module's XMP/EXPO profile enabled in the BIOS. Without it the module uses its default rate. A higher advertised speed is not an incompatibility.",
      "السرعة المكتوبة {rated} MT/s ما توصل لها إلا لما تفعّل بروفايل XMP/EXPO من البايوس. بدونه الرام تشتغل على سرعتها الافتراضية. السرعة المكتوبة الأعلى مو عدم توافق.",
    ],
  },
  graphics_missing: {
    o: ["Fans spin and the processor and memory checks pass, but the self-test stops at the next status light.", "المراوح تدور وفحص المعالج والرام يعدّي، بس الفحص الذاتي يوقف عند لمبة الحالة اللي بعدها."],
    m: ["Nothing in this build can produce graphics output.", "ما في شي في هذي التجميعة يطلّع رسوميات."],
    x: ["The self-test needs a graphics device: either a graphics card or a CPU with integrated graphics. This CPU has none and no graphics card is installed.", "الفحص الذاتي يحتاج جهاز رسوميات: يا كرت شاشة يا معالج فيه كرت مدمج. هذا المعالج ما فيه، وما في كرت شاشة مركّب."],
  },
  // Legacy codes (owner decision 11, 2026-10-27): the lab has no monitor or display cable, so the engine
  // never reports these four. Their text stays for diagnostics stored with older projects.
  monitor_missing: {
    o: ["There is no screen to show a picture.", "ما في شاشة تطلّع الصورة."],
    m: ["No monitor has been added to the build.", "ما أضفت شاشة للتجميعة."],
    x: ["Add a monitor and connect it to a display output to see what happens when the computer starts.", "أضف شاشة ووصّلها بمخرج عرض عشان تشوف وش يصير لما يشتغل الكمبيوتر."],
  },
  monitor_not_connected: {
    o: ["Fans spin and the processor and memory checks pass, but the self-test stops at the next status light.", "المراوح تدور وفحص المعالج والرام يعدّي، بس الفحص الذاتي يوقف عند لمبة الحالة اللي بعدها."],
    m: ["The monitor is not connected to a display output.", "الشاشة مو موصّلة بمخرج عرض."],
    x: ["A display cable has to run from the monitor to an output on the graphics card, or on the motherboard when the CPU has integrated graphics.", "لازم كيبل شاشة من الشاشة لمخرج في كرت الشاشة، أو في اللوحة الأم إذا المعالج فيه كرت مدمج."],
  },
  display_on_board_without_igpu: {
    o: ["Fans spin and the processor and memory checks pass, but the self-test stops at the next status light.", "المراوح تدور وفحص المعالج والرام يعدّي، بس الفحص الذاتي يوقف عند لمبة الحالة اللي بعدها."],
    m: ["The monitor is connected to the motherboard, but {part} has no integrated graphics.", "الشاشة موصّلة باللوحة الأم، بس {part} ما فيه كرت مدمج."],
    x: [
      "The display ports on a motherboard are driven by graphics built into the CPU. This CPU has none, so those ports carry no signal. Connect the monitor to the graphics card.",
      "مخارج الشاشة في اللوحة الأم يشغّلها الكرت المدمج في المعالج. هذا المعالج ما فيه، فهذي المخارج ما فيها إشارة. وصّل الشاشة بكرت الشاشة.",
    ],
  },
  display_on_board_with_gpu: {
    m: ["The monitor is on the motherboard although a graphics card is installed.", "الشاشة موصّلة باللوحة الأم مع إن في كرت شاشة مركّب."],
    x: ["Here the picture comes from the CPU's integrated graphics, so the graphics card is doing nothing. Connect the monitor to the card to use it.", "هنا الصورة تجي من الكرت المدمج في المعالج، فكرت الشاشة ما يسوي شي. وصّل الشاشة بالكرت عشان تستفيد منه."],
  },
  storage_missing: {
    o: ["The self-test finishes, then the computer stops: it finds nothing to start an operating system from.", "الفحص الذاتي يكمّل، وبعدين الكمبيوتر يوقف: ما يلقى شي يشغّل منه نظام التشغيل."],
    m: ["The build has no storage drive.", "التجميعة ما فيها قرص تخزين."],
    x: ["The computer passed its self-test and reached the firmware. An operating system starts from a drive; without one there is nothing to boot.", "الكمبيوتر عدّى الفحص ووصل للبايوس. نظام التشغيل يقلع من قرص؛ وبدون قرص ما في شي يقلع منه."],
  },
  storage_not_detected: {
    o: ["The self-test finishes, then the computer stops: it finds nothing to start an operating system from.", "الفحص الذاتي يكمّل، وبعدين الكمبيوتر يوقف: ما يلقى شي يشغّل منه نظام التشغيل."],
    m: ["The motherboard does not see {part}.", "اللوحة الأم ما تشوف {part}."],
    x: ["{why}", "{why}"],
  },
  storage_not_bootable: {
    o: ["The self-test finishes, then the computer stops: it finds nothing to start an operating system from.", "الفحص الذاتي يكمّل، وبعدين الكمبيوتر يوقف: ما يلقى شي يشغّل منه نظام التشغيل."],
    m: ["A drive is detected, but none has an operating system.", "في قرص مقروء، بس ما في قرص عليه نظام تشغيل."],
    x: ["Seeing a drive and booting from it are two steps. A blank drive shows up in the firmware but has nothing to start.", "إن اللوحة تشوف القرص شي، وإنها تقلع منه شي ثاني. القرص الفاضي يطلع في البايوس بس ما عليه شي يشتغل."],
  },
  psu_insufficient_for_load: {
    o: ["The computer starts and reaches the desktop, then shuts off when the work gets heavy.", "الكمبيوتر يشتغل ويوصل لسطح المكتب، وبعدين يطفي لما يثقل الشغل."],
    m: ["Under load the build asks for more power than {part} is rated to give.", "وقت الضغط التجميعة تطلب طاقة أكثر من اللي {part} مصنّف يعطيها."],
    x: [
      "At idle the parts draw little, so the computer starts. Under heavy work the CPU and graphics card draw their full power; in this teaching model the estimated total is above the power supply's rated output and its protection switches it off.",
      "وقت الخمول القطع تسحب شوي، فالكمبيوتر يشتغل. وقت الشغل الثقيل المعالج وكرت الشاشة يسحبون طاقتهم كاملة؛ وفي هذا النموذج التعليمي المجموع المقدَّر أعلى من قدرة مزوّد الطاقة، فحمايته تطفّيه.",
    ],
  },
  psu_below_gpu_recommendation: {
    m: ["{part} is below the wattage the graphics card's maker recommends.", "{part} أقل من الواط اللي تنصح فيه الشركة المصنّعة لكرت الشاشة."],
    x: ["The estimated load fits, so this is not a fault. The maker's recommendation leaves headroom for a fully loaded system and for power spikes.", "الحمل المقدَّر ضمن الحدّ، فهذي مو مشكلة. نصيحة الشركة تخلّي مجال لنظام محمّل كامل ولقفزات الطاقة."],
  },
  cooler_missing: {
    o: ["The computer starts, then shuts itself off within moments.", "الكمبيوتر يشتغل، وبعدين يطفي من نفسه بعد لحظات."],
    m: ["No CPU cooler is installed.", "ما في مبرّد معالج مركّب."],
    x: ["A processor makes more heat than its bare surface can shed. Without a cooler it reaches its temperature limit almost at once and protects itself by shutting down.", "المعالج يطلّع حرارة أكثر من اللي سطحه يقدر يتخلص منها. بدون مبرّد يوصل لحدّ الحرارة على طول ويحمي نفسه بإنه يطفي."],
  },
  cooler_insufficient_for_load: {
    o: ["The computer works, but under heavy load it slows down badly and its fan runs flat out.", "الكمبيوتر يشتغل، بس وقت الضغط الثقيل يبطّي مرة ومروحته تدور على أقصاها."],
    m: ["{part} cannot remove the heat {cpu} makes under sustained load.", "{part} ما يقدر يسحب الحرارة اللي يطلّعها {cpu} وقت الضغط المتواصل."],
    x: [
      "The cooler fits and the computer starts: being able to install a cooler is not the same as it being enough for the work. In this teaching model the CPU's sustained power is above the cooler's assumed capacity, so the CPU slows itself down to stay within its temperature limit.",
      "المبرّد يركب والكمبيوتر يشتغل: إنه يركب مو معناه إنه يكفي للشغل. في هذا النموذج التعليمي طاقة المعالج المتواصلة أعلى من قدرة المبرّد المفترضة، فالمعالج يبطّي نفسه عشان ما يتعدّى حدّ الحرارة.",
    ],
  },
  cooler_fan_not_connected: {
    o: ["The computer starts, then slows down badly or shuts off under load.", "الكمبيوتر يشتغل، وبعدين يبطّي مرة أو يطفي وقت الضغط."],
    m: ["The fan lead of {part} is not connected to a fan header.", "سلك مروحة {part} مو موصّل بمدخل مروحة."],
    x: ["A heatsink sheds heat only while its fan moves air through it. With the fan stopped the CPU overheats under load.", "المشتّت ما يتخلص من الحرارة إلا والمروحة تحرّك الهوا فيه. والمروحة واقفة، المعالج يحمى وقت الضغط."],
  },
  pump_not_connected: {
    o: ["The computer starts, then slows down badly or shuts off under load.", "الكمبيوتر يشتغل، وبعدين يبطّي مرة أو يطفي وقت الضغط."],
    m: ["The pump and fan lead of {part} is not connected to a header.", "سلك المضخة والمراوح حق {part} مو موصّل بمدخل."],
    x: ["A liquid cooler moves heat only while its pump circulates the liquid and its fans cool the radiator. Without power to them the CPU overheats.", "المبرّد المائي ينقل الحرارة بس والمضخة تدوّر السائل والمراوح تبرّد الرادياتير. بدون كهرباء لهم المعالج يحمى."],
  },
  lighting_not_connected: {
    m: ["The lighting of {part} is switched on, but its lighting lead is not connected.", "إضاءة {part} مفعّلة، بس سلك الإضاءة مو موصّل."],
    x: ["Motor power and lighting are separate. The part works without the lighting lead; the lights need it on a header of the matching type. Lighting is never needed to start the computer.", "كهرباء المحرّك والإضاءة شيئين منفصلين. القطعة تشتغل بدون سلك الإضاءة؛ بس الأنوار تحتاجه على مدخل من نفس النوع. الإضاءة مو شرط أبدًا عشان الكمبيوتر يشتغل."],
  },
  cable_untidy: {
    m: ["{count} connected cables have not been routed and tied.", "{count} من الكيبلات الموصّلة ما ترتّبت ولا انربطت."],
    x: ["Tidy cables help airflow and make later work easier. Untidy cables do not stop the computer working.", "ترتيب الكيبلات يساعد الهوا يمشي ويسهّل الشغل بعدين. الكيبلات اللي مو مرتّبة ما تمنع الكمبيوتر يشتغل."],
  },
  cable_end_loose: {
    m: ["One end of {cable} is connected and the other is loose.", "طرف من {cable} موصّل والطرف الثاني مو موصّل."],
    x: ["A cable does its job only when both ends are connected.", "الكيبل ما يشتغل إلا لما طرفينه يتوصّلون."],
  },
  side_panel_open: {
    m: ["The side panel of the case is open.", "الغطا الجانبي للهيكل مفتوح."],
    x: ["The computer runs with the panel off. Closing it keeps dust out and lets the case fans move air as designed.", "الكمبيوتر يشتغل والغطا مفتوح. لو سكّرته يمنع الغبار ويخلّي مراوح الهيكل تحرّك الهوا زي ما انصمّم."],
  },
};

export function diagnosticText(code: PCDiagnosticCode, p: TextParams): { observation?: Localized; message: Localized; explanation: Localized } {
  const e = T[code];
  const loc = (pair: [string, string]): Localized => ({ en: fill(pair[0], "en", p), ar: fill(pair[1], "ar", p) });
  const observation = e.o ? loc(e.o) : undefined;
  return {
    ...(observation && observation.en ? { observation } : {}),
    message: loc(e.m),
    explanation: loc(e.x),
  };
}

export const L = (en: string, ar: string): Localized => ({ en, ar });

// Symptoms reused by stage observations and by diagnostics whose symptom depends on the stage.
export const SYMPTOM = {
  dead: L("Pressing the power button does nothing: no fans, no lights.", "تضغط زر التشغيل وما يصير شي: لا مراوح ولا أنوار."),
  noPost: L("Fans spin, but a status light on the motherboard stays on and the computer does not finish its self-test.", "المراوح تدور، بس لمبة حالة في اللوحة الأم تبقى شغّالة والكمبيوتر ما يكمّل الفحص الذاتي."),
  noGraphics: L("Fans spin and the processor and memory checks pass, but the self-test stops at the next status light.", "المراوح تدور وفحص المعالج والرام يعدّي، بس الفحص الذاتي يوقف عند لمبة الحالة اللي بعدها."),
  noBoot: L("The self-test finishes, then the computer stops: it finds nothing to start an operating system from.", "الفحص الذاتي يكمّل، وبعدين الكمبيوتر يوقف: ما يلقى شي يشغّل منه نظام التشغيل."),
  overheats: L("The computer starts, then slows down badly or shuts off under load.", "الكمبيوتر يشتغل، وبعدين يبطّي مرة أو يطفي وقت الضغط."),
};

export const CATEGORY_NAME: Record<string, Localized> = {
  case: L("case", "هيكل (كيس)"),
  motherboard: L("motherboard", "لوحة أم"),
  cpu: L("processor (CPU)", "معالج"),
  ram: L("memory (RAM)", "رام"),
  gpu: L("graphics card", "كرت شاشة"),
  psu: L("power supply", "مزوّد طاقة"),
  storage: L("storage drive", "قرص تخزين"),
  fan: L("fan", "مروحة"),
  cooling: L("CPU cooler", "مبرّد معالج"),
  cable: L("cable", "كيبل"),
  monitor: L("monitor", "شاشة"),
};

export const STAGE_PASSED: Record<StartupStage, Localized> = {
  power: L("The power supply delivers power: fans start to turn.", "مزوّد الطاقة يعطي كهرباء: المراوح تبدأ تدور."),
  post: L("The self-test completes: processor, memory and graphics are found.", "الفحص الذاتي كمّل: لقى المعالج والرام وكرت الشاشة."),
  firmware_display: L("Graphics are ready and the firmware finishes its checks.", "الرسوميات جاهزة والبايوس يكمّل فحوصاته."),
  boot_device: L("A bootable drive is found and the operating system starts.", "لقى قرص يقلع منه، ونظام التشغيل بدأ."),
  operating_load: L("Under the modelled load the power supply and cooling hold.", "وقت الضغط في النموذج، مزوّد الطاقة والتبريد يتحمّلون."),
};

export const STAGE_FAILED: Record<StartupStage, Localized> = {
  power: SYMPTOM.dead,
  post: SYMPTOM.noPost,
  firmware_display: SYMPTOM.noGraphics,
  boot_device: SYMPTOM.noBoot,
  operating_load: L("The computer reaches the desktop, then cannot keep up with heavy work.", "الكمبيوتر يوصل لسطح المكتب، وبعدين ما يتحمّل الشغل الثقيل."),
};

export const STAGE_NOT_REACHED = L("Not reached.", "ما وصلنا لهذي المرحلة.");
export const STAGE_IDLE = L("The power button has not been pressed.", "زر التشغيل ما انضغط.");

export const OUTCOME_TEXT: Record<StartupOutcome, Localized> = {
  idle: STAGE_IDLE,
  no_power: SYMPTOM.dead,
  no_post: SYMPTOM.noPost,
  no_display: SYMPTOM.noGraphics,
  no_boot_device: SYMPTOM.noBoot,
  load_fault: STAGE_FAILED.operating_load,
  operational: L(
    "The computer starts, loads the operating system and holds the modelled load.",
    "الكمبيوتر يشتغل، يحمّل نظام التشغيل، ويتحمّل الضغط في النموذج.",
  ),
};

export const DISCLAIMER = L(
  "This is an educational model of power, startup and heat. It is not firmware emulation, a benchmark or an exact physical simulation; real hardware can behave differently.",
  "هذا نموذج تعليمي للطاقة والتشغيل والحرارة. مو محاكاة للبايوس، ولا اختبار أداء، ولا محاكاة فيزيائية دقيقة؛ والقطع الحقيقية ممكن تتصرف غير.",
);
