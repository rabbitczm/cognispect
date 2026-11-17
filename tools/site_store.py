"""Published website settings and owner-controlled visibility."""
from contextlib import contextmanager
import copy
import json
from pathlib import Path
import sqlite3

MODULES = [('search','文献检索'),('assist','AI 证据问答'),('reader','文献精读'),('pdf','PDF 文献'),('papers','论文投稿与复现'),('stats','统计与随访'),('math','数学建模'),('anatomy','人体图谱'),('lab','模拟实验室'),('review','论文复盘'),('models','模型与翻译设置'),('res','资源导航'),('intro','人体导览')]


def defaults():
    return {'name':'知镜','subtitle':'医学研究工作台','hero_title':'从人体出发，找到研究方向。',
            'hero_description':'旋转人体或选择器官，连接文献、理论与可复现的研究。','announcement':'',
            'resource_links':[], 'modules':[{'id':key,'label':label,'visible':True,'order':i} for i,(key,label) in enumerate(MODULES)],'admin_limit':None}


class SiteStore:
    def __init__(self, directory):
        self.file=Path(directory)/'site.sqlite'
        self.file.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY,draft TEXT,published TEXT,previous TEXT,admin_limit INTEGER)')
            value=json.dumps(defaults(),ensure_ascii=False)
            db.execute('INSERT OR IGNORE INTO settings VALUES (1,?,?,NULL,NULL)',(value,value))
            db.execute('CREATE TABLE IF NOT EXISTS visibility (kind TEXT,key TEXT,visible INTEGER,PRIMARY KEY(kind,key))')

    @contextmanager
    def connect(self):
        db=sqlite3.connect(self.file)
        try:
            with db:yield db
        finally:db.close()

    def state(self):
        with self.connect() as db:
            row=db.execute('SELECT draft,published,previous,admin_limit FROM settings WHERE id=1').fetchone()
            visible=[dict(zip(('kind','key','visible'),r)) for r in db.execute('SELECT * FROM visibility')]
        result={k:json.loads(v) if v else None for k,v in zip(('draft','published','previous'),row[:3])}
        for k in ('draft','published','previous'):
            if result[k] is not None:result[k]['admin_limit']=row[3]
        return {**result,'visibility':visible}

    def save(self, value):
        data=copy.deepcopy(self.state()['draft'])
        for key in ('name','subtitle','hero_title','hero_description','announcement','resource_links','modules'):
            if key in value:data[key]=value[key]
        known={key for key,_ in MODULES}
        data['modules']=[m for m in data['modules'] if m.get('id') in known]
        for key,label in MODULES:
            if not any(m['id']==key for m in data['modules']):data['modules'].append({'id':key,'label':label,'visible':True,'order':len(data['modules'])})
        with self.connect() as db:db.execute('UPDATE settings SET draft=? WHERE id=1',(json.dumps(data,ensure_ascii=False),))
        return self.state()

    def publish(self):
        with self.connect() as db:db.execute('UPDATE settings SET previous=published,published=draft WHERE id=1')
        return self.state()

    def restore(self):
        with self.connect() as db:db.execute('UPDATE settings SET draft=previous,published=previous,previous=published WHERE id=1 AND previous IS NOT NULL')
        return self.state()

    def set_limit(self, count):
        if count is not None and (not isinstance(count,int) or count<0):raise ValueError('管理员名额应为非负整数，留空表示不限制')
        with self.connect() as db:db.execute('UPDATE settings SET admin_limit=? WHERE id=1',(count,))

    def set_visibility(self,kind,key,visible):
        if kind not in {'article','guide','submission','module'}:raise ValueError('请选择内容类型')
        with self.connect() as db:db.execute('INSERT OR REPLACE INTO visibility VALUES (?,?,?)',(kind,str(key),int(visible)))

    def visible(self,kind,key):
        with self.connect() as db:row=db.execute('SELECT visible FROM visibility WHERE kind=? AND key=?',(kind,str(key))).fetchone()
        if row is not None and not row[0]:return False
        if kind=='module':
            aliases={'medical':'stats','fit':'math'}
            key=aliases.get(key,key)
            return next((m.get('visible',True) for m in self.state()['published']['modules'] if m['id']==key),True)
        return True
