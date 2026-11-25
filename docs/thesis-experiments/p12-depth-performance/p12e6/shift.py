import glob,os,numpy as np
from PIL import Image
ref=np.asarray(Image.open('reg-b6-K/start.png').convert('L'),dtype=float)[20:42,535:570]
for d in sorted(glob.glob('reg-*-[AK]'))+sorted(glob.glob('main-*-[AK]'))+sorted(glob.glob('screen-*'))+sorted(glob.glob('vite-*')):
    r={}
    for f in sorted(glob.glob(d+'/*.png'),key=os.path.getmtime):
        a=np.asarray(Image.open(f).convert('L'),dtype=float)
        if a.shape[1]<400: continue
        best=min(range(0,a.shape[1]-35),key=lambda x:np.abs(a[20:42,x:x+35]-ref).sum())
        r.setdefault(best,[]).append(os.path.basename(f))
    print(d,{k:(len(v),v[0]) for k,v in r.items()})
