import glob,os,numpy as np
from PIL import Image
out={}
for d in sorted(glob.glob('reg-b*-[AK]')):
    worst=None
    for f in sorted(glob.glob(d+'/r*-*.png')+glob.glob(d+'/visible-*.png')+glob.glob(d+'/rapid-after.png')):
        a=np.asarray(Image.open(f).convert('L'),dtype=float); h,w=a.shape
        a=a[int(h*.15):int(h*.9),int(w*.05):int(w*.85)]
        bg=np.median(a); ink=float((abs(a-bg)>18).mean());
        if worst is None or ink<worst[0]: worst=(ink,float(a.std()),os.path.basename(f))
        out.setdefault(d,[]).append(ink)
    print(d,'shots',len(out[d]),'min ink %.4f std %.1f %s'%worst,'median %.4f'%np.median(out[d]))
