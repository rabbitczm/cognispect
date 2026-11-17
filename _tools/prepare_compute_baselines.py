"""Create real scientific and text-table PDF fixtures for browser parity checks."""
import json
import math
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.browser_compute import compute


def table_pdf():
    content = '0.5 w\n'
    for x in [50, 180, 300, 420]:
        content += f'{x} 550 m {x} 700 l S\n'
    for y in [550, 580, 610, 640, 670, 700]:
        content += f'50 {y} m 420 {y} l S\n'
    for row, cells in enumerate([['Group','Before','After'],['P01','12','9'],['P02','15','11'],['P03','11','10'],['P04','18','13']]):
        for x, text in zip([60, 190, 310], cells):
            content += f'BT /F1 12 Tf {x} {680-row*30} Td ({text}) Tj ET\n'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 750] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
               b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
               b'<< /Length '+str(len(content)).encode()+b' >>\nstream\n'+content.encode()+b'endstream']
    raw = b'%PDF-1.4\n'; offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(raw)); raw += f'{number} 0 obj\n'.encode()+obj+b'\nendobj\n'
    xref = len(raw); raw += f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode()
    raw += b''.join(f'{offset:010d} 00000 n \n'.encode() for offset in offsets[1:])
    return raw+f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF'.encode()


def prepare(output):
    output.mkdir(parents=True, exist_ok=True)
    longitudinal = ['subject,time,group,value']
    for group, slope in [('A', 1), ('B', 3)]:
        for subject, offset in enumerate([-2, -1, .5, 2, 3, 4]):
            for time, noise in enumerate([0, .2, -.1, .1]):
                longitudinal.append(f'{group}{subject},{time},{group},{10+offset+(slope+(subject-2.5)*.04)*time+noise}')
    examples = [
        ('paired', 'stats', {'mode':'paired','column_mapping':{'subject':'患者','before':'治疗前','after':'治疗后'},'csv':'患者,治疗前,治疗后\na,12,9\nb,15,11\nc,11,10\nd,18,13\ne,14,12\nf,17,12'}),
        ('wilcoxon', 'stats', {'mode':'paired','paired_test':'wilcoxon','csv':'subject,before,after\na,10,11\nb,10,12\nc,10,13\nd,10,14\ne,10,15\nf,10,16'}),
        ('longitudinal', 'stats', {'mode':'longitudinal','csv':'\n'.join(longitudinal)}),
        ('survival', 'stats', {'mode':'survival','csv':'subject,time,event,group\na1,2,1,A\na1,6,1,A\na2,4,0,A\na3,4,1,A\nb1,3,1,B\nb2,5,1,B\nb3,5,0,B'}),
        ('groups', 'stats', {'mode':'groups','robustness':True,'csv':'group,value\nA,1.2\nA,1.4\nA,1.6\nA,1.8\nB,2.1\nB,2.4\nB,2.5\nB,2.7'}),
        ('correlation', 'stats', {'mode':'correlation','csv':'x,y\n1,1.2\n2,1.8\n3,2.5\n4,4.1\n5,5.0'}),
        ('roc', 'stats', {'mode':'roc','csv':'label,score\n0,0.1\n1,0.9\n0,0.4\n1,0.7\n0,0.2\n1,0.8'}),
        ('summary', 'stats', {'mode':'summary','data_kind':'aggregate','csv':'group,value\nA,4\nB,6'}),
        ('fit', 'fit', {'csv':'time,concentration\n'+'\n'.join(f'{time},{10*(4/7*math.exp(-.8*time)+3/7*math.exp(-.1*time))}' for time in [0,.25,.5,1,2,3,4,6,8,12,18,24]),'dose':100,'v1':10,'v2':20,'parameters':{'k12':.2,'k21':.2,'ke':.1},'fit_parameters':['k12','k21','ke']})]
    records = []
    for name, operation, data in examples:
        result = compute(operation, data)
        result.pop('python_export', None)
        records.append({'name':name,'operation':operation,'data':data,'expected':result})
    raw = table_pdf()
    (output / 'table.pdf').write_bytes(raw)
    # PdfLibrary's file location is an in-memory /tmp in browser. For the
    # native reference use an explicit workspace location to retain D-only IO.
    from tools.pdf_library import PdfLibrary
    library = PdfLibrary(output / 'native-pdf')
    pdf = library.add(raw, 'table.pdf')
    library.remove(pdf['id'])
    records.append({'name':'pdf','operation':'pdf','data':{'name':'table.pdf'},'expected':{k:pdf[k] for k in ['pages','page_count','tables','table_count','text','title']}})
    (output / 'baseline.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'examples':len(records),'table_count':pdf['table_count'],'output':str(output)}))


if __name__ == '__main__':
    prepare(Path(sys.argv[1]) if len(sys.argv)>1 else Path('D:/workspace/codex_list/output/zhijing-cloud/verification/compute'))
