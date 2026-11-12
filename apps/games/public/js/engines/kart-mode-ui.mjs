// Setting values stay compatible with saved rooms. Labels are player-facing.
export const KART_MODES = Object.freeze({
  'Zap Battle': { label:'Free-for-all', icon:'lightning', note:'Every driver for themselves. Most knockouts wins.', unit:'KO', target:'targetHits' },
  'Team Battle': { label:'Team Battle', icon:'users-three', note:'Blue vs Coral. Team knockouts count. Friendly fire is off.', unit:'KO', target:'targetHits' },
  'Capture the Flag': { label:'Capture the Flag', icon:'flag-checkered', note:'Capture rival flags. Your flag must be home to score.', unit:'capture', target:'targetFlags' },
  'Star Rush': { label:'Star Rush', icon:'star', note:'Collect stars on every level. Most stars wins.', unit:'star', target:'targetStars' },
  'Garage Battle': { label:'Garage Battle', icon:'wrench', note:'Earn coins and buy upgrades between rounds.', unit:'KO', target:'targetHits' },
});
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function kartModeInfo(state) {
  let label=typeof state==='string'?state:state?.modeLabel;
  if(!label){
    if(state?.teamMode==='ctf')label='Capture the Flag';
    else if(state?.teamMode==='teambattle')label='Team Battle';
    else if(state?.mode==='starrush')label='Star Rush';
    else label=state?.garage?'Garage Battle':'Zap Battle';
  }
  return KART_MODES[label] || KART_MODES['Zap Battle'];
}
export function kartScore(kart,state) {
  if (state?.teamMode === 'ctf') return state.capturesByPlayer?.[kart?.pid || kart?.id] || 0;
  return state?.mode === 'starrush' ? kart?.stars || 0 : kart?.hits || 0;
}
export function kartScoreText(score,state) {
  const unit=kartModeInfo(state).unit;
  return `${score} ${unit}${score===1?'':'s'}`;
}
export function kartGoalText(state) {
  const mode=kartModeInfo(state),team=state?.teamMode?'team ':'';
  const target=state?.[mode.target] || (mode.target==='targetFlags'?3:0);
  return state?.winRule==='Score target' ? `First to ${target} ${mode.unit}${target===1?'':'s'}` : `Most ${team}${mode.unit}s wins`;
}
export function kartTeam(state,pid) {
  return (state?.teams || []).find(team=>team.id===state?.teamByPlayer?.[pid]) || null;
}
export function kartTeamTag(state,pid) {
  const team=kartTeam(state,pid);
  return team?`<small class="kart-team-tag" data-team="${esc(team.id)}">${esc(team.label)}</small>`:'';
}
const lastHud=new WeakMap();
export function paintKartObjectiveHud(node,state,nameOf) {
  if(!node)return;
  const teams=state?.teams || [],own=state?.youDrive===false?null:kartTeam(state,state?.you),flags=state?.flags || [];
  node.hidden=!state?.teamMode||state.phase==='done';
  if(node.hidden)return;
  const status=flags.map(flag=>`${flag.teamId==='blue'?'A':'B'} ${flag.state==='carried'?(own&&flag.carrierId===state.you?'you carry':'carried'):flag.state==='dropped'?'dropped':'home'}`).join(' · ');
  const carrying=own?flags.find(f=>f.carrierId===state.you):null,ownFlag=flags.find(f=>f.teamId===own?.id);
  const action=carrying ? ownFlag?.state==='home'?`Take the flag to ${own.label} base`:'Your flag must be home to score' : '';
  const goal=kartGoalText(state),detail=action || (state.teamMode==='ctf'?`${state.winRule==='Score target'?`${state.targetFlags || 3} flag${Number(state.targetFlags)===1?'':'s'} to win`:'Flags'} · ${status}`:goal);
  const html=`<div class="kart-team-scores" aria-label="Team scores">${teams.map(team=>`<span data-team="${esc(team.id)}"${team.id===own?.id?' aria-current="true"':''}><i aria-hidden="true">${team.id==='blue'?'A':'B'}</i><b>${esc(team.label)}${team.id===own?.id?' <small>you</small>':''}</b><strong>${team.score || 0}</strong></span>`).join('')}</div><p class="kart-flag-status">${!own?'Watching · ':''}${esc(detail)}</p>`;
  if(lastHud.get(node)!==html){node.innerHTML=html;lastHud.set(node,html);}
}
