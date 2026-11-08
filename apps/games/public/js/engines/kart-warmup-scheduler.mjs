// Preparation has a budget, separate from the lifetime of the game. Each
// submission gets its own task; a slow GPU promise never holds Ready hostage.
const task = () => globalThis.scheduler?.yield?.() ?? new Promise(resolve => setTimeout(resolve, 0));
const idle = () => new Promise(resolve => {
  if (globalThis.requestIdleCallback) {
    const next = deadline => deadline.didTimeout || deadline.timeRemaining() >= 4 ? resolve() : requestIdleCallback(next,{timeout:1000});
    requestIdleCallback(next,{timeout:1000});
  } else setTimeout(resolve, 32);
});

export function createKartWarmupScheduler({budgetMs=6000, signal, isAlive=()=>true,
  now=()=>performance.now(), yieldTask=task, idleTask=idle, onProgress=()=>{}}={}) {
  let background=false, started=false, finished=false, cancelled=false, release, resume;
  const released=new Promise(resolve=>{release=resolve;});
  const resumed=new Promise(resolve=>{resume=resolve;});
  const start=now();
  const defer=()=>{if(!finished){background=true;release();}};
  const timer=Number.isFinite(budgetMs)?setTimeout(defer,budgetMs):null;
  signal?.addEventListener('abort',defer,{once:true});
  if(signal?.aborted)defer();
  const alive=()=>{if(cancelled||!isAlive())throw Error('Retired kart renderer warmup');};
  return {
    isAlive:()=>!cancelled&&isAlive(),
    async step(work) {
      alive();
      if(now()-start>=budgetMs)defer();
      if(background){await resumed;alive();await idleTask();}
      else await yieldTask();
      alive();
      return work();
    },
    async run(work) {
      const done=(async()=>{
        try {await work();}
        finally {finished=true;clearTimeout(timer);signal?.removeEventListener('abort',defer);}
      })();
      // Always observe late failures, including retirement after Ready.
      done.catch(()=>{});
      await Promise.race([done,released]);
      return {done, continue(){if(!started){started=true;resume();}}, cancel(){cancelled=true;resume();}, get deferred(){return background;}};
    },
    progress(completed,total){onProgress({completed,total,background});},
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
