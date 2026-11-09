/* Inventory source disclosures, not just the currently mounted game. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../..');
function files(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(d=>d.isDirectory()?files(path.join(dir,d.name)):[path.join(dir,d.name)]);}
const rows=[];
for(const file of [...files(path.join(root,'public')),...files(path.join(root,'games')),path.join(root,'scripts/build-game-pages.js')].filter(f=>/\.(html|js|mjs)$/.test(f))){
 const lines=fs.readFileSync(file,'utf8').split('\n');
 for(const [i,line]of lines.entries()){
  for(const match of line.matchAll(/<details\b([^>]*)>|createElement\(["']details["']\)|\bnode\(["']details["']/g)){
   const cls=/class="([^"]+)"/.exec(match[1]||'')?.[1]||(/report-inbox\.js$/.test(file)?'report-diagnostics':/howto\.js$/.test(file)?'howto-all':/letter-lock/.test(file)?'wp-detail ll-others':/word-grid/.test(file)?'wp-detail wg3-words':'dynamic');
   const summarySource=line.slice(match.index)+'\n'+lines.slice(i+1,i+4).join('\n');
   const label=/<summary[^>]*aria-label="([^"]+)"/.exec(summarySource)?.[1]||/<summary[^>]*>(.*?)<\/summary>/.exec(summarySource)?.[1]?.replace(/<[^>]+>/g,'').replace(/\$\{BK_[A-Z_]+\}/g,'').replace(/\$\{.*?\}/g,'(count)')||cls;
   const retired=file.includes('/games/castle-clash/home/');
   const replacement=retired?'Retired source: Castle Clash is excluded by registry.js and this page is not exported or served':cls.includes('room-menu')?'Existing fixed room layer, now anchored on desktop and bottom sheet on phones':cls==='sr-game-picker'?'Game chooser popover / bottom sheet; full catalogue scrolls inside the panel':cls==='chhist-wrap'?'Docked move panel at 1000px+, floating sheet below 600px, popover between': 'Shared native dialog: anchored popover at 600px+, bottom sheet below 600px';
   rows.push({file:path.relative(root,file),line:i+1,cls,label,replacement,retired});
  }
 }
}
const out=path.resolve(root,'../../artifacts/app-feel');fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'disclosures.json'),JSON.stringify(rows,null,2));
fs.writeFileSync(path.join(out,'DISCLOSURES.md'),'# Disclosure audit\n\nSource tags stay as stable owners for existing game handlers. The shared controller replaces their inline opening behavior. All active pages containing these tags load it. Three unregistered Castle Clash home controls are listed separately as retired source. Playable castle grids were changed from disclosures to permanent sections.\n\n| Source | Control | Replacement |\n|---|---|---|\n'+rows.map(r=>`| \`${r.file}:${r.line}\` | ${r.label.replaceAll('|','/')} | ${r.replacement} |`).join('\n')+'\n');
console.log('DISCLOSURE_AUDIT',rows.length,'entries in',new Set(rows.map(r=>r.file)).size,'files');
