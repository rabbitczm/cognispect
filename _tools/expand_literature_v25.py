"""Fetch a deduplicated, source-linked medical literature expansion from Europe PMC."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import unescape
import json
from pathlib import Path
import re
import time
import subprocess
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data/literature-expansion-v25.json"
TARGET = 22_000
PAGE_SIZE = 1_000
SOURCE = "Europe PMC"
TOPICS = [
    ("糖尿病肾病", '"diabetic nephropathy" OR "diabetic kidney disease"'),
    ("原发性高血压", '"essential hypertension" OR "primary hypertension" OR "systemic hypertension"'),
    ("心血管", "cardiovascular disease OR heart disease OR coronary artery disease OR arrhythmia"),
    ("内分泌与糖尿病", "diabetes mellitus OR diabetic nephropathy OR thyroid disease OR obesity"),
    ("肾脏", "kidney disease OR chronic kidney disease OR renal failure OR glomerular disease"),
    ("神经", "neurologic disease OR stroke OR epilepsy OR Alzheimer disease OR Parkinson disease"),
    ("呼吸", "respiratory disease OR asthma OR COPD OR pulmonary fibrosis OR pneumonia"),
    ("消化与肝病", "gastrointestinal disease OR liver disease OR inflammatory bowel disease OR cirrhosis"),
    ("肿瘤", "neoplasms OR cancer OR carcinoma OR tumor OR oncology"),
    ("感染", "infectious disease OR bacterial infection OR viral infection OR antimicrobial resistance"),
    ("免疫与风湿", "autoimmune disease OR rheumatic disease OR rheumatoid arthritis OR lupus"),
    ("血液", "hematologic disease OR anemia OR leukemia OR lymphoma OR thrombosis"),
    ("妇产", "pregnancy OR obstetrics OR gynecology OR maternal health OR reproductive health"),
    ("儿科", "pediatric disease OR child health OR neonatal disease OR infant"),
    ("精神与行为健康", "mental disorder OR depression OR anxiety OR schizophrenia OR addiction"),
    ("骨科与康复", "musculoskeletal disease OR fracture OR osteoarthritis OR rehabilitation"),
    ("皮肤", "skin disease OR dermatology OR psoriasis OR atopic dermatitis"),
    ("眼科", "eye disease OR ophthalmology OR diabetic retinopathy OR glaucoma"),
    ("耳鼻喉与口腔", "otolaryngologic disease OR oral disease OR hearing loss OR dental disease"),
    ("急诊与重症", "critical illness OR intensive care OR sepsis OR emergency medicine"),
    ("公共卫生与护理", "public health OR epidemiology OR nursing OR health services research"),
    ("基础医学", "molecular medicine OR cell biology OR physiology OR translational research"),
    ("影像与放射", "medical imaging OR radiology OR magnetic resonance imaging OR computed tomography"),
    ("临床试验", "clinical trial OR randomized controlled trial OR comparative effectiveness"),
    ("系统综述与指南", "systematic review OR meta-analysis OR clinical practice guideline"),
    ("生物医学统计", "biostatistics OR survival analysis OR diagnostic accuracy OR cohort study"),
    ("药理与治疗", "pharmacotherapy OR drug therapy OR therapeutic use OR treatment outcome"),
    ("遗传与罕见病", "genetic disease OR rare disease OR genomic medicine OR inherited disease"),
    ("血管与高血压", "hypertension OR vascular disease OR pulmonary arterial hypertension OR atherosclerosis"),
    ("肿瘤筛查与生存", "cancer screening OR cancer survival OR neoplasm recurrence OR cancer diagnosis"),
    ("疼痛与麻醉", "pain management OR anesthesia OR analgesia OR perioperative medicine"),
    ("营养与代谢", "nutrition OR metabolic disease OR dyslipidemia OR malnutrition"),
]


def clean(value: object) -> str:
    return re.sub(r"\s+", " ", re.sub(r"</?[^>]+>", " ", unescape(str(value or "")))).strip()


def normalized_title(value: str) -> str:
    return re.sub(r"[^\w\u4e00-\u9fff]", "", value.casefold(), flags=re.UNICODE)


def result_key(record: dict) -> tuple[str, str]:
    pmid, doi = str(record.get("pmid") or "").strip(), str(record.get("doi") or "").strip().casefold()
    if pmid:
        return "pmid", pmid
    if doi:
        return "doi", doi
    author = normalized_title(str(record.get("authorString") or "").split(", et al.")[0])
    return "title", normalized_title(clean(record.get("title"))) + "|" + str(record.get("pubYear") or "") + "|" + author


def fetch_page(topic: tuple[str, str], cursor: str = "*") -> tuple[str, list[dict], str]:
    label, terms = topic
    query = f"SRC:MED AND HAS_ABSTRACT:Y AND FIRST_PDATE:[1800-01-01 TO {datetime.now(timezone.utc).date().isoformat()}] AND TITLE_ABS:({terms})"
    params = {"query": query, "format": "json", "resultType": "core", "pageSize": str(PAGE_SIZE), "cursorMark": cursor}
    url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?" + urlencode(params)
    cache = ROOT / 'scratch/expansion-v25'
    cache.mkdir(parents=True, exist_ok=True)
    cache_file = cache / (str(TOPICS.index(topic)) + '-' + re.sub(r'[^a-zA-Z0-9]', '_', cursor)[-90:] + '.json')
    for attempt in range(4):
        try:
            if cache_file.exists():
                value = json.loads(cache_file.read_text(encoding='utf-8'))
            else:
                source = "const r=await fetch(process.argv[1],{signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error(r.status);process.stdout.write(await r.text());"
                result = subprocess.run(['node', '--input-type=module', '-e', source, url], capture_output=True, encoding='utf-8', check=True)
                value = json.loads(result.stdout)
                cache_file.write_text(result.stdout, encoding='utf-8')
            return label, value.get("resultList", {}).get("result", []), str(value.get("nextCursorMark") or cursor)
        except (HTTPError, URLError, TimeoutError, OSError, subprocess.CalledProcessError):
            if attempt == 3:
                raise
            time.sleep(attempt + 1)
    return label, []


def to_record(row: dict, topic: str, checked: str) -> dict | None:
    title = clean(row.get("title"))
    pmid = str(row.get("pmid") or row.get("id") or "").strip()
    doi = str(row.get("doi") or "").strip()
    if not title or not (pmid or doi):
        return None
    pubtypes = [str(item.get("type") or "") if isinstance(item, dict) else str(item) for item in row.get("pubTypeList", {}).get("pubType", [])]
    if any("retract" in item.casefold() or "erratum" in item.casefold() or "correction" in item.casefold() for item in pubtypes):
        return None
    journal_info = row.get("journalInfo", {})
    journal = journal_info.get("journal", {})
    pmcid = str(row.get("pmcid") or "").strip()
    return {
        "key": pmid or doi,
        "pmid": pmid,
        "pmcid": pmcid,
        "doi": doi,
        "title": title,
        "authors": clean(row.get("authorString")),
        "authors_full": clean(row.get("authorString")),
        "journal": clean(journal.get("title") or row.get("journalTitle")),
        "year": str(row.get("pubYear") or ""),
        "firstdate": str(row.get("firstPublicationDate") or ""),
        "vol": str(journal_info.get("volume") or ""),
        "issue": str(journal_info.get("issue") or ""),
        "pages": str(row.get("pageInfo") or ""),
        "cited": int(row.get("citedByCount") or 0),
        "oa": str(row.get("isOpenAccess") or "").upper() == "Y",
        "level": 1,
        "topics": [topic],
        "mesh": [clean(item.get("descriptorName")) for item in row.get("meshHeadingList", {}).get("meshHeading", []) if clean(item.get("descriptorName"))],
        "abstract": clean(row.get("abstractText")),
        "source_url": "https://europepmc.org/article/MED/" + pmid if pmid else "https://doi.org/" + doi,
        "publisher_url": "https://doi.org/" + doi if doi else "",
        "source": SOURCE,
        "source_checked_at": checked,
        "publication_types": pubtypes,
    }


def main() -> None:
    checked = datetime.now(timezone.utc).isoformat(timespec="seconds")
    collected: dict[tuple[str, str], dict] = {}
    page_counts = {}
    initial_cursors = {}
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_page, topic): topic[0] for topic in TOPICS}
        for future in as_completed(futures):
            try:
                label, rows, next_cursor = future.result()
            except subprocess.CalledProcessError:
                print(f'{futures[future]}: source temporarily unavailable', flush=True)
                continue
            page_counts[label] = len(rows)
            initial_cursors[label] = next_cursor
            for row in rows:
                item = to_record(row, label, checked)
                if not item:
                    continue
                identity = result_key(item)
                previous = collected.get(identity)
                if previous:
                    previous["topics"] = sorted(set(previous["topics"] + item["topics"]))
                    previous["mesh"] = sorted(set(previous["mesh"] + item["mesh"]))
                    if not previous.get("abstract") and item.get("abstract"):
                        previous["abstract"] = item["abstract"]
                else:
                    collected[identity] = item
            print(f"{label}: {len(rows)} fetched; {len(collected)} unique", flush=True)

    if len(collected) < TARGET:
        cursors = initial_cursors
        for page in range(2, 8):
            topics = [topic for topic in TOPICS if page_counts.get(topic[0], 0) >= PAGE_SIZE]
            if not topics or len(collected) >= TARGET:
                break
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {pool.submit(fetch_page, topic, cursors[topic[0]]): topic for topic in topics}
                for future in as_completed(futures):
                    topic = futures[future]
                    label, rows, next_cursor = future.result()
                    for row in rows:
                        item = to_record(row, label, checked)
                        if not item:
                            continue
                        identity = result_key(item)
                        if identity in collected:
                            collected[identity]["topics"] = sorted(set(collected[identity]["topics"] + item["topics"]))
                            continue
                        collected[identity] = item
                    page_counts[label] = len(rows)
                    cursors[label] = next_cursor
            print(f"page {page}: {len(collected)} unique", flush=True)

    records = []
    identifiers = set()
    for item in collected.values():
        aliases = [('pmid', item['pmid'])] if item.get('pmid') else []
        if item.get('doi'): aliases.append(('doi', item['doi'].casefold()))
        aliases.append(('title', normalized_title(item['title']) + '|' + item['year'] + '|' + normalized_title(item['authors'].split(',')[0])))
        if any(alias in identifiers for alias in aliases): continue
        identifiers.update(aliases)
        records.append(item)
    if len(records) < TARGET:
        raise RuntimeError(f"Europe PMC yielded {len(records):,} unique records; {TARGET:,} required")
    records.sort(key=lambda item: (item.get("firstdate") or item.get("year") or "", item["key"]), reverse=True)
    result = {"version": "v25", "source": SOURCE, "checked_at": checked, "target": TARGET, "record_count": len(records), "topic_counts": {label: page_counts.get(label, 0) for label, _ in TOPICS}, "records": records}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"path": str(OUTPUT), "records": len(records), "bytes": OUTPUT.stat().st_size, "topics": len(TOPICS)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
