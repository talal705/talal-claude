# PC catalog manifest

Data: `content/catalog/` (typed TypeScript, checked against `packages/contracts/src/pc.ts`). Rules: `packages/simulation/src/pc/`. Checks: `packages/simulation/src/pc/catalog.test.ts` (`validateCatalog`, `countCatalog`).

Catalog version `2026.10.27-1` (see below; history in Git). Sources were first fetched on 2026-10-10; later fetches (spec sheets 2026-10-11, card fan counts 2026-10-12, board back panels 2026-10-15) carry their own date in each source record.

## Status against the owner's decision 10 (2026-10-27)

The twenty-per-category target of the brief was replaced by **exactly two offered options per main category** (`docs/DECISIONS.md`, decision 10). Catalog version `2026.10.27-1`. Entries that are no longer offered stay in the data as archived (`ARCHIVED_CATALOG_IDS` in `content/catalog/catalog.ts`) so that saved builds still replay; the part picker never lists them, and a saved build that uses them says which parts are no longer offered.

| Category | Offered (2) | Notes |
|---|---|---|
| Cases | Corsair 4000D Airflow; Fractal North (mesh) | |
| Motherboards | ASUS TUF GAMING Z790-PLUS WIFI (DDR5); ASUS TUF GAMING Z790-PLUS WIFI D4 (DDR4, new) | D4: techspec, CPU support page and BIOS list fetched 2026-10-27; its manual was not found, so no recommended memory population and no per-module maximum are modelled (listed in `unverifiedFields`) |
| CPUs | Intel Core i5-14600K; Intel Core i7-14700K (new) | i7 from intel.com, fetched 2026-10-27: 20 cores / 28 threads, 125 W base / 253 W turbo, UHD Graphics 770, DDR5-5600 and DDR4-3200, 192 GB. Both CPUs are on both boards' support lists since BIOS 1205 |
| RAM | Corsair Vengeance RGB DDR5-6000 2x16 GB; Corsair Vengeance LPX DDR4-3600 2x8 GB | one DDR5 configuration, one DDR4 configuration |
| GPUs | ASUS Dual RTX 4060 OC; ASUS TUF RTX 4070 Ti SUPER OC | |
| Power supplies | Corsair RM850x (ATX 3.1, modular); Corsair CX550 (fixed cables) | each with its own correct cables |
| Storage | Samsung 990 PRO 1 TB (NVMe); Samsung 870 EVO 1 TB (SATA) | SATA data cables come with the boards (ASUS accessories list: 2 per board) |
| Fans | ARCTIC P12 PWM PST; ARCTIC P12 PWM PST A-RGB | |
| Cooling | ARCTIC Freezer 36 (air); ARCTIC Liquid Freezer III 240 A-RGB (AIO) | |

Starter configurations (parts only; since S3 they are laid out on the workbench, never assembled automatically): `i5-ddr4-air` (Starter A) and `i7-ddr5-rgb-aio` (Starter B).

No monitor and no display cable are offered or required (decision 11). HDMI and DisplayPort outputs remain as real I/O on boards and cards.

Archived (not offered, kept for saved builds): Intel Core i9-14900K, AMD Ryzen 5 5600, ASUS TUF GAMING B550-PLUS, ASUS ROG Strix RTX 4090 and the RTX 3060/5090 entries, Corsair RM850x SHIFT, the generic low-profile cooler, the generic SATA data, HDMI and DisplayPort cables, and the generic monitor.

Only real rules decide compatibility: the engine test "every mix of the two offered options per category" builds all 512 combinations through the engine's own placement and cable queries. Its outcomes follow from the specifications (memory generation must match the board; cooler height against the case limit; power demand against the supply). Colour, name and starter kit never decide anything. A cooler taller than the case allows is refused at placement as an impossible fit (Freezer 36 in the North: 159 mm against 145 mm); in the 512-combination test that build then shows `cooler_missing` at power-on because the refused cooler stays on the bench.

## Visual assets

Every entry has original procedural educational geometry, generated from its catalog data by `packages/simulation/src/pc/visual/` (pure TypeScript, deterministic):

- `assets/pc/geometry/<catalogId>.json` — geometry schema 2: part-local frame in millimetres (+y up, origin at the minimum corner of the bounds), solids by centre and size, mount frames with insertion direction and travel, port openings with facing, captive-cable exits, inspect zones, light sources (only on entries with lighting hardware), attach frames per mounting role (the AIO cooler has two rigid groups, `block` and `radiator`). Used by the 3D scene.
- `assets/pc/thumbnails/<catalogId>.svg` — orthographic drawings from the same geometry, one or more views side by side, with the printed markings and pin dots.
- `assets/pc/manifest.json` — one row per entry: paths, generator version, provenance, licence line ("Original work created for the Your Tech Lab project. Licence to be set by the project owner."), the label "Educational model — not manufacturer-accurate", orientation and scale.

What is and is not from a source: each axis of the bounds is marked `catalog` when it equals a catalog dimension, and every solid carries a `basis` — `catalog`, `standard` or `schematic`. Outer sizes, counts (slots, sockets, fans, headers) and the board back-panel lists come from the catalog; positions of connectors on a part are schematic (manufacturers do not publish coordinates). Pin dots appear only where the connector's own name states the count. Markings use the code in the catalog label (CPU_FAN, DIMM_A2, SATA6G_1) and otherwise the catalog port ID in capitals, which is not the board's real silkscreen.

Checks: `validateAssets(catalog, files, requireAll)` — files exist and are byte-for-byte what the generator produces from the current catalog; bounds equal the catalog dimensions; every mount point, port, zone, lighting zone, captive cable and mounting role of the entry is present and nothing extra; every solid is inside the bounds; mounts do not overlap unless the catalog says they block each other; the educational label is present; no two entries share identical geometry; a minimum set of detail per category (a bare box fails). The tests in `visual.test.ts` run it over all entries. Regenerate with `UPDATE_ASSETS=1 npx vitest run packages/simulation/src/pc/visual`.

Not modelled in the drawings: exterior looks (the case drawing is the open-side layout, not the outside), collisions between parts, the case's pre-installed fans, DisplayPort outputs that the fetched card pages do not list.

## How the sources were obtained

- Pages were fetched on 2026-10-10 with `curl` sending browser-style request headers, because the WebFetch tool was unavailable at the time. No challenge page was solved or bypassed; sites that refused were left alone (list below).
- intel.com refused the first request for the i5-14600K page and answered a second one with fuller headers. The lead ruled that this must not be repeated, re-checked that entry through WebFetch and confirmed every value. From that ruling on, only WebFetch is used; the i9-14900K entry and its support-list row were fetched with WebFetch.
- All entries have since been re-fetched through WebFetch; results are in the re-verification table below. One entry (AMD Ryzen 5 5600) could not be confirmed that way.
- The ASUS CPU support lists and BIOS lists come from the JSON endpoints that the ASUS support page itself calls, not from a rendered page.
- The two ASUS manuals are PDF files from ASUS's download server. Text was extracted with macOS PDFKit; the B550 memory figure (page 1-10) is a drawing and was read from a rendered image of that page.

## Re-verification through WebFetch (2026-10-11)

Every remaining entry was fetched again with WebFetch only. ARCTIC product pages are cut off before their specification block, so ARCTIC's own spec-sheet PDFs were fetched instead and their text read. The two ASUS manuals fetched through WebFetch are byte-identical to the copies read earlier.

| Entry | Result | Notes |
|---|---|---|
| i5-14600K, Corsair 4000D, ROG Strix RTX 4090, Samsung 990 PRO, Fractal North, Z790-PLUS WIFI spec page, RM850x, Vengeance RGB DDR5 | confirmed (lead) | See `docs/PROGRESS.md`. |
| i9-14900K | confirmed | Fetched with WebFetch from the start. |
| ARCTIC Freezer 36 | confirmed, now `verified` | Spec sheet: LGA1851/LGA1700, AM5/AM4; 104 x 126 x 159 mm; 2x P12 PWM PST; 4-pin PWM connector + 4-pin plug; SKU ACFRE00123A. |
| ARCTIC Liquid Freezer III 240 A-RGB | confirmed, now `verified` | Spec sheet: LGA1851/LGA1700, AM5/AM4; radiator 277 x 120 x 38 mm; all-in-one 4-pin PWM connector; 3-pin A-RGB connector. |
| ARCTIC P12 PWM PST | confirmed, now `verified` | Spec sheet: 120 x 120 x 25 mm; 200-1800 rpm; 4-pin connector + 4-pin socket; SKU ACFAN00120A. |
| ARCTIC P12 PWM PST A-RGB | corrected, now `verified` | Part number was unknown; spec sheet gives SKU ACFAN00231A for the black single fan with the EAN already recorded. Other values confirmed (200-2000 rpm, 12 LEDs, 3-pin 5V-DI-GND). |
| Samsung 870 EVO 1TB | confirmed, now `verified` | 2.5 inch; SATA 6 Gb/s; 1,000 GB; 100 x 69.85 x 6.8 mm; MZ-77E1T0B/EU in the page header. |
| Corsair Vengeance LPX DDR4 kit | confirmed | All table values match. Dimensions are not published. |
| Corsair RM850x SHIFT | confirmed | Table and cable list match; "Fully modular, Type-5 connectors" is on the page (not in the table). |
| Corsair CX550 | confirmed | Table and cable list match; "125mm-long casing" in the text; width and height not published. |
| Corsair cable-compatibility page | confirmed | Warning sentence and the Type 3/Type 4 note match word for word. The per-model table cannot be read reliably from text; the cable type of each unit comes from its own product page. |
| ASUS Dual RTX 4060 OC | confirmed | Interface row lists one HDMI only; no DisplayPort count on the page, so none is modelled. No Aura row. |
| ASUS TUF RTX 4070 Ti SUPER OC | confirmed | Interface row lists two HDMI only; no DisplayPort count on the page. Adapter cable "(1 to 2)" confirmed. |
| NVIDIA RTX 4060 and RTX 4070 family pages | confirmed | 115 W and 285 W total graphics power; column order checked. |
| Z790-PLUS WIFI: CPU rows, BIOS list, manual | confirmed | i5-14600K since 1205; 28 BIOS versions identical; manual PDF byte-identical. |
| B550-PLUS: CPU row, BIOS list, manual | confirmed | Ryzen 5 5600 since 2423; 34 BIOS versions identical; manual PDF byte-identical. |
| AMD Ryzen 5 5600 | **not confirmable** | WebFetch attempts on amd.com by pcsim and by the lead all timed out (the specification table page is very large). The entry rests on the single earlier fetch; the lead decided it stays `partially_verified` and keeps its place in the preset. |
| NVIDIA RTX 4090 page | not re-fetched | The lead confirmed the ASUS page; the 450 W figure and "3x PCIe 8-pin" adapter note rest on the earlier fetch. |

## Brands and pages that could not be fetched

Named in the brief or wanted for variety, refused or challenged, and therefore absent:

| Brand / page | Result | Consequence |
|---|---|---|
| Kingston (storage, memory) | 403 challenge page | No Kingston entry. The brief asks for verified Kingston storage. |
| MSI | Product spec page loads; CPU-support and BIOS endpoints refuse | No MSI board (a board needs its support list). |
| Gigabyte | Product spec page loads; support page refuses | No Gigabyte board. |
| ASRock | Challenge script | Not used. |
| Noctua | 429 challenge | No Noctua cooler or fan. |
| be quiet!, Seasonic | 403 challenge | Not used. |
| HYTE (Y60/Y70) | Not attempted | No entry. |
| Lian Li O11 | Page loads, no readable specification table | No entry. |

The owner can supply specification sheets for these, or the lead can decide another route.

## Entries and the values taken from each source

Dimensions are length x width x height as the manufacturer prints them. "Unverified" lists what was not read from the source.

### Cases

**`corsair-4000d-airflow-black`** — Corsair 4000D AIRFLOW Tempered Glass Mid-Tower ATX Case — Black, CC-9011200-WW
Source: https://www.corsair.com/us/en/p/pc-cases/cc-9011200-ww/4000d-airflow-tempered-glass-mid-tower-atx-case-black-cc-9011200-ww
Taken: 453 x 230 x 466 mm; Mini-ITX / MicroATX / ATX / E-ATX; maximum GPU length 360 mm; maximum CPU cooler height 170 mm; maximum PSU length 220 mm; radiator front 360/280/240 mm, rear 120 mm; fans top 2x120/2x140, front 3x120/2x140, rear 1x120; front I/O USB 3.1 Type-C, USB 3.0, audio; two 120 mm AirGuide fans; 2x 2.5-inch and 2x 3.5-inch drives; tempered glass.
Unverified: power-switch lead (not listed; assumed); connector and position of the two included fans (3-pin taken from the spare-part listing); no top radiator mount is modelled because the table lists front and rear only; fastener counts.

**`fractal-north-charcoal-black-mesh`** — Fractal Design North Charcoal Black, FD-C-NOR1C-01
Source: https://www.fractal-design.com/products/cases/north/north/charcoal-black/
Taken: 447 x 215 x 469 mm; ATX / Micro ATX / Mini ITX; GPU max length 355 mm; CPU cooler max height 145 mm; PSU max length 255 mm; radiators top 120/240, front 120/140/240/280/360, rear 120; fans front 3x120 or 2x140, top 2x120/140, side 2x120/140, rear 1x120; included 2x Aspect 14 PWM (front); left panel ventilated mesh; front I/O 2x USB-A, 1x USB-C, audio, microphone, power button; 2 dedicated 2.5-inch and 2 combined 3.5/2.5-inch mounts.
Unverified: fan plug type (inferred from the name "PWM"); side radiator mount not modelled; fastener counts.
Note for the reviewer: the page prints 145 mm cooler height together with the mesh panel for this SKU. It is used exactly as printed.

### Motherboards

**`asus-tuf-gaming-z790-plus-wifi`** — ASUS TUF GAMING Z790-PLUS WIFI
Sources: tech specs https://www.asus.com/motherboards-components/motherboards/tuf-gaming/tuf-gaming-z790-plus-wifi/techspec/ ; CPU support endpoint (`GetPDQVLCPU`, model `tuf-gaming-z790-plus-wifi`); BIOS endpoint (`GetPDBIOS`); manual E21279 https://dlcdnets.asus.com/pub/ASUS/mb/LGA1700/TUF_GAMING_Z790-PLUS_WIFI/E21279_TUF_GAMING_Z790-PLUS_WIFI_UM_WEB.pdf
Taken: LGA1700, Z790, ATX 30.5 x 24.4 cm; 4 x DIMM DDR5, max 128 GB; manual: 8/16/32 GB DIMMs, "DO NOT install a ... DDR4 memory module to the DDR5 slot", recommended configurations 1 module DIMM_A2, 2 modules DIMM_A2 + DIMM_B2, 4 modules all; 1 x PCIe 5.0 x16; M.2_1 (2242-22110, PCIe 4.0 x4), M.2_2 (2242-2280, PCIe 4.0 x4), M.2_3 (2242-22110, PCIe 4.0 x4), M.2_4 (2242-2280, PCIe 4.0 x4 and SATA); 4 SATA; headers CPU_FAN, CPU_OPT, AIO_PUMP, 4 chassis fan, 3 addressable Gen 2, 1 Aura RGB, front audio, USB 3.2 Gen 2 Type-C, USB 3.2 Gen 1, 2 USB 2.0, system panel (PWRSW, RESET, PLED, HDD_LED); 24-pin + 2 x 8-pin power, "Ensure to connect the 8-pin power plugs"; rear DisplayPort and HDMI; M.2 Q-Latch; nine motherboard screws; no BIOS FlashBack listed. CPU support: i5-14600K and i9-14900K validated since BIOS 1205. BIOS list: 28 versions from 0802 (2022-11-22) to 1840 (2026-09-23).
Unverified: fastener counts other than the two above; PCIe lane count; on-board lighting (none listed, modelled as none).
Back panel (`rearPanel`, from the tech-spec page "Back Panel I/O Ports", WebFetch 2026-10-15): USB 3.2 Gen 2x2 Type-C, 3 x USB 3.2 Gen 2 (2 Type-A + 1 Type-C), 4 x USB 3.2 Gen 1 Type-A, DisplayPort, HDMI, Wi-Fi module, Intel 2.5Gb Ethernet, 5 audio jacks, optical S/PDIF.
Memory total: 128 GB is used, from the manual E21279 (specifications summary: "4 x DIMM, Max. 128GB, DDR5"; memory section: 8/16/32 GB DIMMs). The spec page also shows 192 GB; that figure is not used until a document says which modules and BIOS it applies to.

**`asus-tuf-gaming-b550-plus`** — ASUS TUF GAMING B550-PLUS
Sources: manual E16576 https://dlcdnets.asus.com/pub/ASUS/mb/SocketAM4/TUF_GAMING_B550-PLUS/E16576_TUF_GAMING_B550-PLUS_UM_WEB.pdf ; CPU support endpoint (`GetPDCPUList`, model `tuf-gaming-b550-plus`); BIOS endpoint (`GetPDBIOS`)
Taken: AM4, B550; 4 x DIMM DDR4, max 128 GB; recommended configurations (figure, page 1-10) 1 module DIMM_B2, 2 modules DIMM_A2 + DIMM_B2, 4 modules all; 1 x PCIe 4.0 x16; M.2_1 (2242-22110, PCIe 4.0 x4 and SATA), M.2_2 (2242-22110, PCIe 3.0 x4 and SATA); 6 SATA; headers CPU_FAN, CPU_OPT, AIO_PUMP, 3 chassis fan, 1 addressable Gen 2, 2 Aura RGB, front audio, USB 3.2 Gen 1, 2 USB 2.0, system panel (PLED, HDD_LED, PWRSW, RESET); 24-pin + 1 x 8-pin power; rear DisplayPort and HDMI; BIOS FlashBack button. CPU support: Ryzen 5 5600 since BIOS 2423. BIOS list: 34 versions from 0242 (2020-05-20) to 3645 (2026-09-14).
Unverified: outline dimensions (ATX standard size used); maximum capacity per module; fastener counts; PCIe lane count; on-board lighting.
Back panel (`rearPanel`, from the tech-spec page https://www.asus.com/us/motherboards-components/motherboards/tuf-gaming/tuf-gaming-b550-plus/techspec/ "Back I/O Ports", WebFetch 2026-10-15): DisplayPort, HDMI, 2.5G LAN, 2 x USB 3.2 Gen 2 (1 Type-A + 1 Type-C), 4 x USB 3.2 Gen 1 Type-A, 2 x USB 2.0, optical S/PDIF, 5 audio jacks, BIOS FlashBack button.

### CPUs

**`intel-core-i5-14600k`** — https://www.intel.com/content/www/us/en/products/sku/236799/intel-core-i5-processor-14600k-24m-cache-up-to-5-30-ghz/specifications.html
Taken: FCLGA1700; 14 cores (6P + 8E), 20 threads; Processor Base Power 125 W; Maximum Turbo Power 181 W; max memory 192 GB; up to DDR5 5600 MT/s, up to DDR4 3200 MT/s; Intel UHD Graphics 770; package 45.0 x 37.5 mm. Re-checked by the lead through WebFetch.
Unverified: `coolerIncluded` (the page gives a thermal solution specification, PCG 2020A, and lists no boxed cooler).

**`intel-core-i9-14900k`** — https://www.intel.com/content/www/us/en/products/sku/236773/intel-core-i9-processor-14900k-36m-cache-up-to-6-00-ghz/specifications.html (WebFetch)
Taken: FCLGA1700; 24 cores (8P + 16E), 32 threads; 125 W base; 253 W maximum turbo; 192 GB; DDR5 5600 / DDR4 3200; Intel UHD Graphics 770; 45.0 x 37.5 mm.
Unverified: `coolerIncluded`, as above.

**`amd-ryzen-5-5600`** — https://www.amd.com/en/products/specifications/processors.html (row "AMD Ryzen 5 5600")
Taken: 6 cores, 12 threads; socket AM4; default TDP 65 W; thermal solution (PIB) AMD Wraith Stealth; system memory type DDR4, specification 3200; graphics model "Discrete Graphics Card Required"; boxed product ID 100-100000927BOX.
Unverified: dimensions; maximum package power (the load model uses the 65 W TDP); maximum memory.

### RAM

**`corsair-vengeance-rgb-ddr5-6000-32gb-kit`** — CMH32GX5M2B6000C36 — https://www.corsair.com/us/en/p/memory/cmh32gx5m2b6000c36/vengeance-rgb-32gb-2x16gb-ddr5-dram-6000mt-s-cl36-memory-kit-black-cmh32gx5m2b6000c36
Taken: 32 GB (2 x 16 GB); DDR5 UDIMM 288-pin; tested 6000 MT/s, latency 36, 1.25 V; SPD speed 4800 MHz; performance profile "Intel XMP"; ten-zone addressable RGB per module.
Unverified: dimensions, module height; profile version (the table gives no version; "XMP 3.0" is from the feature heading "CUSTOM INTEL XMP 3.0 PROFILES", not seen in the lead's re-check).

**`corsair-vengeance-lpx-ddr4-3600-16gb-kit`** — CMK16GX4M2D3600C18 — https://www.corsair.com/us/en/p/memory/cmk16gx4m2d3600c18/vengeancea-lpx-16gb-2-x-8gb-ddr4-dram-3600mhz-c18-memory-kit-black-cmk16gx4m2d3600c18
Taken: 16 GB (2 x 8 GB); DDR4 UDIMM 288-pin; tested 3600 MT/s, latency 18, 1.35 V; SPD speed 2133 MHz; XMP 2.0; no lighting.
Unverified: dimensions, module height.

### GPUs

Power figures (`powerDrawW`) are NVIDIA's "Total Graphics Power" for the chipset's reference specification, not measurements of the partner card.

**`asus-dual-rtx4060-o8g`** — DUAL-RTX4060-O8G — https://www.asus.com/us/motherboards-components/graphics-cards/dual/dual-rtx4060-o8g/techspec/ ; https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4060-4060ti/
Taken: two fans ("two powerful Axial-tech fans", product page); 227.2 x 123.24 x 49.6 mm; 2.5 slot; recommended PSU 550 W; 1 x 8-pin; 1 x HDMI 2.1a; no Aura row. NVIDIA: RTX 4060 total graphics power 115 W.
Unverified: DisplayPort outputs (not listed on the fetched page, not modelled).

**`asus-tuf-rtx4070tis-o16g-gaming`** — TUF-RTX4070TIS-O16G-GAMING — https://www.asus.com/us/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx4070tis-o16g-gaming/techspec/ ; https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4070-family/
Taken: three fans ("the three Axial-tech fans", global product page https://www.asus.com/motherboards-components/graphics-cards/tuf-gaming/tuf-rtx4070tis-o16g-gaming/); 305 x 138 x 65 mm; 3.25 slot; recommended PSU 750 W; 1 x 16-pin; 2 x HDMI 2.1a; Aura Sync ARGB; accessory "1 x Adapter Cable (1 to 2)". NVIDIA: RTX 4070 Ti SUPER total graphics power 285 W.
Unverified: DisplayPort outputs (not listed, not modelled); 16-pin revision (modelled as 12VHPWR, which mates with 12V-2x6).

**`asus-rog-strix-rtx4090-o24g-gaming`** — ROG-STRIX-RTX4090-O24G-GAMING — https://rog.asus.com/graphics-cards/graphics-cards/rog-strix/rog-strix-rtx4090-o24g-gaming-model/spec/ ; https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4090/
Taken: three fans ("the three Axial-tech fans", product page); 357.6 x 149.3 x 70.1 mm; 3.5 slot; recommended PSU 1000 W; 1 x 16-pin; 2 x HDMI 2.1a, 3 x DisplayPort 1.4a; Aura Sync ARGB; accessory "1 x Adapter Cable". NVIDIA: RTX 4090 total graphics power 450 W; "3x PCIe 8-pin cables (adapter in box)".
Unverified: adapter input count (three, from NVIDIA's page, not from ASUS); 16-pin revision.

### Power supplies

Cable compatibility: https://www.corsair.com/uk/en/s/psu-cable-compatibility — "Type 3 and Type 4 modular PSU cables are not compatible with Type 5 power supplies. Using incorrect PSU cables may damage hardware."

**`corsair-rm850x-atx31`** — CP-9020270-NA — https://www.corsair.com/us/en/p/psu/cp-9020270-na/rmx-series-rm850x-fully-modular-power-supply-cp-9020270-na
Taken: 850 W continuous; Cybenetics Gold; fully modular; cable type Type 4; ATX12V 3.1; 160 x 150 x 86 mm; cables: 24-pin ATX x1, EPS 4+4 x2, PCIe 12V-2x6 (12+4) x1, PCIe 6+2 x3 (one plug each), SATA x2 (four plugs each), PATA x1 (three plugs).
Unverified: number and grouping of modular sockets on the unit.

**`corsair-rm850x-shift`** — CP-9020299-NA — https://www.corsair.com/us/en/p/psu/cp-9020299-na/rm850x-shift-fully-modular-atx-power-supply-cp-9020299-na
Taken: 850 W; Cybenetics Gold; cable type Type 5; ATX12V 3.1; 160 x 150 x 86 mm; cables: 24-pin ATX x1, EPS 4+4 x2, PCIe 6+2 x2, 12V-2x6 to 12V-2x6 x1, 12V-2x6 to 2x PCIe 6+2 x1, SATA x3 (three plugs each), PATA x1 (four plugs).
Unverified: modular socket count and grouping; `modularity` (in the product name, not in the table).

**`corsair-cx550`** — CP-9020277-NA — https://www.corsair.com/us/en/p/psu/cp-9020277-na/cx-series-cx550-550-watt-80-plus-bronze-atx-power-supply-cp-9020277-na
Taken: 550 W; 80 PLUS Bronze; not modular; ATX; ATX12V v2.31; 125 mm long; cables: 24-pin x1, EPS 4+4 x1, one PCIe cable with two 6+2 plugs, SATA x1 (three plugs), PATA x1 (two plugs).
Unverified: width and height.

### Storage

**`samsung-990-pro-1tb`** — MZ-V9P1T0BW — https://www.samsung.com/uk/memory-storage/nvme-ssd/990-pro-1tb-nvme-pcie-gen-4-mz-v9p1t0bw/ — verified
Taken: M.2 (2280); PCIe Gen 4.0 x4, NVMe 2.0; 1,000 GB; 80 x 22 x 2.3 mm.

**`samsung-870-evo-1tb`** — MZ-77E1T0B/EU — https://www.samsung.com/uk/memory-storage/sata-ssd/870-evo-1tb-sata-3-2-5-ssd-mz-77e1t0b-eu/
Taken: 2.5 inch; SATA 6 Gb/s; 1,000 GB; 100 x 69.85 x 6.8 mm. Verified.

### Fans

**`arctic-p12-pwm-pst`** — ACFAN00120A — https://www.arctic.de/en/P12-PWM-PST/ACFAN00120A
Taken: 120 x 120 x 25 mm; 200-1800 rpm PWM; 4-pin connector + 4-pin socket.
Verified (also on the spec sheet https://www.arctic.de/media/42/84/78/1693306001/Spec_Sheet_P12_PWM_PST_EN.pdf). The daisy-chain socket is not modelled.

**`arctic-p12-pwm-pst-argb`** — ACFAN00231A — https://www.arctic.de/en/P12-PWM-PST-A-RGB (EAN 4895213703154); spec sheet https://www.arctic.de/media/4d/1d/d5/1696578108/Spec_Sheet_P12_PWM_PST_A-RGB_EN.pdf
Taken: 120 x 120 x 25 mm; 200-2000 rpm PWM; 4-pin connector + 4-pin socket; 12 A-RGB LEDs; 3-pin 5 V-DI-GND connector.
Verified. Daisy-chain sockets are not modelled.

### Cooling

**`arctic-freezer-36`** — ACFRE00123A — https://www.arctic.de/en/Freezer-36-Black/ACFRE00123A
Taken: Intel LGA1851 / LGA1700, AMD AM5 / AM4; 104 x 126 x 159 mm; 2x P12 PWM PST; 4-pin PWM connector + 4-pin plug.
Also: spec sheet https://www.arctic.de/media/6b/50/57/1709195123/Spec_Sheet_Freezer_36_EN.pdf (same values). Verified. Cooling capacity is not published and is left `null`.

**`arctic-liquid-freezer-iii-240-argb`** — ACFRE00142A — https://www.arctic.de/en/Liquid-Freezer-III-240-A-RGB/ACFRE00142A
Taken: Intel 1851 / 1700, AMD AM5 / AM4; radiator 277 x 120 x 38 mm; 2x P12 PWM PST A-RGB pre-installed; all-in-one 4-pin PWM connector; 3-pin A-RGB connector.
Also: spec sheet https://www.arctic.de/media/8e/66/69/1708429821/Spec_Sheet_Liquid_Freezer_III_240_A-RGB_EN.pdf (same values). Verified. Cooling capacity is not published and is left `null`.

**`generic-low-profile-air-cooler`** — generic educational part, not a product. All figures (95 x 95 x 55 mm, 65 W teaching capacity, sockets) are teaching values.

## Teaching rules and assumptions

These are stated in the data (`teachingNotes`) and in every startup result's disclaimer. They are an educational model, not firmware emulation, a benchmark or a physical simulation.

- **Factory BIOS.** A simulated board starts on the oldest BIOS in the manufacturer's download list. A real board ships with whatever was current when it was made. A CPU whose support-list row names a later version fails POST until `update_bios` reaches that version.
- **Fasteners.** Counts on mount points are typical values for teaching (9 motherboard screws from the ASUS manual; 4 PSU screws, 4 fan screws, 2 card bracket screws, 4 cooler mounting points, 8 radiator screws assumed). Unsecured fasteners are warnings, except the CPU socket lever (POST) and the cooler mounting (load stage).
- **Load stage.** Estimated draw = CPU maximum power (or base power when no maximum is published) + graphics card power + 50 W for everything else. Above the power supply's rated output it is a load-stage fault; the computer still starts and boots. Efficiency certificates never enter the calculation.
- **Cooling adequacy.** Judged only when the cooler has a capacity figure. No figure is invented for a real cooler, so the two ARCTIC coolers are checked for being fitted, fastened and running, not for adequacy. Only the generic 65 W cooler can produce "inadequate under sustained load".
- **Power connectors.** A board's first CPU power socket is required; a second one the manual says to connect is `recommended` (warning, not a fault).
- **Modular sockets.** The number of sockets on a modular power supply is not published; each unit is given exactly enough for its supplied cables. Cable family (Corsair Type 4 or Type 5) is enforced.
- **Pre-installed case fans** are part of the case: their leads are case cables and their positions are not tracked.
- **Memory.** One build instance is one module. A supported but non-recommended slot layout is an optional improvement. A rated speed above the default is a note about XMP/EXPO profiles, never an incompatibility.
- **Storage.** A drive added to the build is assumed to carry an operating system unless `set_storage_bootable` says otherwise.
- **Not modelled yet:** M.2/SATA lane sharing, GPU slot thickness against neighbouring slots, memory height against coolers, radiator thickness, the reduced GPU limit with a front radiator in the Fractal North, fan daisy-chaining, BIOS flashing procedure.
