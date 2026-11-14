// Local microbenchmark, not HTTP/production capacity. Requires redis-server.
// Always uses a private Unix socket; never reads .env or contacts configured Redis.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const Redis = require('ioredis');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giggle-queue-benchmark-'));
  const socket = path.join(dir, 'redis.sock');
  const server = spawn('redis-server', ['--port','0','--unixsocket',socket,'--save','','--appendonly','no'], {stdio:'ignore'});
  let spawnError, redis;
  server.on('error', error => { spawnError = error; });
  try {
    for (let i=0;i<100 && !fs.existsSync(socket) && !spawnError;i++) await new Promise(resolve=>setTimeout(resolve,10));
    if (spawnError) throw spawnError;
    if (!fs.existsSync(socket)) throw new Error('Private Redis did not start');
    redis = new Redis(socket);
    await redis.ping();
    require.cache[require.resolve('../src/config/redisConfig')] = {exports:{redis}};
    const queue = require('../src/services/queueService');
    for (const count of [100,1000,10000]) {
      await redis.flushdb();
      const pipe = redis.pipeline();
      for (let i=0;i<count;i++) {
        const id=`s${String(i).padStart(5,'0')}`;
        pipe.zadd('matchmaking_queue:global',i,id);
        pipe.hset(`squad_meta:${id}`,{squadId:id,size:2,region:'global',tags:'games,music',reputationScore:100,queuedAt:Date.now()});
      }
      await pipe.exec();
      for (const mode of ['full-region-baseline','bounded-candidate-window']) {
        const options = mode === 'bounded-candidate-window' ? {seekerId:'benchmark'} : {};
        const samples=[];
        let returned=0, jsonBytes=0;
        for(let i=0;i<12;i++) {
          const start=performance.now();
          const rows=await queue.getQueuedSquadsByRegion('global',options);
          samples.push(performance.now()-start);
          returned=rows.length;
          jsonBytes=Buffer.byteLength(JSON.stringify(rows));
        }
        samples.sort((a,b)=>a-b);
        const burstStart=performance.now();
        await Promise.all(Array.from({length:25},()=>queue.getQueuedSquadsByRegion('global',options)));
        console.log(JSON.stringify({mode,queued:count,returned,metadataReadsPerCall:returned,
          medianMs:+samples[6].toFixed(2),maxMs:+samples[11].toFixed(2),
          concurrent25TotalMs:+(performance.now()-burstStart).toFixed(2),jsonBytes}));
      }
    }
  } finally {
    redis?.disconnect();
    if (!spawnError && server.exitCode === null) {
      const exited=new Promise(resolve=>server.once('exit',resolve));
      server.kill('SIGTERM');
      await exited;
    }
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
