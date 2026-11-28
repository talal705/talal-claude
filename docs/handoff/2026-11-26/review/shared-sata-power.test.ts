// Independent review: two SATA plugs of one modular PSU lead share a physical source end.
import { afterEach, expect, it } from 'vitest';
import { planModel } from '../../../../apps/web/components/pc/plan-model';
import * as M from '../../../../apps/web/components/pc/simple-model';

afterEach(() => M.activateSimpleModel(M.LEGACY_MODEL));
it('keeps saved connection counts consistent with the physical shared PSU source', () => {
 M.activateSimpleModel(planModel({version:1,purpose:'gaming',workload:'1080p',parts:{
  case:'corsair-4000d-airflow-black',motherboard:'asus-tuf-gaming-z790-plus-wifi',
  cpu:'intel-core-i5-14600k',cooler:'arctic-freezer-36',psu:'corsair-rm850x-atx31',
  gpu:'asus-dual-rtx5060-o8g',ram:{id:'corsair-vengeance-rgb-ddr5-6000-32gb-kit',modules:2},
  storage:['samsung-870-evo-1tb','seagate-barracuda-2tb-st2000dm008'],fans:[],
 }}));
 let state=M.createSimpleBuild(), snapshot=M.emptySimpleSnapshot();
 for(const key of M.simplePartOrder(state)){
  if(M.simplePartInstalled(state,key)) continue;
  const r=M.installSimplePart(state,key);
  if(!r.ok) throw new Error(`${key}: ${r.reason}`);
  state=r.state; snapshot=M.withPart(snapshot,key);
 }
 const power=M.simpleCablesFor(state).filter(c=>c.key.startsWith('sataPower'));
 expect(power).toHaveLength(2);
 expect(power[0]!.id,'fixture uses one shared physical cable').toBe(power[1]!.id);
 for(const cable of power){
  for(const [index,end] of M.simpleCableEnds(cable.key).entries()){
   const r=M.plugSimpleEnd(state,cable.key,index,end.portId,false);
   if(!r.ok) throw new Error(r.reason);
   state=r.state; snapshot=M.withPlug(snapshot,cable.key,index,end.portId);
  }
 }
 expect(power.every(c=>M.simpleCableConnected(state,c.key))).toBe(true);
 expect(snapshot.connected).toEqual(expect.arrayContaining(power.map(c=>c.key)));
 const first=power[0]!;
 const sourceIndex=M.simpleCableEnds(first.key).findIndex(e=>e.instanceId===M.partSpec('psu').id);
 expect(sourceIndex).toBeGreaterThanOrEqual(0);
 const disconnected=M.withUnplug(snapshot,first.key,sourceIndex);
 const replayed=M.simpleBuildFromSnapshot(disconnected);
 expect(power.every(c=>!M.simpleCableConnected(replayed,c.key))).toBe(true);
 expect(disconnected.connected.filter(k=>power.some(c=>c.key===k)), 'unplugging the shared source disconnects both saved lead views').toEqual([]);

 // The earlier UI skipped the second source because it was physically already in, while its old
 // per-lead derivation counted only the first lead. That real pre-fix save must migrate, not reset.
 const second=power[1]!;
 const source2=M.simpleCableEnds(second.key).findIndex(e=>e.instanceId===M.partSpec('psu').id);
 const sourceEnd=M.simpleCableEnds(second.key)[source2]!;
 const legacy={...snapshot,
  history:snapshot.history.filter(st=>st!==`plug:${second.key}:${source2}@${sourceEnd.portId}`),
  connected:[first.key],
 };
 const migrated=M.parseSimpleSnapshot(JSON.parse(JSON.stringify(legacy)));
 expect(migrated,'preserve a valid save produced by the earlier shared-source UI').not.toBeNull();
 expect(migrated!.connected).toEqual(expect.arrayContaining(power.map(c=>c.key)));
 expect(power.every(c=>M.simpleCableConnected(M.simpleBuildFromSnapshot(migrated!),c.key))).toBe(true);
});
