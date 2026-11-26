import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { planModel } from '/Users/most/Documents/Codex/VTE-completion-2026-11-25/apps/web/components/pc/plan-model';
import * as M from '/Users/most/Documents/Codex/VTE-completion-2026-11-25/apps/web/components/pc/simple-model';
const plan={version:1,purpose:'gaming',workload:'1080p',parts:{
 case:'corsair-4000d-airflow-black',motherboard:'asus-tuf-gaming-z790-plus-wifi',cpu:'intel-core-i5-14600k',cooler:'arctic-freezer-36',psu:'corsair-rm850x-atx31',
 gpu:'asus-dual-rtx5060-o8g',ram:{id:'corsair-vengeance-rgb-ddr5-6000-32gb-kit',modules:2},storage:['samsung-990-pro-1tb','seagate-barracuda-2tb-st2000dm008'],fans:['arctic-p12-pwm-pst']}};
it('seed',()=>{
 M.activateSimpleModel(planModel(plan as never));
 const out:Record<string,unknown>={plan};
 const build=(skipFan:boolean,cables:'none'|'essential'|'all')=>{
  let state=M.createSimpleBuild(); let sn=M.emptySimpleSnapshot();
  for(const key of M.simplePartOrder(state)){
   if(skipFan&&M.partSpec(key).catalogId==='arctic-p12-pwm-pst') continue;
   const r=M.installSimplePart(state,key); if(!r.ok) throw new Error(key+r.reason); state=r.state; sn=M.withPart(sn,key);
  }
  for(const c of M.simpleCablesFor(state)){
   if(cables==='none'||(cables==='essential'&&!c.essential)) continue;
   const r=M.connectSimpleCable(state,c.key); if(!r.ok) throw new Error(c.key); state=r.state; sn=M.withCable(sn,c.key);
  }
  return {...sn,version:4,plan};
 };
 out.unwired=build(false,'none'); out.essentialNoFan=build(true,'essential'); out.allWhole=build(false,'all');
 out.cables=M.simpleCablesFor(M.createSimpleBuild()).map(c=>c.key);
 writeFileSync('/private/tmp/vte-seed.json',JSON.stringify(out));
});
