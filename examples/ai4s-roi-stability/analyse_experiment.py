from pathlib import Path
import csv, json, sys, platform
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager
from scipy import stats, ndimage

ROOT = Path(__file__).resolve().parent
font = Path('C:/Windows/Fonts/msyh.ttc')
if font.exists():
    font_manager.fontManager.addfont(str(font))
    plt.rcParams['font.family'] = font_manager.FontProperties(fname=str(font)).get_name()
plt.rcParams.update({'axes.unicode_minus':False,'font.size':11,'axes.spines.top':False,'axes.spines.right':False,'savefig.bbox':'tight'})
rows=json.loads((ROOT/'raw_results.json').read_text(encoding='utf-8'))
config=json.loads((ROOT/'parameters.json').read_text(encoding='utf-8'))
presets=config['presets']; noises=config['noise']; masks=config['masks']
names={'brain':'脑部模板','liver':'肝脏模板','vessel':'血管模板','truth':'原始轮廓','eroded':'内缩1像素','dilated':'外扩1像素'}
colors={'brain':'#2966A3','liver':'#C27634','vessel':'#44876C'}
metrics=['areaMm2','mean','sd','entropy','dice']
labels={'areaMm2':'面积 (mm²)','mean':'平均合成灰度','sd':'ROI灰度总体标准差','entropy':'熵 (bit)','dice':'Dice'}
def selected(p,n,m,key):
    return np.array([r[key] for r in rows if r['preset']==p and r['noise']==n and r['mask']==m],dtype=float)
def describe(a):
    a=np.asarray(a,dtype=float); mean=float(a.mean()); sd=float(a.std(ddof=1)); hw=float(stats.t.ppf(.975,len(a)-1)*sd/np.sqrt(len(a)))
    return {'n':len(a),'mean':mean,'sample_sd':sd,'ci95_low':mean-hw,'ci95_high':mean+hw}
summary=[]
for p in presets:
    for n in noises:
        for m in masks:
            for key in metrics:
                summary.append({'preset':p,'noise':n,'mask':m,'metric':key,**describe(selected(p,n,m,key))})
contrasts=[]
for p in presets:
    for key in metrics:
        contrasts.append({'preset':p,'contrast':'noise60-minus-noise0','mask':'truth','metric':key,**describe(selected(p,60,'truth',key)-selected(p,0,'truth',key))})
    for m in ['eroded','dilated']:
        for key in metrics:
            contrasts.append({'preset':p,'contrast':m+'-minus-truth-at-noise15','mask':m,'metric':key,**describe(selected(p,15,m,key)-selected(p,15,'truth',key))})
for filename,data in [('summary.csv',summary),('paired_contrasts.csv',contrasts)]:
    with (ROOT/filename).open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(data[0]));w.writeheader();w.writerows(data)
(ROOT/'summary.json').write_text(json.dumps({'summary':summary,'paired_contrasts':contrasts},ensure_ascii=False,indent=2),encoding='utf-8')

# Independent array-based reference for one image of every noise/preset and every ROI.
checks=[]
for p in presets:
    for n in [0,15,60]:
        pixels=np.fromfile(ROOT/'samples'/f'{p}-noise{n}.f64',dtype='<f8').reshape(512,512)
        truth=np.fromfile(ROOT/'samples'/f'{p}-truth.u8',dtype='u1').reshape(512,512).astype(bool)
        for m in masks:
            mask=np.fromfile(ROOT/'samples'/f'{p}-{m}.u8',dtype='u1').reshape(512,512).astype(bool)
            expected_mask=truth if m=='truth' else (ndimage.binary_erosion(truth) if m=='eroded' else ndimage.binary_dilation(truth))
            assert np.array_equal(mask,expected_mask),f'Morphology mismatch {p}/{m}'
            a=pixels[mask]; _,counts=np.unique(np.floor(a/25),return_counts=True); prob=counts/counts.sum()
            ref={'count':a.size,'areaMm2':float(a.size*.35**2),'mean':float(a.mean()),'sd':float(a.std()),'entropy':float(-np.sum(prob*np.log2(prob))),'dice':float(2*np.logical_and(mask,truth).sum()/(mask.sum()+truth.sum()))}
            actual=next(r for r in rows if r['preset']==p and r['noise']==n and r['seed']==1 and r['mask']==m)
            errors={key:abs(actual[key]-ref[key]) for key in ref}
            assert all(v<1e-9 for v in errors.values()),(p,n,m,errors)
            checks.append({'preset':p,'noise':n,'mask':m,'absolute_errors':errors})
validation={'independent_implementation':'NumPy area/mean/population SD/entropy/Dice, SciPy binary morphology','images':9,'roi_measurements':27,'max_abs_error':max(v for x in checks for v in x['absolute_errors'].values()),'passed':True,'checks':checks,'python':platform.python_version(),'numpy':np.__version__}
(ROOT/'independent_validation.json').write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')

fig,axes=plt.subplots(1,3,figsize=(12.6,3.7))
for ax,key in zip(axes,['mean','sd','entropy']):
    for p in presets:
        y=[describe(selected(p,n,'truth',key)) for n in noises]
        ax.errorbar(noises,[d['mean'] for d in y],yerr=[d['ci95_high']-d['mean'] for d in y],marker='o',lw=2,capsize=3,color=colors[p],label=names[p])
    ax.set_xlabel('噪声标准差（合成灰度）');ax.set_ylabel(labels[key]);ax.grid(alpha=.18)
handles,legend_labels=axes[0].get_legend_handles_labels()
fig.legend(handles,legend_labels,frameon=False,fontsize=10,loc='upper center',bbox_to_anchor=(.5,1.04),ncol=3)
fig.suptitle('原始轮廓下的噪声响应：每点20次重复，误差线为均值95%置信区间',fontsize=12,y=1.14)
for ext in ['png','pdf']:fig.savefig(ROOT/'figures'/f'01_噪声与测量稳定性.{ext}',dpi=200)
plt.close(fig)

fig,axes=plt.subplots(1,3,figsize=(12.6,3.6))
for ax,key in zip(axes,['areaMm2','mean','dice']):
    x=np.arange(3)
    for j,p in enumerate(presets):
        y=[selected(p,15,m,key).mean() for m in masks]
        ax.bar(x+(j-1)*.24,y,width=.23,color=colors[p],label=names[p])
    ax.set_xticks(x,[names[m] for m in masks]);ax.set_ylabel(labels[key]);ax.grid(axis='y',alpha=.18);ax.set_axisbelow(True)
handles,legend_labels=axes[0].get_legend_handles_labels()
fig.legend(handles,legend_labels,frameon=False,fontsize=10,loc='upper center',bbox_to_anchor=(.5,1.04),ncol=3)
fig.suptitle('轮廓扰动的影响：噪声标准差15；每组20次重复',fontsize=12,y=1.14)
for ext in ['png','pdf']:fig.savefig(ROOT/'figures'/f'02_轮廓变化与测量偏移.{ext}',dpi=200)
plt.close(fig)

fig,axes=plt.subplots(3,3,figsize=(9.8,9.5))
for i,p in enumerate(presets):
    truth=np.fromfile(ROOT/'samples'/f'{p}-truth.u8',dtype='u1').reshape(512,512)
    for j,n in enumerate([0,15,60]):
        image=np.fromfile(ROOT/'samples'/f'{p}-noise{n}.f64',dtype='<f8').reshape(512,512)
        ax=axes[i,j];ax.imshow(image,cmap='gray',vmin=-50,vmax=300);ax.contour(truth,levels=[.5],colors=['#60D7C7'],linewidths=.65);ax.set_axis_off()
        ax.set_title(f'{names[p]} · 噪声 {n}',fontsize=11,pad=5)
fig.suptitle('固定随机种子1的合成影像与已知目标轮廓（非真实CT）',fontsize=13,y=.99)
fig.subplots_adjust(wspace=.025,hspace=.13,top=.95)
for ext in ['png','pdf']:fig.savefig(ROOT/'figures'/f'03_三部位合成影像与噪声对照.{ext}',dpi=200)
plt.close(fig)

key_results={}
for p in presets:
    key_results[p]={'truth_noise0':{key:describe(selected(p,0,'truth',key)) for key in metrics},'truth_noise60':{key:describe(selected(p,60,'truth',key)) for key in metrics},'mask_at_noise15':{m:{key:describe(selected(p,15,m,key)) for key in metrics}for m in masks},'mean_delta_noise60_vs0':describe(selected(p,60,'truth','mean')-selected(p,0,'truth','mean'))}
(ROOT/'key_results.json').write_text(json.dumps(key_results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'rows':len(rows),'group_statistics':len(summary),'paired_contrasts':len(contrasts),'validation_max_abs_error':validation['max_abs_error'],'results':key_results},ensure_ascii=False))
