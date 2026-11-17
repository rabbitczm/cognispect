"""Shared entry point for the browser's Python Web Worker."""
import inspect
import json
from pathlib import Path

def compute(operation, data):
    if operation == 'pdf':
        from .pdf_library import PdfLibrary
        library = PdfLibrary(Path(__file__).resolve().parents[1] / 'scratch/browser-pdf')
        result = library.add(bytes(data['bytes']), data.get('name', 'document.pdf'), data.get('source'))
        library.remove(result['id'])
        return result
    from .medical_analysis import analyze_medical, fit_model, _json_safe
    from .research_api import analyze_csv, auc
    if operation == 'fit':
        return fit_model(data)
    if operation != 'stats':
        raise ValueError('未知分析操作')
    if data.get('mode') in {'paired', 'longitudinal', 'survival'}:
        return analyze_medical(data)
    result = analyze_csv(data['csv'], data.get('mode', 'groups'),
                         data.get('robustness', False), data.get('data_kind', 'individual'),
                         data.get('provenance'), data.get('ordered', False))
    result['synthetic'] = bool(data.get('synthetic'))
    source = '\n\n'.join(inspect.getsource(method) for method in (auc, analyze_csv))
    result['python_export'] = (
        '# Python 3; scipy, numpy. Contains input data and complete analysis method.\n'
        'import csv, io, json, math, hashlib, statistics\n\n' + source +
        '\n\nrequest = ' + repr(data) +
        '\nresult = analyze_csv(request["csv"], request.get("mode", "groups"), '
        'request.get("robustness", False), request.get("data_kind", "individual"), '
        'request.get("provenance"), request.get("ordered", False))\n'
        'if __name__ == "__main__":\n'
        '    print(json.dumps(result, ensure_ascii=False, indent=2))\n')
    return _json_safe(result)
