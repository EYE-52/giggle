/* Test-only observations and explicit DOM input diagnostics. Never imported
 * by production. The real app supplies every snapshot, action and deadline. */
(() => {
  // Observe real bank fetch/decode/resume/source lifetimes. The methods still
  // invoke the native Web Audio backend; this does not prove subjective sound.
  const audio = { loads: [], decodes: [], resumes: [], starts: [], stops: [] }, bytesToFile = new WeakMap(), buffersToFile = new WeakMap(), contexts = [];
  const contextId = context => { let id = contexts.indexOf(context); if (id < 0) { id = contexts.length; contexts.push(context); } return id; };
  const nativeFetch = window.fetch;
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args), url = String(args[0]?.url || args[0]);
    if (!url.includes('/assets/karts/audio/')) return response;
    const file = new URL(url, location.href).pathname.split('/').at(-1), read = response.arrayBuffer.bind(response);
    audio.loads.push({ file, status: response.status });
    response.arrayBuffer = async () => { const bytes = await read(); bytesToFile.set(bytes,file); return bytes; };
    return response;
  };
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC) {
    const decode = AC.prototype.decodeAudioData, resume = AC.prototype.resume, createSource = AC.prototype.createBufferSource;
    AC.prototype.decodeAudioData = function(bytes,ok,fail) {
      const file = bytesToFile.get(bytes), id = contextId(this); let seen = false;
      const decoded = buffer => { if (file && !seen) { seen = true; buffersToFile.set(buffer,file); audio.decodes.push({ file, context: id, duration: buffer.duration, channels: buffer.numberOfChannels, sampleRate: buffer.sampleRate }); } };
      const failed = error => { if (file && !seen) { seen = true; audio.decodes.push({ file, context: id, error: String(error) }); } };
      const result = decode.call(this,bytes,buffer => { decoded(buffer); ok?.(buffer); },error => { failed(error); fail?.(error); });
      result?.then?.(decoded,failed); return result;
    };
    AC.prototype.resume = function(...args) {
      const id = contextId(this), before = this.state, result = resume.apply(this,args);
      Promise.resolve(result).then(() => audio.resumes.push({ context:id,before,after:this.state }),error => audio.resumes.push({ context:id,error:String(error) })); return result;
    };
    AC.prototype.createBufferSource = function(...args) {
      const source = createSource.apply(this,args), id = contextId(this), start = source.start, stop = source.stop;
      source.start = function(...values) { const result = start.apply(this,values), file = buffersToFile.get(this.buffer); if (file && audio.starts.length < 1000) audio.starts.push({ file,context:id,at:performance.now(),loop:this.loop }); return result; };
      source.stop = function(...values) { const result = stop.apply(this,values), file = buffersToFile.get(this.buffer); if (file && audio.stops.length < 1000) audio.stops.push({ file,context:id,at:performance.now() }); return result; };
      return source;
    };
  }
  const NativeSocket = window.WebSocket;
  let state, activeRun, socket, lastFrame = 0;
  const reports = [], nativeKeys = [], nativeActions = [];
  const self = () => state?.karts?.find(k => (k.id || k.pid) === state.you);
  const pose = () => {
    const k = self();
    return k && { position: k.pose?.position || { x: k.x, z: k.z }, speed: k.pose?.speed ?? k.speed,
      nitro: k.nitro, nitroActive: k.nitroActive, alive: k.alive ?? k.respawn === 0,
      life: k.spawnSeq, grounded: k.pose?.grounded, rotation: k.pose?.rotation };
  };
  class ObservedSocket extends NativeSocket {
    constructor(...args) {
      super(...args); socket = this;
      this.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        let value; try { value = JSON.parse(event.data); } catch { return; }
        if (value.t !== 'state') return;
        state = value;
        if (activeRun) for (const event of value.events || []) activeRun.eventReceipts[event.id] = (activeRun.eventReceipts[event.id] || 0) + 1;
        if (activeRun && activeRun.samples.length < 500) activeRun.samples.push({ at: performance.now() - activeRun.start,
          simAt: value.simAt, phase: value.phase, preparing: !!value.preparing, ack: value.inputAck, ...pose(),
          events: value.events?.filter(e => !activeRun.events.has(e.id)).map(e => { activeRun.events.add(e.id); return e; }) });
      });
    }
    send(data) {
      if (typeof data === 'string' && nativeKeys.length && performance.now() - nativeKeys.at(-1).at < 400 && nativeActions.length < 100) {
        let value; try { value = JSON.parse(data); } catch {}
        if (value?.t === 'action') nativeActions.push({ at: performance.now(), a: value.a });
      }
      if (activeRun && typeof data === 'string') {
        let value; try { value = JSON.parse(data); } catch {}
        if (value?.t === 'action' && activeRun.actions.length < 300) activeRun.actions.push({ at: performance.now() - activeRun.start,
          i: value.i, w: value.w, a: value.a });
      }
      super.send(data);
    }
  }
  window.WebSocket = ObservedSocket;
  window.addEventListener('keydown', event => { if (event.isTrusted && nativeKeys.length < 100) nativeKeys.push({ code: event.code, repeat: event.repeat, target: event.target.tagName, at: performance.now() }); }, true);
  const frame = time => { if (activeRun && lastFrame && activeRun.frames.length < 1000) activeRun.frames.push(time - lastFrame); lastFrame = time; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  const arena = () => document.querySelector('.pke-stage canvas') || document.querySelector('.pk');
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const key = (target, type, code, repeat = false) => {
    const event = new KeyboardEvent(type, { code, key: code === 'Space' ? ' ' : code.startsWith('Key') ? code.slice(3).toLowerCase() : code,
      bubbles: true, cancelable: true, repeat });
    target.dispatchEvent(event); return { type, code, repeat, prevented: event.defaultPrevented };
  };
  async function save(label, data) {
    const report = { label, source: 'Actual app, shipping WebGL assets and production WebSocket authority; diagnostic input is synthetic DOM input',
      userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight }, map: state?.map?.label,
      profile: state?.profile || 'classic', nativeKeys: nativeKeys.slice(), nativeActions: nativeActions.slice(), ...data };
    report.audio = { ...audio, contexts: contexts.map((c,id) => ({ id,state:c.state,currentTime:c.currentTime })) };
    reports.push(report); output.textContent = JSON.stringify(report, null, 2);
    await fetch('/__qa/report', { method: 'POST', body: JSON.stringify(report) });
  }
  async function run(codes, label, reconnect = false, roomStop = false, outageInput = false, jitter = false, repeat = false, holdMs = 3000) {
    if (activeRun) return;
    const target = arena();
    if (!target || !state || !['drive','live'].includes(state.phase) || state.preparing) { output.textContent = 'Wait for an actual live arena before running diagnostics.'; return; }
    let network; if (jitter) network = await (await fetch('/__qa/jitter', { method: 'POST' })).json();
    menu.open = false; target.focus({ preventScroll: true });
    await delay(80);
    const start = performance.now(), scroll = { x: scrollX, y: scrollY }, initial = pose();
    activeRun = { start, initial, actions: [], samples: [], frames: [], events: new Set(), eventReceipts: {}, input: [], interventions: [] };
    for (const code of codes) activeRun.input.push(key(target, 'keydown', code));
    const repeatTimer = repeat ? setInterval(() => activeRun.input.push(key(target,'keydown','KeyW',true)),50) : undefined;
    if (reconnect || roomStop) setTimeout(() => {
      activeRun.interventions.push({ at: performance.now() - start, action: reconnect ? 'Close actual socket' : 'Click actual Room summary' });
      if (reconnect) socket?.close();
      else document.querySelector('#roomMenu > summary')?.click();
    }, 800);
    if (outageInput) setTimeout(() => {
      activeRun.interventions.push({ at: performance.now() - start, action: 'New forward press during outage', socketState: socket?.readyState });
      activeRun.input.push(key(target, 'keydown', 'KeyW'));
    }, 1200);
    await delay(holdMs);
    clearInterval(repeatTimer);
    for (const code of codes) activeRun.input.push(key(target, 'keyup', code));
    await delay(700);
    const result = activeRun; activeRun = null;
    const sorted = result.frames.slice().sort((a,b) => a-b);
    await save(label, { duration: performance.now() - start, initial, final: pose(), scrollBefore: scroll,
      scrollAfter: { x: scrollX, y: scrollY }, input: result.input, actions: result.actions, samples: result.samples,
      interventions: result.interventions,
      eventReceipts: result.eventReceipts,
      network,
      frameIntervals: { count: sorted.length, p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.floor(sorted.length * .95)], max: sorted.at(-1) } });
  }
  let menu, output;
  document.addEventListener('DOMContentLoaded', () => {
    menu = document.createElement('details'); menu.id = 'kart-acceptance';
    menu.style.cssText = 'position:fixed;right:10px;top:70px;z-index:10000;max-width:min(460px,95vw);max-height:calc(100dvh - 90px);overflow:auto;background:#102232;color:#fff;border:1px solid #8dd;padding:8px;border-radius:8px;font:14px system-ui';
    const summary = document.createElement('summary'); summary.textContent = 'QA · synthetic held DOM input'; menu.append(summary);
    for (const [label,codes,reconnect,roomStop,outageInput,jitter,repeat] of [['Hold forward 3s',['KeyW']],['Hold right + forward 3s',['KeyW','KeyD']],['Hold forward + Nitro 3s',['KeyW','KeyN']],['Hold arrows + Space 3s',['ArrowUp','ArrowLeft','Space']],['Hold forward + reconnect',['KeyW'],true],['Hold forward + Room stop',['KeyW'],false,true],['Reconnect + new outage input',['KeyW'],true,false,true],['Forward + steer with network jitter',['KeyW','KeyD'],false,false,false,true],['Reconnect + OS-style autorepeat',['KeyW'],true,false,false,false,true]]) {
      const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'min-height:44px;margin:4px'; button.onclick = () => run(codes, label, reconnect, roomStop, outageInput, jitter, repeat); menu.append(button);
    }
    for (const [label,codes,holdMs] of [['Reverse 3s',['KeyS'],3000],['Left + forward 1s',['KeyW','KeyA'],1000],['Right + forward 1s',['KeyW','KeyD'],1000],['Forward 1s',['KeyW'],1000],['Brake 1s',['ShiftLeft'],1000],['Use weapon 1s',['Space'],1000],['Hold machine gun 3s',['Space'],3000]]) {
      const button = document.createElement('button'); button.textContent = label; button.style.cssText = 'min-height:44px;margin:4px'; button.onclick = () => run(codes,label,false,false,false,false,false,holdMs); menu.append(button);
    }
    const inspect = document.createElement('button'); inspect.textContent = 'Record current observations'; inspect.style.cssText = 'min-height:44px;margin:4px';
    inspect.onclick = () => save('observations', { state: { phase: state?.phase, preparing: state?.preparing, instanceId: state?.instanceId, window: state?.w, self: pose() },
      canvas: [...document.querySelectorAll('.pk canvas,.pke canvas')].map(c => ({ width: c.width, height: c.height, box: c.getBoundingClientRect().toJSON() })),
      controls: { touch: document.querySelector('.pk')?.classList.contains('pk-touch-enabled') || document.querySelector('.pke')?.classList.contains('pke-touch-mode'), focus: document.activeElement?.outerHTML.slice(0,300) },
      overflow: { width: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, scrollX, scrollY } }); menu.append(inspect);
    const geometry = document.createElement('button'); geometry.textContent = 'Record control geometry'; geometry.style.cssText = 'min-height:44px;margin:4px';
    geometry.onclick = () => {
      const selectors = { stick: '.pke-stick', gas: '[data-gas]', reverse: '[data-reverse]', brake: '[data-brake]', nitro: '[data-nitro]', use: '[data-use]' };
      const controls = Object.fromEntries(Object.entries(selectors).map(([name,selector]) => [name,document.querySelector('.pke '+selector)?.getBoundingClientRect().toJSON()]));
      const failures = [], entries = Object.entries(controls);
      for (let i=0;i<entries.length;i++) {
        const [name,rect] = entries[i];
        if (!rect || rect.width < 44 || rect.height < 44 || rect.left < 0 || rect.top < 0 || rect.right > innerWidth || rect.bottom > innerHeight) failures.push('Missing, undersized or clipped: '+name);
        for (const [other,b] of entries.slice(i+1)) if (rect && b && Math.min(rect.right,b.right)>Math.max(rect.left,b.left) && Math.min(rect.bottom,b.bottom)>Math.max(rect.top,b.top)) failures.push('Overlapping contacts: '+name+'/'+other);
      }
      save('control-geometry', { controls, failures, pass: failures.length === 0, mode: document.querySelector('.pke')?.className,
        touchVisible: !document.querySelector('.pke-touch')?.hidden, overflow: document.documentElement.scrollWidth > innerWidth });
    }; menu.append(geometry);
    output = document.createElement('pre'); output.id = 'kart-acceptance-report'; output.style.cssText = 'max-height:55vh;overflow:auto;white-space:pre-wrap;font:11px monospace'; output.textContent = 'No physics/state override. Native key pulses and synthetic held input are reported separately.'; menu.append(output); document.body.append(menu);
  });
})();
