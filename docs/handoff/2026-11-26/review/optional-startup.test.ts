// Independent Codex probe: finishing optional items must not become an invented POST requirement.
import { afterEach, expect, it } from 'vitest';
import { pc } from '@ytl/simulation';
import { pcCatalog } from '../../../../apps/web/components/pc/catalog';
import { planModel } from '../../../../apps/web/components/pc/plan-model';
import {
 activateSimpleModel, LEGACY_MODEL, createSimpleBuild, simplePartOrder, partSpec,
 installSimplePart, simplePartInstalled, simpleCablesFor, connectSimpleCable,
 simpleAllPartsIn, pressSimplePower,
} from '../../../../apps/web/components/pc/simple-model';

afterEach(() => activateSimpleModel(LEGACY_MODEL));
it('boots a sound build even when an optional additional case fan has not been fitted', () => {
 activateSimpleModel(planModel({version:1,purpose:'gaming',workload:'1080p',parts:{
  case:'corsair-4000d-airflow-black',motherboard:'asus-tuf-gaming-z790-plus-wifi',
  cpu:'intel-core-i5-14600k',cooler:'arctic-freezer-36',psu:'corsair-rm850x-atx31',
  gpu:'asus-dual-rtx5060-o8g',ram:{id:'corsair-vengeance-rgb-ddr5-6000-32gb-kit',modules:2},
  storage:['samsung-990-pro-1tb'],fans:['arctic-p12-pwm-pst'],
 }}));
 let state=createSimpleBuild();
 for(const key of simplePartOrder(state)){
  if(partSpec(key).catalogId==='arctic-p12-pwm-pst' || simplePartInstalled(state,key)) continue;
  const fit=installSimplePart(state,key);
  if(!fit.ok) throw new Error(`${key}: ${fit.reason}`);
  state=fit.state;
 }
 for(const lead of simpleCablesFor(state).filter(c=>c.essential)){
  const fit=connectSimpleCable(state,lead.key);
  if(!fit.ok) throw new Error(`${lead.key}: ${fit.reason}`);
  state=fit.state;
 }
 for(const action of [
  {type:'set_side_panel',open:false}, {type:'set_wall_power',connected:true},
  {type:'set_psu_switch',on:true},
 ] as const){
  const r=pc.applyAction(state,action,pcCatalog);
  if(!r.ok) throw new Error(r.rejection.message.en);
  state=r.state;
 }
 expect(simpleAllPartsIn(state)).toBe(false);
 const power=pc.applyAction(state,{type:'press_power'},pcCatalog);
 if(!power.ok) throw new Error(power.rejection.message.en);
 expect(pc.evaluateStartup(power.state,pcCatalog).outcome,'the engine permits startup').toBe('operational');
 expect(pressSimplePower(state).ok,'the learner flow must not add an optional-fan boot requirement').toBe(true);
});
