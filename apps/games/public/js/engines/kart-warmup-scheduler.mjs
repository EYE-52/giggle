// Loading only. Yielding cannot bound an atomic driver call (compile,
// reflection or upload), so unfinished work must STOP before play, not run
// in idle callbacks alongside the game's render loop.
const task = () => globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0));

export function createKartWarmupScheduler({budgetMs=6000, signal, isAlive=()=>true,
  now=()=>performance.now(), yieldTask=task, onProgress=()=>{}}={}) {
  let skipped=false, finished=false, cancelled=false, release;
  const released=new Promise(resolve=>{release=resolve;});
  const start=now();
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',expire);};
  const cancel=()=>{cancelled=true;cleanup();release();};
  const expire=()=>{if(!finished){skipped=true;cancel();}};
  const timer=Number.isFinite(budgetMs)?setTimeout(expire,budgetMs):null;
  signal?.addEventListener('abort',expire,{once:true});
  if(signal?.aborted)expire();
  const alive=()=>{if(cancelled||!isAlive())throw Error('Retired kart renderer warmup');};
  return {
    isAlive:()=>!cancelled&&isAlive(),
    async step(work) {
      alive();
      if(now()-start>=budgetMs)expire();
      await yieldTask();
      alive();
      return work();
    },
    async run(work) {
      const done=(async()=>{
        try {await work();}
        finally {finished=true;cleanup();}
      })();
      // Always observe late failures, including retirement after Ready.
      done.catch(()=>{});
      await Promise.race([done,released]);
      return {done,cancel,get skipped(){return skipped;}};
    },
    progress(completed,total){if(!cancelled)onProgress({completed,total});},
  };
}

// Audio decoding and optional preparation may finish later. The host's soft
// preparation deadline releases these waits without aborting any loader/game.
export function waitKartPreparation(promise,signal) {
  return new Promise((resolve,reject)=>{
    const release=()=>{signal?.removeEventListener('abort',release);resolve();};
    signal?.addEventListener('abort',release,{once:true});
    Promise.resolve(promise).then(value=>{signal?.removeEventListener('abort',release);resolve(value);},error=>{
      signal?.removeEventListener('abort',release);reject(error);
    });
    if(signal?.aborted)release();
  });
}
