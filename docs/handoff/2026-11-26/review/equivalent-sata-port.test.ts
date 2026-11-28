// Codex independent review probe: engine and learner adapter must accept the same equivalent SATA port.
import { afterEach, expect, it } from 'vitest';
import { pc } from '@ytl/simulation';
import { pcCatalog } from '../../../../apps/web/components/pc/catalog';
import { planModel } from '../../../../apps/web/components/pc/plan-model';
import {
 activateSimpleModel, LEGACY_MODEL, createSimpleBuild, simplePartOrder,
 installSimplePart, simplePartInstalled, simpleCablesFor, simpleCableEnds, plugSimpleEnd,
} from '../../../../apps/web/components/pc/simple-model';

afterEach(() => activateSimpleModel(LEGACY_MODEL));
it('accepts an equivalent unused SATA port that the engine accepts', () => {
 activateSimpleModel(planModel({version:1,purpose:'gaming',workload:'1080p',parts:{
  case:'corsair-4000d-airflow-black',motherboard:'asus-tuf-gaming-z790-plus-wifi',
  cpu:'intel-core-i5-14600k',cooler:'arctic-freezer-36',psu:'corsair-rm850x-atx31',
  gpu:'asus-dual-rtx5060-o8g',ram:{id:'corsair-vengeance-rgb-ddr5-6000-32gb-kit',modules:2},
  storage:['samsung-870-evo-1tb'],fans:[],
 }}));
 let state=createSimpleBuild();
 for(const key of simplePartOrder(state)){
  if(simplePartInstalled(state,key))continue;
  const fit=installSimplePart(state,key);
  if(!fit.ok)throw new Error(`${key}: ${fit.reason}`);
  state=fit.state;
 }
 const cable=simpleCablesFor(state).find(c=>c.key.startsWith('sataData'));
 if(!cable)throw new Error('fixture has no SATA data cable');
 const ends=simpleCableEnds(cable.key);
 const index=ends.findIndex(e=>e.instanceId===cable.instanceId);
 const end=ends[index]!;
 const host=state.parts.find(p=>p.instanceId===end.instanceId)!;
 const entry=pcCatalog.entries.find(e=>e.id===host.catalogId)!;
 const current=entry.ports.find(p=>p.id===end.portId)!;
 const alternate=entry.ports.find(p=>p.id!==end.portId&&p.connector===current.connector&&p.function===current.function);
 if(!alternate)throw new Error('fixture has no equivalent SATA port');
 const result=pc.applyAction(state,{type:'connect_cable_end',cableId:end.cableId,endId:end.endId,to:{kind:'part',instanceId:end.instanceId,portId:alternate.id}},pcCatalog);
 expect(result.ok,'engine accepts the alternate destination').toBe(true);
 expect(plugSimpleEnd(state,cable.key,index,alternate.id,false).ok,'adapter must not invent a wrong-port rejection').toBe(true);
});
