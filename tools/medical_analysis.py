"""配对、纵向、生存分析与二室静脉推注药代参数拟合。"""
from __future__ import annotations

import csv
import io
import inspect
import math

import numpy as np
from scipy import optimize, stats


def _json_safe(value):
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, np.ndarray)):
        return [_json_safe(item) for item in value]
    if isinstance(value, (np.integer, np.bool_)):
        return value.item()
    if isinstance(value, (float, np.floating)):
        return float(value) if math.isfinite(value) else None
    return value


def _read_csv(data, required, text_fields=()):
    text = data.get('csv', '')
    reader = csv.DictReader(io.StringIO('\n'.join(
        line for line in text.lstrip('\ufeff').splitlines() if not line.lstrip().startswith('#'))))
    mapping = data.get('column_mapping') or {}
    columns = {name: mapping.get(name, name) for name in required}
    missing = [column for column in columns.values() if column not in (reader.fieldnames or [])]
    if missing:
        raise ValueError('CSV缺少列：' + '、'.join(missing))
    rows, excluded = [], 0
    for source in reader:
        if any(not str(source.get(column) or '').strip() for column in columns.values()):
            excluded += 1
            continue
        row = {}
        for name, column in columns.items():
            value = source[column].strip()
            if name not in text_fields:
                try:
                    value = float(value)
                except ValueError:
                    raise ValueError(f'列“{column}”含非数值单元格') from None
                if not math.isfinite(value):
                    raise ValueError(f'列“{column}”含非有限数值')
            row[name] = value
        rows.append(row)
    if not rows:
        raise ValueError('CSV没有完整的有效观测')
    return rows, excluded


def analyze_medical(data):
    """接受 csv、mode 与语义列到原始列的 column_mapping，返回可绘图结果。"""
    mode = data.get('mode', 'paired')
    if mode == 'paired':
        result = _paired(data)
    elif mode == 'longitudinal':
        result = _longitudinal(data)
    elif mode == 'survival':
        result = _survival(data)
    else:
        raise ValueError('请选择配对、纵向或生存分析')
    result['python_export'] = _medical_export(data, mode)
    return _json_safe(result)


def _medical_export(data, mode):
    function = {'paired': _paired, 'longitudinal': _longitudinal, 'survival': _survival}[mode]
    dependencies = 'numpy, scipy, pandas, statsmodels' if mode == 'longitudinal' else 'numpy, scipy'
    request = {key: data[key] for key in ('csv', 'column_mapping', 'paired_test') if key in data}
    source = '\n\n'.join(inspect.getsource(item) for item in (_json_safe, _read_csv, function))
    return (f'# Python 3.12；依赖：{dependencies}。内含本次原始CSV、列映射与完整分析方法。\n'
            'import csv\nimport io\nimport json\nimport math\n'
            'import numpy as np\nfrom scipy import stats\n\n' + source +
            f'\n\nrequest = {request!r}\nresult = _json_safe({function.__name__}(request))\n'
            'if __name__ == "__main__":\n'
            '    import sys\n'
            '    sys.stdout.reconfigure(encoding="utf-8")\n'
            '    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))\n')


def _paired(data):
    rows, excluded = _read_csv(data, ['subject', 'before', 'after'], ['subject'])
    if len(rows) < 2:
        raise ValueError('配对分析至少需要两名受试者的完整前后观测')
    if len({row['subject'] for row in rows}) != len(rows):
        raise ValueError('配对数据每名受试者应仅占一行，重复随访请使用纵向分析')
    before = np.array([row['before'] for row in rows])
    after = np.array([row['after'] for row in rows])
    difference = after - before
    n = len(rows)
    mean = float(difference.mean())
    sd = float(difference.std(ddof=1))
    half = float(stats.t.ppf(.975, n - 1) * sd / math.sqrt(n))
    method = data.get('paired_test', 't')
    if method in {'t', 'paired_t'}:
        if sd == 0:
            statistic, p = (None, 1.) if mean == 0 else (None, 0.)
        else:
            statistic = mean / (sd / math.sqrt(n))
            p = float(2 * stats.t.sf(abs(statistic), n - 1))
        method_name = 'Paired t-test'
    elif method == 'wilcoxon':
        statistic, p = (0., 1.) if np.all(difference == 0) else stats.wilcoxon(difference, alternative='two-sided')
        method_name = 'Wilcoxon signed-rank'
    else:
        raise ValueError('配对检验请选择t检验或Wilcoxon符号秩检验')
    paired = {'method': method_name, 'statistic': statistic, 'p': p,
              'difference_direction': 'after - before', 'mean_difference': mean,
              'median_difference': float(np.median(difference)), 'sd_difference': sd,
              'mean_difference_ci95': [mean - half, mean + half], 'n': n}
    for row, delta in zip(rows, difference):
        row['difference'] = float(delta)
    return {'mode': 'paired', 'n': n, 'excluded_rows': excluded, 'rows': rows,
            'paired': paired, 'result_rows': [{'指标': '完整配对数', '值': n},
                {'指标': '平均变化（后−前）', '值': mean}, {'指标': '双侧P值', '值': p}],
            'summary': f'{n}名受试者；平均变化（后−前）{mean:.4g}，双侧P={p:.4g}。',
            'series': [{'name': '治疗前', 'x': [r['subject'] for r in rows], 'y': before.tolist()},
                       {'name': '治疗后', 'x': [r['subject'] for r in rows], 'y': after.tolist()}]}


def _longitudinal(data):
    import pandas as pd
    from statsmodels.formula.api import mixedlm

    rows, excluded = _read_csv(data, ['subject', 'time', 'group', 'value'], ['subject', 'group'])
    frame = pd.DataFrame(rows)
    if frame.groupby('subject')['group'].nunique().max() > 1:
        raise ValueError('同一受试者的组别应保持一致')
    if frame['group'].nunique() < 2 or frame['time'].nunique() < 2:
        raise ValueError('组别×时间模型至少需要两组和两个不同随访时间')
    if not (frame.groupby('subject').size() >= 2).any():
        raise ValueError('纵向模型需要同一受试者的重复观测')
    model = mixedlm('value ~ time * C(group)', frame, groups=frame['subject'], re_formula='1')
    fitted = model.fit(reml=False, method=['lbfgs', 'bfgs'], disp=False)
    confidence = fitted.conf_int()
    coefficients = [{'term': name, 'estimate': float(estimate),
                     'se': float(fitted.bse[name]), 'p': float(fitted.pvalues[name]),
                     'ci95': [float(v) for v in confidence.loc[name]]}
                    for name, estimate in fitted.fe_params.items()]
    series = []
    for group in frame['group'].unique():
        times = np.sort(frame.loc[frame['group'] == group, 'time'].unique())
        predicted = fitted.predict(pd.DataFrame({'time': times, 'group': group}))
        series.append({'name': str(group) + '（模型均值）', 'x': times.tolist(), 'y': predicted.tolist()})
    mixed = {'formula': 'value ~ time * C(group) + (1 | subject)',
             'time_type': 'continuous', 'reference_group': str(sorted(frame['group'].unique())[0]),
             'subjects': int(frame['subject'].nunique()), 'coefficients': coefficients,
             'random_intercept_variance': float(fitted.cov_re.iloc[0, 0]),
             'residual_variance': float(fitted.scale), 'converged': bool(fitted.converged),
             'estimation': 'maximum likelihood'}
    result_rows = [{'项': row['term'], '估计': row['estimate'], '标准误': row['se'],
                    'P值': row['p'], '95%CI下限': row['ci95'][0], '95%CI上限': row['ci95'][1]}
                   for row in coefficients]
    return {'mode': 'longitudinal', 'n': len(rows), 'excluded_rows': excluded,
            'rows': rows, 'mixed_model': mixed, 'result_rows': result_rows, 'series': series,
            'summary': f'{mixed["subjects"]}名受试者、{len(rows)}次观测；以受试者随机截距拟合连续时间、组别及交互作用。' +
                       ('' if fitted.converged else '模型未收敛，请检查拟合结果。')}


def _survival(data):
    rows, excluded = _read_csv(data, ['subject', 'time', 'event', 'group'], ['subject', 'group'])
    subjects = {}
    for row in rows:
        if row['time'] < 0 or row['event'] not in (0, 1):
            raise ValueError('生存时间应非负；event用1表示首次事件、0表示删失')
        subjects.setdefault(row['subject'], []).append(row)
    collapsed = []
    for subject, observations in subjects.items():
        if len({row['group'] for row in observations}) != 1:
            raise ValueError('同一受试者的组别应保持一致')
        events = [row for row in observations if row['event'] == 1]
        chosen = min(events, key=lambda row: row['time']) if events else max(observations, key=lambda row: row['time'])
        collapsed.append(dict(chosen, event=int(chosen['event'])))
    groups, series, result_rows = {}, [], []
    for label in dict.fromkeys(row['group'] for row in collapsed):
        observations = [row for row in collapsed if row['group'] == label]
        survival, greenwood, median = 1., 0., None
        table = []
        for time in sorted({row['time'] for row in observations}):
            risk = sum(row['time'] >= time for row in observations)
            events = sum(row['time'] == time and row['event'] == 1 for row in observations)
            censored = sum(row['time'] == time and row['event'] == 0 for row in observations)
            survival *= 1 - events / risk
            if risk > events:
                greenwood += events / (risk * (risk - events))
            if survival in (0., 1.):
                ci = [survival, survival]
            else:
                z = math.log(-math.log(survival))
                half = 1.959963984540054 * math.sqrt(greenwood) / abs(math.log(survival))
                ci = [math.exp(-math.exp(z + half)), math.exp(-math.exp(z - half))]
            if median is None and survival <= .5:
                median = time
            table.append({'time': time, 'at_risk': risk, 'events': events,
                          'censored': censored, 'survival': survival, 'ci95': ci})
        events = sum(row['event'] for row in observations)
        groups[label] = {'n': len(observations), 'events': events, 'censored': len(observations) - events,
                         'median_survival': median, 'table': table}
        series.append({'name': label, 'x': [0.] + [row['time'] for row in table],
                       'y': [1.] + [row['survival'] for row in table], 'step': 'post',
                       'censor_x': [row['time'] for row in table if row['censored']],
                       'censor_y': [row['survival'] for row in table if row['censored']]})
        result_rows.append({'组别': label, '受试者数': len(observations), '事件数': events,
                            '删失数': len(observations) - events, '中位生存时间': median,
                            '统计量χ²': None, '自由度': None, 'P值': None})
    labels = list(groups)
    logrank = None
    if len(labels) >= 2:
        score = np.zeros(len(labels))
        covariance = np.zeros((len(labels), len(labels)))
        for time in sorted({row['time'] for row in collapsed if row['event']}):
            risk = np.array([sum(row['time'] >= time and row['group'] == label for row in collapsed) for label in labels], dtype=float)
            deaths = np.array([sum(row['time'] == time and row['event'] and row['group'] == label for row in collapsed) for label in labels], dtype=float)
            total, death_total = risk.sum(), deaths.sum()
            proportions = risk / total
            score += deaths - death_total * proportions
            if total > 1:
                covariance += death_total * (total - death_total) / (total - 1) * (np.diag(proportions) - np.outer(proportions, proportions))
        rank = int(np.linalg.matrix_rank(covariance[:-1, :-1]))
        if rank:
            statistic = float(score[:-1] @ np.linalg.pinv(covariance[:-1, :-1]) @ score[:-1])
            logrank = {'method': 'Log-rank', 'statistic': statistic, 'df': rank,
                       'p': float(stats.chi2.sf(statistic, rank))}
        else:
            logrank = {'method': 'Log-rank', 'statistic': None, 'df': 0, 'p': None}
        result_rows.append({'组别': 'Log-rank组间比较', '受试者数': len(collapsed),
                            '事件数': sum(row['event'] for row in collapsed),
                            '删失数': sum(1 - row['event'] for row in collapsed), '中位生存时间': None,
                            '统计量χ²': logrank['statistic'], '自由度': logrank['df'], 'P值': logrank['p']})
    summary = f'{len(collapsed)}名受试者；按首次事件或末次无事件随访计算Kaplan–Meier曲线。'
    if logrank:
        summary += (f'Log-rank组间比较：χ²={logrank["statistic"]:.4g}，df={logrank["df"]}，P={logrank["p"]:.4g}。'
                    if logrank['p'] is not None else 'Log-rank组间比较无法估计（没有可比较的事件风险差异）。')
    return {'mode': 'survival', 'n': len(collapsed), 'excluded_rows': excluded,
            'input_observations': len(rows), 'rows': collapsed, 'result_rows': result_rows, 'series': series,
            'survival': {'groups': groups, 'logrank': logrank, 'endpoint': 'first event'},
            'summary': summary}


def _pk_concentration(time, dose, v1, parameters):
    k12, k21, ke = (parameters[name] for name in ('k12', 'k21', 'ke'))
    total = k12 + k21 + ke
    gap = math.sqrt(total * total - 4 * k21 * ke)
    alpha, beta = (total + gap) / 2, (total - gap) / 2
    if gap == 0:
        return dose / v1 * np.exp(-alpha * time) * (1 + (alpha - k12 - ke) * time)
    a = (k12 + ke - beta) / gap
    return dose / v1 * (a * np.exp(-alpha * time) + (1 - a) * np.exp(-beta * time))


def fit_model(data):
    """二室模型：已知静脉推注剂量与分布容积，拟合选定的一阶速率。"""
    rows, excluded = _read_csv(data, ['time', 'concentration'])
    dose, v1, v2 = (float(data.get(name, default)) for name, default in [('dose', 100), ('v1', 10), ('v2', 20)])
    if min(dose, v1, v2) <= 0:
        raise ValueError('剂量与两个分布容积应大于0')
    if any(row['time'] < 0 or row['concentration'] < 0 for row in rows):
        raise ValueError('时间与观测浓度应非负')
    parameters = {name: float((data.get('parameters') or {}).get(name, default))
                  for name, default in [('k12', .3), ('k21', .2), ('ke', .1)]}
    selected = data.get('fit_parameters', ['k12', 'k21', 'ke'])
    if not selected or any(name not in parameters for name in selected):
        raise ValueError('请选择需要拟合的k12、k21或ke')
    if min(parameters.values()) <= 0:
        raise ValueError('速率参数初始值应大于0')
    if len(rows) <= len(selected):
        raise ValueError('观测数应多于拟合参数数目')
    time = np.array([row['time'] for row in rows])
    observed = np.array([row['concentration'] for row in rows])
    initial = dict(parameters)

    def residual(vector):
        return _pk_concentration(time, dose, v1, dict(parameters, **dict(zip(selected, vector)))) - observed

    fit = optimize.least_squares(residual, [parameters[name] for name in selected], bounds=(0, np.inf),
                                 xtol=1e-12, ftol=1e-12, gtol=1e-12)
    parameters.update(zip(selected, map(float, fit.x)))
    predicted = _pk_concentration(time, dose, v1, parameters)
    error = observed - predicted
    sse = float(error @ error)
    centered = observed - observed.mean()
    total = float(centered @ centered)
    metrics = {'rmse': math.sqrt(sse / len(rows)), 'mae': float(np.abs(error).mean()),
               'sse': sse, 'r_squared': 1 - sse / total if total else None,
               'converged': bool(fit.success), 'n': len(rows), 'fitted_parameters': len(selected)}
    for row, prediction, residual_value in zip(rows, predicted, error):
        row.update(predicted=float(prediction), residual=float(residual_value))
    curve_time = np.linspace(0, float(max(time)), 200)
    result = {'mode': 'pk_fit', 'model': 'two_compartment_iv_bolus', 'n': len(rows),
              'excluded_rows': excluded, 'dose': dose, 'v1': v1, 'v2': v2,
              'parameters': parameters, 'fit_parameters': selected, 'metrics': metrics, 'rows': rows,
              'result_rows': [{'参数': name, '估计值': value, '是否拟合': name in selected} for name, value in parameters.items()],
              'series': [{'name': '观测浓度', 'x': time.tolist(), 'y': observed.tolist(), 'type': 'scatter'},
                         {'name': '二室模型拟合', 'x': curve_time.tolist(), 'y': _pk_concentration(curve_time, dose, v1, parameters).tolist(), 'type': 'line'},
                         {'name': '残差', 'x': time.tolist(), 'y': error.tolist(), 'type': 'residual'}],
              'summary': f'二室静脉推注模型，{len(rows)}个观测；RMSE={metrics["rmse"]:.4g}，R²={metrics["r_squared"]:.4g}。' if total else f'二室静脉推注模型，{len(rows)}个观测；RMSE={metrics["rmse"]:.4g}。'}
    result['python_export'] = _pk_export(time.tolist(), observed.tolist(), dose, v1, v2, initial, selected)
    return _json_safe(result)


def _pk_export(time, observed, dose, v1, v2, parameters, selected):
    return f'''# 二室静脉推注模型；时间与速率的单位应相互对应，浓度单位为剂量单位/容积单位。
import numpy as np
from scipy.optimize import least_squares

time = np.array({time!r}, dtype=float)
observed = np.array({observed!r}, dtype=float)
dose, v1, v2 = {dose!r}, {v1!r}, {v2!r}
parameters = {parameters!r}
selected = {selected!r}

def concentration(t, p):
    k12, k21, ke = (p[name] for name in ('k12', 'k21', 'ke'))
    total = k12 + k21 + ke
    gap = np.sqrt(total**2 - 4*k21*ke)
    alpha, beta = (total+gap)/2, (total-gap)/2
    if gap == 0:
        return dose/v1*np.exp(-alpha*t)*(1+(alpha-k12-ke)*t)
    a = (k12+ke-beta)/gap
    return dose/v1*(a*np.exp(-alpha*t)+(1-a)*np.exp(-beta*t))

def residual(vector):
    p = dict(parameters, **dict(zip(selected, vector)))
    return concentration(time, p) - observed

fit = least_squares(residual, [parameters[name] for name in selected], bounds=(0, np.inf),
                    xtol=1e-12, ftol=1e-12, gtol=1e-12)
parameters.update(zip(selected, map(float, fit.x)))
predicted = concentration(time, parameters)
residuals = observed - predicted
rmse = float(np.sqrt(np.mean(residuals**2)))
if __name__ == '__main__':
    print('参数：', parameters)
    print('RMSE：', rmse)
    print('时间、观测浓度、预测浓度、残差：')
    print(np.column_stack([time, observed, predicted, residuals]))
'''
