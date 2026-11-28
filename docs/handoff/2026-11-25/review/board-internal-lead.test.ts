// Codex review reproduction: currently fails; kept outside the ordinary product test suite.
import { afterEach, expect, it } from 'vitest';
import { planModel } from '../../../../apps/web/components/pc/plan-model';
import {
 activateSimpleModel, LEGACY_MODEL, createSimpleBuild, simplePartOrder,
 installSimplePart, simpleCablesFor, connectSimpleCable, firstAttachment,
 unscrewSimplePart, simpleLiftBlock,
} from '../../../../apps/web/components/pc/simple-model';

afterEach(() => activateSimpleModel(LEGACY_MODEL));
it('allows lifting a prepared board with its own cooler lead connected internally', () => {
 activateSimpleModel(planModel({version:1,purpose:'gaming',workload:'1080p',parts:{
  case:'corsair-4000d-airflow-black', motherboard:'asus-tuf-gaming-z790-plus-wifi',
  cpu:'intel-core-i5-14600k',cooler:'arctic-freezer-36',psu:'corsair-rm850x-atx31',
  gpu:'asus-dual-rtx5060-o8g',ram:{id:'corsair-vengeance-rgb-ddr5-6000-32gb-kit',modules:2},
  storage:['samsung-990-pro-1tb'],fans:[],
 }}));
 let state=createSimpleBuild();
 for(const key of simplePartOrder(state)){
  if(key==='psu'||key==='gpu') continue;
  const fit=installSimplePart(state,key);
  if(!fit.ok) throw new Error(`${key}: ${fit.reason}`);
  state=fit.state;
 }
 const lead=simpleCablesFor(state).find(c=>c.requires.includes('cooler'));
 if(!lead) throw new Error('fixture has no cooler lead');
 const joined=connectSimpleCable(state,lead.key);
 if(!joined.ok) throw new Error(`cooler lead: ${joined.reason}`);
 state=joined.state;
 while((firstAttachment(state,'motherboard')?.fastenersSecured??0)>0){
  const out=unscrewSimplePart(state,'motherboard');
  if(!out.ok)throw new Error(`screw: ${out.reason}`);
  state=out.state;
 }
 expect(simpleLiftBlock(state,'motherboard')).toBeNull();
});
