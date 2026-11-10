// Does one PC engine action the way a learner does it in the list view: the part card's buttons,
// the destination list, the cable card and the power panel. Never calls the store.
// Elements are found by the engine IDs the page exposes (data-target, data-candidate, data-cable).
const portTarget = (to) => (to.kind === "part" ? `pc:port:${to.instanceId}/${to.portId}` : `pc:cable-end:${to.cableId}/${to.endId}`);

export function listDriver(page, t) {
  const card = (instanceId) => page.locator(`.pc-card[data-target="pc:component:${instanceId}"]`);
  const cable = (cableId) => page.locator(`.pc-card[data-cable="${cableId}"]`);
  const power = (label) => page.locator(".pc-power label", { hasText: label }).first().locator("input");
  const choose = async (candidate) => {
    const option = page.locator(`[role="option"][data-candidate="${candidate}"], [role="option"][data-candidate^="${candidate}@"]`).first();
    await option.waitFor({ timeout: 5000 });
    if ((await option.getAttribute("data-ok")) !== "true") throw new Error(`refused: ${candidate}: ${await option.innerText()}`);
    await option.click();
    await page.waitForSelector('[role="listbox"]', { state: "detached", timeout: 5000 });
  };

  return async function doStep(action) {
    switch (action.type) {
      case "update_bios":
        return card(action.instanceId).getByLabel(t.build.bios).selectOption(action.version);
      case "mount_part":
        await card(action.instanceId).locator(`button[aria-label^="${t.build.place}"]`).first().click();
        return choose(`pc:connector:${action.target.hostInstanceId}/${action.target.mountPointId}${action.role ? `@${action.role}` : ""}`);
      case "set_seating":
        return card(action.instanceId).locator(`button[aria-label^="${t.build.seat}:"]`).first().click();
      case "set_fasteners":
        return card(action.instanceId).locator(`button[aria-label^="${t.build.secureAll}:"], button[aria-label^="${t.build.secure}:"]`).first().click();
      case "connect_cable_end":
        await page.locator(`[data-target="pc:cable-end:${action.cableId}/${action.endId}"] button.button-primary`).first().click();
        return choose(portTarget(action.to));
      case "set_cable_tidy":
        return cable(action.cableId).locator('input[type="checkbox"]').check();
      case "set_side_panel":
        return power(t.power.sidePanel).setChecked(action.open);
      case "set_wall_power":
        return power(t.power.wall).setChecked(action.connected);
      case "set_psu_switch":
        return power(t.power.psuSwitch).setChecked(action.on);
      case "press_power":
        return page.locator(".pc-power").getByRole("button", { name: t.power.press, exact: true }).click();
      default:
        throw new Error(`no list control mapped for ${action.type}`);
    }
  };
}
