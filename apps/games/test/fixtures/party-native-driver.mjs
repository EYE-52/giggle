  function privacy(S) { privacyChecks++;const id=game.value;
    if (['reveal','roundEnd','done'].includes(S.phase)) return;
    if (id === 'twenty-questions' && S.me !== S.answerer) assert(!('word' in S) && !('wordShown' in S));
    if (id === 'emoji-story' && S.me !== S.director) assert(!S.phrase);
    if (id === 'number-hunt') assert(!('secret' in S));
    if (id === 'warm-words') assert(!('target' in S));
    if (id === 'lyric-fill') assert(!('answer' in S.line));
    if (['scattergories','countdown-word','lyric-fill'].includes(id)) assert.deepEqual(S.answers, {});
    if (id === 'memory-tray' && S.phase === 'recall') assert(!S.items?.length);
    if (['vote','verdict'].includes(S.phase) && S.votes) assert.deepEqual(S.votes, {}, id + ' secret votes');
    if (id === 'rank-it' && S.phase === 'rank') assert.deepEqual(S.ranks, {});
    if (['compliment-battle','roast-toast'].includes(id)) {
      assert.deepEqual(S.entries, {}); assert(!('order' in S) && !('rotation' in S));
      for (const option of S.ballot || []) assert(!('author' in option) && !('pid' in option));
    }
    if (id === 'funny-answer') {
      assert.deepEqual(S.answers, {}); for (const option of S.options || []) assert(!('pid' in option));
    }
    if (id === 'bluff') {
      assert(!S.fact.truth); assert.deepEqual(S.fakes, {}); assert.deepEqual(S.picks, {});
      for (const option of S.options || []) assert(!('pid' in option));
    }
    if (id === 'trivia') { assert(!('answer' in S.question)); assert.deepEqual(S.answers, {}); }
    if (id === 'two-truths' && S.phase === 'vote') assert(!('lie' in S));
  }
const frames={},status=document.querySelector('#status'),game=document.querySelector('#game'),roles=document.querySelector('#role');const VERSION='20261010-r6-all19';let session,actions=0,stage='boot',privacyChecks=0,scenes=[],batch=null;
const wait=ms=>new Promise(r=>setTimeout(r,ms)),assert=(v,m)=>{if(!v)throw Error(m)};
assert.deepEqual=(a,b,m)=>assert(JSON.stringify(a)===JSON.stringify(b),m||'private projection differs');
async function until(fn,label='ready'){for(let n=0;n<750;n++){if(fn())return;await wait(20)}throw Error(label+' timed out')}
const q=role=>frames[role]?.contentWindow.qa;
function clientName(client){const name=(client.state.players||[]).find(p=>p.id===client.state.me)?.name;assert(typeof name==='string'&&name.trim(),'active client has no player name');return name;}
function show(){for(const [role,f]of Object.entries(frames))f.hidden=role!==roles.value;}
async function settle(){await until(()=>Object.keys(frames).length===4&&Object.keys(frames).every(r=>{const c=q(r);return c?.state&&c.rendered===c.state&&!c.state.preparing}), 'released paints');for(const role of Object.keys(frames)){privacy(q(role).state);const finite=q(role).el.getAnimations({subtree:true}).filter(a=>a.playState==='running'&&Number.isFinite(a.effect.getComputedTiming().endTime));await Promise.race([Promise.all(finite.map(a=>a.finished.catch(()=>{}))),wait(5000).then(()=>{if(finite.some(a=>a.playState==='running'))throw Error(role+' animation did not settle')})]);}await wait(80);assert(Object.keys(frames).every(r=>!q(r).errors.length),'client errors');}
async function fresh(){stage='fresh room';scenes=[];privacyChecks=0;for(const f of Object.values(frames))f.contentWindow.qa?.dispose();if(session)await fetch('/close?session='+session,{method:'POST'});const data=await(await fetch('/session?game='+game.value)).json();session=data.session;document.querySelector('#frames').innerHTML='';roles.innerHTML='';for(const key of Object.keys(frames))delete frames[key];for(const role of data.roles){const f=document.createElement('iframe');f.title=role+' live party client';f.width=1200;f.height=836;f.src='/client?session='+session+'&game='+game.value+'&role='+role+'&scene=1&v='+VERSION;frames[role]=f;document.querySelector('#frames').append(f);roles.add(new Option(role,role));}show();await settle();const watcher=q('watcher'),ack=watcher.acks.length;assert(watcher.state.spectator,'late watcher is not spectator');watcher.raw({vote:'a',next:true});await until(()=>watcher.acks.length>ack);assert(!watcher.acks.at(-1).changed,'spectator changed match');actions=0;status.textContent='Released Room; actual client viewport 1200 × 836. Synthetic clicks, controlled engine deadlines.';}
async function send(client,interaction){const role=Object.keys(frames).find(r=>q(r)===client);roles.value=role;show();await wait(40);const ack=client.acks.length,sent=client.sent.length;interaction(client.el);assert(client.sent.length>sent,'shipping control declined before transport: '+game.value+' '+client.state.phase+' round '+client.state.round+' apiNow='+client.api.now()+' endsAt='+client.state.endsAt);await until(()=>client.acks.length>ack,'control acknowledgement');assert(client.acks.at(-1).changed,'control did not change authority');actions++;await settle();await captureScene('acknowledged control '+actions);}
const field=(el,selector,value)=>{const n=el.querySelector(selector);assert(n&&!n.disabled,'Missing writable '+selector);n.value=value;n.dispatchEvent(new n.ownerDocument.defaultView.Event('input',{bubbles:true}));};
const click=(el,selector)=>{const n=el.querySelector(selector);assert(n&&!n.disabled,'Missing enabled '+selector);n.click();};
const write=(client,input,button,text)=>send(client,el=>{field(el,input,text);click(el,button)});
async function save(kind,result){const response=await fetch('/results?name='+(batch?'all19-'+batch.id+'-':'single-')+kind+'-'+game.value,{method:'POST',body:JSON.stringify({...result,version:VERSION,stage,runId:batch?.id||null})});assert(response.ok,'evidence save failed');return response.json();}
async function captureScene(label){
 const previous=roles.value;
 for(const role of Object.keys(frames)){
  roles.value=role;show();await wait(80);await settle();
  const client=q(role),win=frames[role].contentWindow,doc=win.document;privacy(client.state);
  assert(win.innerWidth===1200&&win.innerHeight===836,role+' visible viewport mismatch');
  const controls=[...client.el.querySelectorAll('button,input,textarea,select,summary')].filter(n=>n.getClientRects().length).map(n=>({id:n.id,text:n.textContent.slice(0,100),disabled:!!n.disabled,rect:n.getBoundingClientRect().toJSON()}));
  scenes.push({label,role,phase:client.state.phase,gameNow:client.state.gameNow,rendererNow:client.api.now(),serverNow:client.state.serverNow,round:client.state.round,rounds:client.state.rounds,spectator:client.state.spectator,window:client.state.w,viewport:[win.innerWidth,win.innerHeight],documentWidth:doc.documentElement.scrollWidth,documentHeight:doc.documentElement.scrollHeight,scene:client.el.getBoundingClientRect().toJSON(),controls});
 }
 roles.value=previous;show();
}
async function diagnostics(){return{server:await(await fetch('/diagnostics?session='+session)).json(),roles:Object.fromEntries(Object.keys(frames).map(r=>[r,{state:q(r)?.state,rendered:q(r)?.rendered,apiNow:q(r)?.api.now(),sent:q(r)?.sent.slice(-20),acks:q(r)?.acks.slice(-20),footerDisabled:q(r)?.el.querySelector('#bRematch')?.disabled,footerPresent:!!q(r)?.el.querySelector('#bRematch'),errors:q(r)?.errors,readyAcks:q(r)?.readyAcks,host:q(r)?.api.context().isHost}]))};}
  async function drive(deadlines = false) {
    const id=game.value, state = q('a').state, window = q('a').state.w, phase = state.phase;
    if (phase === 'done') return;
    if (deadlines) {
      if (id === 'number-hunt' && phase === 'hunt') { // Hunt starts its deadline after the first finder. PEEK controlled solution.
        await write(clients[0], '#nGuess', '#nSend', String(state.secret)); return;
      }
      q('a').socket.send(JSON.stringify({t:'qa-clock'})); await wait(100); await settle(); return;
    }
    for (const client of Object.keys(frames).map(q).filter(c=>!c.state.spectator)) {
      if (q('a').state.w !== window) break;
      const S = client.state;
      if (phase === 'reveal') {
        const next = client.el.querySelector('button[id$="Next"],button[data-ww-next]');
        if (next && !next.disabled) { await send(client, () => next.click()); break; }
      } else if (id === 'bluff') {
        if (phase === 'bluff') await write(client, '#bFake', '#bSend', 'A plausible answer from ' + clientName(client));
        else await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'funny-answer') {
        if (phase === 'answer') await write(client, '#fAns', '#fSend', clientName(client) + ' brought a miniature disco ball.');
        else await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'compliment-battle' || id === 'roast-toast') {
        const prefix = id === 'compliment-battle' ? 'cb' : 'rt';
        if (phase === 'write' && S.me !== S.target) await write(client, '#' + prefix + 'Entry', '#' + prefix + 'Send', clientName(client) + ' makes snack breaks a three-act story.');
        else if (phase === 'vote') {
          const selector = id === 'roast-toast' && S.me === S.target ? '[data-p]:not([disabled])' : '[data-v]:not([disabled])';
          if (client.el.querySelector(selector)) await send(client, el => click(el, selector));
        }
      } else if (id === 'hot-takes') {
        if (phase === 'submit') await write(client, '#hTake', '#hSend', clientName(client) + ' says breakfast belongs at midnight.');
        else if (S.current && !S.current.mine) await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'two-truths') {
        if (phase === 'write' && S.me === S.subject) await send(client, el => {
          ['I make pancakes.','I missed a train.','I have a pet dragon.'].forEach((text,i) => field(el, '#tS' + i, text));
          click(el, 'input[name="tLie"][value="2"]'); click(el, '#tSend');
        });
        else if (phase === 'vote' && S.me !== S.subject) await send(client, el => click(el, '[data-v="2"]'));
      } else if (id === 'emoji-story') {
        if (phase === 'emoji' && S.me === S.director) await write(client, '#eEmoji', '#eSend2', '🌊🐟🎉');
        else if (phase === 'guess' && S.me !== S.director && !S.mySolved) await write(client, '#eGuess', '#eSend', Object.keys(frames).map(q).filter(c=>!c.state.spectator).find(c=>c.state.me===c.state.director).state.phrase);
      } else if (id === 'five-second') {
        if (phase === 'answer' && S.me === S.performer) await write(client, '#fAns', '#fSend', 'one, two, three');
        else if (phase === 'vote' && S.me !== S.performer) await send(client, el => click(el, '[data-v="pass"]'));
      } else if (id === 'truth-dare') {
        if (phase === 'choose' && S.me === S.target) await send(client, el => click(el, '[data-kind="dare"]'));
        else if (phase === 'perform' && S.me === S.target) await send(client, el => click(el, '#tReady'));
        else if (phase === 'vote' && S.me !== S.target) await send(client, el => click(el, '[data-v="yes"]'));
      } else if (id === 'dare-roulette') {
        if (phase === 'spin' && S.me === S.hostId) await send(client, el => click(el, '#drSpin'));
        else if (phase === 'perform' && S.me === S.victim) await send(client, el => click(el, '#drReady'));
        else if (phase === 'verdict' && S.me !== S.victim) await send(client, el => click(el, '[data-v="done"]'));
      } else if (id === 'story-builder') {
        if (phase === 'build' && S.me === S.turn) await write(client, '#sLine', '#sSend', clientName(client) + ' opened the door to a tiny dragon bakery.');
        else if (phase === 'vote') await send(client, el => click(el, '[data-v]:not([disabled])'));
      } else if (id === 'rank-it') {
        await send(client, el => { click(el, '[data-dn="0"]'); click(el, '#rLock'); });
      } else if (id === 'rapid-polls') {
        if (phase === 'pose') await send(client, el => {
          field(el, '#rpQ', 'What makes game night great?');
          ['Stories','Close contests','Snacks','Everyone joining'].forEach((text,i) => field(el, '#rpO' + i, text)); click(el, '#rpAsk');
        });
        else await send(client, el => click(el, '[data-v="3"]'));
      } else if (id === 'trivia') { // PEEK: controlled correct response, never added to active public view.
        await send(client, el => click(el, '[data-p="' + 0 + '"]'));
      } else if (id === 'lyric-fill') { // PEEK: controlled correct response.
        await write(client, '#lfText', '#lfGo', 'fixture answer');
      } else if (id === 'most-likely') await send(client, el => click(el, '[data-v]:not([disabled])'));
      else if (id === 'never-ever') await send(client, el => click(el, '[data-v="not"]'));
      else if (id === 'pick-one' || id === 'would-you-rather') await send(client, el => click(el, '[data-v="a"]'));
      else if (id === 'scattergories') await send(client, el => {
        S.categories.forEach((_,i) => field(el, '#sc' + i, S.letter + 'ample')); click(el, '#scLock');
      });
      else if (id === 'countdown-word') await write(client, '#cwWord', '#cwLock', state.best || 'late');
      else if (id === 'memory-tray' && phase === 'recall') await write(client, '#mAns', '#mSend', state.items.slice(0, 4).join(', ')); // Study state retained by controlled player.
      else if (id === 'typing-race' && phase === 'race') {
        clock.time += 250; await send(client, el => { const input = el.querySelector('#tInput'); field(el, '#tInput', S.target); input.oninput(); });
      } else if (id === 'reaction-tap' && phase === 'go') {
        clock.time += 200; await send(client, el => click(el, '#rPad'));
      } else if (id === 'number-hunt' && (phase === 'hunt' || phase === 'overtime') && !(S.finished || []).some(f => f.pid === S.me)) await write(client, '#nGuess', '#nSend', String(state.secret)); // PEEK after checking secret-free projections.
      else if (id === 'warm-words' && phase === 'guess') { // PEEK after checking target-free projections.
        clock.time += 400; await send(client, el => { field(el, '[data-ww-input]', state.target); el.querySelector('[data-ww-form]').onsubmit({ preventDefault() {} }); });
      } else if (id === 'twenty-questions' && phase === 'play' && S.me !== S.answerer) {
        const actor = Object.keys(frames).map(q).filter(c=>!c.state.spectator).find(c=>c.state.me===S.answerer);
        await write(client, '#tQ', '#tQSend', 'Does it belong inside a home?');
        await send(actor, el => click(el, '#tqSome'));
        await write(client, '#tG', '#tGSend', actor.S.wordShown);
      } else if (id === 'word-chain' && phase === 'play' && S.me === S.turnPid) {
        await write(client, '#wcWord', '#wcGo', state.used.length === 1 ? 'giggleproof' : ''); // Custom dictionary link, then explicit pass/elimination.
      }
    }
    if (q('a').state.w === window) { q('a').socket.send(JSON.stringify({t:'qa-clock'})); await wait(100); await settle(); }
  }async function play(){
 document.querySelector('#play').disabled=true;
 try{
  stage='full match initial released scene';await settle();await captureScene('initial released');const phases=new Set();
  for(let n=0;q('a').state.phase!=='done'&&n<200;n++){
   phases.add(q('a').state.phase);stage='full match '+q('a').state.phase;
   status.textContent=(batch?'All19 '+(batch.results.length+1)+'/19 · ':'')+'Playing '+game.value+' '+q('a').state.phase+' / '+actions+' acknowledged controls';
   await drive();await captureScene('released '+q('a').state.phase);
  }
  assert(q('a').state.phase==='done','full match incomplete');stage='all-role final geometry';await settle();await captureScene('settled final');
  const roleEvidence={};
  for(const r of Object.keys(frames)){
   roles.value=r;show();await wait(80);await settle();const client=q(r),win=frames[r].contentWindow;
   assert(win.innerWidth===1200&&win.innerHeight===836,r+' visible viewport mismatch');
   roleEvidence[r]={phase:client.state.phase,rounds:client.state.rounds,spectator:client.state.spectator,readiness:client.readyAcks.length,errors:client.errors,cues:client.cues.length,presented:client.presented,scores:client.state.scores||null,totals:client.state.totals,text:client.el.textContent.slice(-2000),viewport:[win.innerWidth,win.innerHeight],host:client.api.context().isHost,shippingFooter:!!client.el.querySelector('#bRematch'),rematchEnabled:!!client.el.querySelector('#bRematch:not(:disabled)')};
  }
  roles.value='a';show();const result={pass:true,game:game.value,actions,phases:[...phases],privacyChecks,scenes,controlledClock:true,naturalTimedInput:false,scope:'Actual Room + WS + shipping game-host/client and extracted shipping footer; synthetic browser control dispatch; engine clock frozen between explicit QA deadline advances; renderer api.now equals authority gameNow even while released; no natural five-second timing verdict; visible all-role1200x836 geometry. Two rounds where shipped settings permit; Trivia uses shipped fixed8questions. Cue counts are API instrumentation, not hearing. No physical/mobile/Safari/Meet claim.',roles:roleEvidence};
  const packet=await save('full',result);status.textContent='PASS full match '+game.value+' '+actions+' acknowledged controls';return{...result,packet:packet.file};
 }catch(e){const result={pass:false,game:game.value,error:e.message,actions,privacyChecks,scenes,...await diagnostics()};const packet=await save('full',result);status.textContent='FAIL '+VERSION+' '+stage+': '+e.message;return{...result,packet:packet.file};}
 finally{if(!batch)document.querySelector('#play').disabled=false;}
}

async function lifecycle(){try{stage='settle original final';await settle();assert(q('a').state.phase==='done','complete match first');const old=q('a').state.instanceId,w=q('a').state.w,cues=q('a').cues.length;stage='owner reconnect';await q('a').reconnect();stage='settle reconnect';await settle();assert(q('a').cues.length===cues,'reconnect replayed cues');const hostRole=Object.keys(frames).find(r=>q(r).api.context().isHost);assert(hostRole,'current host missing after reconnect');roles.value=hostRole;show();await wait(120);stage='show elected host footer';await settle();const foot=q(hostRole).el.querySelector('#bRematch');assert(foot&&!foot.disabled,'shipping rematch footer unavailable for current host');stage='click elected host footer';foot.click();stage='wait new rematch instance';await until(()=>q('a').state.instanceId!==old,'host rematch instance');stage='settle released rematch';await settle();stage='stale action ACK';const ack=q('a').acks.length;q('a').raw({vote:'a',next:true},{i:old,w});await until(()=>q('a').acks.length>ack,'stale action ACK');assert(!q('a').acks.at(-1).changed,'retired instance changed match');const result={pass:true,game:game.value,quietReconnect:true,readyRematch:true,staleRejected:true,hostRole,activeSeats:Object.keys(frames).filter(r=>!q(r).state.spectator),privacyChecks,controlledClock:true,naturalTimedInput:false,scope:'Actual Room and shipping client; extracted shipping host footer clicked after owner reconnect; real game-host readiness; controlled deadlines and fixture controls'};const packet=await save('lifecycle',result);status.textContent='PASS finished reconnect, ready rematch, stale guard';return{...result,packet:packet.file};}catch(e){status.textContent='FAIL lifecycle '+VERSION+' '+stage+': '+e.message;const result={pass:false,game:game.value,error:e.message,stage,...await diagnostics()};const packet=await save('lifecycle',result);return{...result,packet:packet.file};}}
async function runAll19(){
 batch={id:Date.now().toString(36),version:VERSION,results:[],pass:false,scope:'Sequential native browser fixture execution,19 actual Room matches/lifecycles; synthetic controls and controlled engine clocks; three initial active WS seats + late watcher, four active seats on shipping rematch. Visible role geometry and private-projection assertions. No physical/Safari/Meet/audio hearing claim.'};
 for(const id of ['fresh','play','life','all19','game'])document.getElementById(id).disabled=true;
 try{
  for(const option of game.options){
   game.value=option.value;stage='all19 fresh '+game.value;status.textContent='All19 '+(batch.results.length+1)+'/19 · Fresh '+game.value;
   await fresh();const full=await play();if(!full.pass){batch.results.push({game:game.value,full});throw Error(game.value+' full match: '+full.error);}
   const life=await lifecycle();batch.results.push({game:game.value,full,lifecycle:life});if(!life.pass)throw Error(game.value+' lifecycle: '+life.error);
  }
  batch.pass=batch.results.length===19;const packet=await save('summary',batch);status.textContent='PASS all19 full matches + lifecycles · '+packet.file;
 }catch(error){batch.error=error.message;batch.failedStage=stage;const packet=await save('summary',batch);status.textContent='STOP all19 after '+batch.results.length+'/19 · '+error.message+' · preserved '+packet.file;}
 finally{for(const id of ['fresh','play','life','all19','game'])document.getElementById(id).disabled=false;batch=null;}
}
document.querySelector('#fresh').onclick=fresh;game.onchange=fresh;roles.onchange=show;document.querySelector('#play').onclick=play;document.querySelector('#life').onclick=lifecycle;document.querySelector('#all19').onclick=runAll19;await fresh();
