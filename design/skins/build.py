import json, os, re, subprocess
os.chdir(os.path.dirname(os.path.abspath(__file__)))
ORDER=['soft','play','paper','clay','scrap']
DEFAULTS={'soft':None,'play':None,'paper':None,'clay':None,'scrap':None}
BLURBS={'soft':'Frosted glass over soft light. Calm, premium, airy.','play':'Chunky tiles, outlines and stickers. Loud and fun.','paper':'Real paper stock, ink and print. Tactile and personal.','clay':'Puffy 3D shapes you want to press. Friendly and tactile.','scrap':'Cutouts, tape and doodles. Personal and playful.'}
metas={}
for k in ORDER:
    css=open(f'skin-{k}.css').read(); mm=re.search(r'/\*\s*META\s*(\{.*?\})\s*\*/', css, re.S)
    metas[k]=json.loads(mm.group(1)); metas[k]['palette']=DEFAULTS[k] or metas[k]['palette']
icons={}
for w in ['thin','light','regular','bold','fill','duotone']:
    d=f'../icons/{w}'; icons[w]={f[:-4]: re.sub(r'\s+xmlns="[^"]+"','',open(f'{d}/{f}').read().strip()) for f in os.listdir(d)}
fams=[]
for k in ORDER:
    for f in metas[k]['fonts']:
        if f not in fams: fams.append(f)
fonturl='https://fonts.googleapis.com/css2?'+'&'.join('family='+f.replace(' ','+') for f in fams)+'&display=swap'
# Real layout engine, compiled from the app source.
node='/Users/divyansh/Agents/tools/node-v24.19.0/bin/node'
js=subprocess.run([node,'-e',"const ts=require('/Users/divyansh/KaltStart/Giggle/node_modules/typescript');const fs=require('fs');const f='/Users/divyansh/KaltStart/Giggle/packages/core/src/videoLayout.ts';process.stdout.write(ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2019}}).outputText)"],capture_output=True,text=True,check=True).stdout
layoutjs='const GiggleLayout = (function () { const exports = {}; const module = { exports };\n'+js+'\nreturn exports; })();'
palettes=[('raspberry','Raspberry','#DE1E6A'),('grape','Grape','#7C2FEB'),('lagoon','Lagoon','#0C9B8A'),('moss','Moss','#2E7D4E'),('honey','Honey','#C98600'),('petrol','Petrol','#146B8C')]
skin_btns=''.join(f'<button class="opt skin-opt" data-skin="{k}" aria-pressed="false"><b>{metas[k]["name"]}</b><small>{BLURBS[k]}</small></button>' for k in ORDER)
pal_btns=''.join(f'<button class="sw" data-palette="{p}" aria-pressed="false" title="{n}"><span style="background:{c}"></span>{n}</button>' for p,n,c in palettes)
page=(open('page-template.html').read().replace('%FONTURL%',fonturl).replace('%BASE%',open('base.css').read())
      .replace('%SKINS%','\n'.join(open(f'skin-{k}.css').read() for k in ORDER)).replace('%MARKUP%',open('markup.html').read())
      .replace('%SKINBTNS%',skin_btns).replace('%PALBTNS%',pal_btns).replace('%LAYOUTJS%',layoutjs).replace('%SKETCHJS%',open('sketch.js').read())
      .replace('%ICONS%',json.dumps(icons)).replace('%METAS%',json.dumps(metas)))
open('studio.html','w').write(page)
open('studio-local.html','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>'+page+'</body></html>')
print('built', len(page))
