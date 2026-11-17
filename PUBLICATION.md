# 文献正式发布准备

冻结范围为知镜 `_lib/lib.json` 的 2310 条题录。2026-11-15 核验：题名草稿12/2310；摘要完整对齐471、部分对齐1095、原译文源文变化704、无源摘要40；已对照AI审核12篇题名及摘要。官方PMCID JATS首次和许可明确失败重试后共取得1466篇有效正文，1篇仅有文后内容无正文，586篇仍为官方接口500/TLS/超时错误，257篇无PMCID；其中9篇有官方OA替代地址，逐一抓取未得到可用正文。当前可翻译正文候选1122篇（CC BY/CC0 989、CC BY-NC* 133），完整批量待译规模见下方 plan 命令；全库尚未翻译完成。正式发布目标是完成全部题名、可获取摘要及许可允许的开放全文的翻译和复核。当前未正式发布；原有 13 条日期待核验记录保持独立状态。

## 数据

- `data/publication/manifest.json`：冻结清单、来源日期、许可证据、翻译和复核状态、正文下载进度。
- `data/publication/sources/<PMCID>.xml`：Europe PMC 官方 JATS 原文。
- `data/publication/sources/<PMCID>.source.json`：接口地址、抓取时间、HTTP 状态与响应提供的版本信息。
- `data/publication/documents/<key>.json`：标准化阅读数据；包含段落原文和中文配对、表格、图注、公式与参考文献。
- `data/publication/translation-drafts.json`：标题和摘要的完整原文、译文与逐条复核记录。已有 12 对补译，`ai_reviewed` 表示本助手进行了源文对照；不是人工审核状态。
- `data/publication/license-decisions.json`：ND、未知许可及非商业许可记录列表。`data/publication/text-number-check.json`：机器/人工源对照后运行的数字差异核查清单，仅供语境复核。`data/publication/publisher-candidates.json`：无PMCID的官方OA替代来源尝试结果。

正文结构为 `sections[{id,title,title_zh,paragraphs[{id,en,zh,translation_status,review_status}]}]`。表格保留文本行和原始 JATS 表格 XML，避免丢失合并单元格；公式保留 XML；图像名称与图注保留在 `figures`，官方文章链接可用于访问原图。参考文献和段落内引文目标分别存储。

下载完成使用 `fulltext_status=downloaded`；这不意味着翻译或复核完成。新文档为 `publication_status=draft`、`public=false`。对外阅读接口需要使用清单中的许可、日期和发布状态；本地准备进度可直接读取清单。抓取失败保留实际 HTTP/TLS 错误，`fetch_error` 不代表该文章不存在。

## 许可分类

`eligible` 表示明确的 CC BY、CC BY-SA 或 CC0；`eligible_noncommercial` 表示 CC BY-NC 或 CC BY-NC-SA；ShareAlike 要求另以 `share_alike` 保存。`permission_required_nd` 表示带 ND 的许可，不能自动纳入可公开译作集合。`license_unknown` 表示还缺少明确的改编许可。`license_conflict` 表示同一文章不同位置的许可文字矛盾，保留双方证据等待核实。优先使用文章 JATS 内的 permissions，题录许可单独标记证据来源。OA 字段不用于推定翻译许可。

无 PMCID 的记录仍保留 DOI 与官方题录返回的全文候选链接；不能仅因缺少 PMCID 将它们排除出开放全文核查范围。

## 恢复抓取

在本项目目录运行：

```powershell
$env:TEMP = 'D:\workspace\codex_list\scratch\tmp'
$env:TMP = $env:TEMP
$env:PYTHONDONTWRITEBYTECODE = '1'
$env:PYTHONIOENCODING = 'utf-8'
python _tools/prepare_publication.py --fetch --workers 12
python _tools/prepare_publication.py --fetch --retry-errors --workers 6
python _tools/prepare_publication.py --normalize
```

普通运行只处理尚未尝试的 PMCID，已下载的 XML 可以重新标准化而无需重复联网。`--retry-errors` 重试失败记录。每 25 个结果更新清单；原始来源文件按单篇保存。

## 独立批量翻译

`_tools/translate_publication.py` 使用独立 DeepL 账户，仅读取 `HELIX_TRANSLATION_KEY`，不会读取问答模型配置或问答 API 密钥。按 DeepL 每请求最多 50 个文本、128 KiB 请求体的规格分批，逐批保存，支持中断后继续。机器翻译不会自动成为已复核或正式发布内容。翻译请求包含按文章、章节组织的上下文。保持数字单元格、公式、原始英文及参考文献来源。可运行 `python _tools/translate_publication.py --check-numbers` 生成文本中的数字差异核查清单；该清单只供语境复核，不自动判错。

先查看实际待译规模：

```powershell
python _tools/translate_publication.py --plan --scope all
python _tools/translate_publication.py --plan --scope metadata
```

配置独立翻译账户后可运行：

```powershell
python _tools/translate_publication.py --scope all
```

范围可选 `metadata`、`fulltext` 或 `all`。日期待核验记录不发送；全文仅选择 `eligible` 与 `eligible_noncommercial`。非商业许可对应的使用场景和署名要求仍需在正式发布前落实。实际服务调用尚未执行，当前只有规模计划结果。

## 已完成的源文对照译稿

PMID 31867417（乳腺超声图像数据集）已有9段正文和文后内容、3张表、4条图注的中文配对稿。段落、标题、表格与图注进行过AI源文对照，状态仍为草稿。补充文件和图像内部文字未纳入该译稿，参考文献保留原始书目信息。原表各类别数量之和为830，而原文合计写780；中文保留原值，矛盾记在文档的 `review.findings` 中。

## 验证

`python -m unittest discover -s tests -p test_publication_library.py` 验证真实形状的 JATS 正文、表图、公式与参考文献提取，以及源文变化时原译文不会继续被标记为对应当前版本。
