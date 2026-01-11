"""
Conversor simples: XLSX -> JSON

Uso:
  python convert_xlsx_to_json.py "Tatsumaki ShadowHeart Gojo.xlsx"

Ele gera/atualiza: data/character.json

Observação:
- este script tenta “adivinhar” onde estão as coisas na planilha.
- se sua ficha mudar de layout, você provavelmente vai ajustar as células lidas aqui.

Dependências:
  pip install pandas openpyxl
"""

import json
import re
from pathlib import Path

import pandas as pd


def split_name_level(s: str):
    s = (s or "").strip()
    m = re.match(r"^(.*?)(\d+)\s*$", s)
    if m and m.group(1).strip():
        return {"name": m.group(1).strip(), "level": int(m.group(2)), "raw": s}
    return {"name": s, "level": None, "raw": s}


def parse_multi_name_level(s: str):
    s = (s or "").strip()
    items = []
    for m in re.finditer(r"([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ ]*?)(\d+)", s):
        items.append({"name": m.group(1).strip(), "level": int(m.group(2))})
    return items or [{"name": s, "level": None}]


def parse_level_abilities(text: str):
    t = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    pattern = re.compile(
        r"^(?P<prefix>[\W\w]{0,3})\s*Nível\s*(?P<level>\d+)\s*[–-]\s*(?P<name>.+?)(?:\s*\((?P<type>[^)]+)\))?\s*$",
        flags=re.MULTILINE,
    )
    matches = list(pattern.finditer(t))
    abilities = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(t)
        body = t[start:end].strip()
        abilities.append(
            {
                "level": int(m.group("level")),
                "name": m.group("name").strip(),
                "type": (m.group("type") or "").strip(),
                "icon_prefix": (m.group("prefix") or "").strip(),
                "text": body,
            }
        )
    return abilities


def main(xlsx_path: str):
    xlsx_path = str(xlsx_path)
    df = pd.read_excel(xlsx_path, sheet_name="Ficha", header=None)
    hab_df = pd.read_excel(xlsx_path, sheet_name="Habilidades", header=None)
    ess_df = pd.read_excel(xlsx_path, sheet_name="Essência", header=None)
    karma_df = pd.read_excel(xlsx_path, sheet_name="Karma", header=None)

    name = str(df.iat[2, 5]).strip()
    race = split_name_level(str(df.iat[2, 20]))
    cls = split_name_level(str(df.iat[3, 20]))
    profs = parse_multi_name_level(str(df.iat[4, 20]))
    xp_raw = str(df.iat[2, 38]).strip() if not pd.isna(df.iat[2, 38]) else None

    # attributes from a known block
    attr_map = {}
    for r in range(10, 28):
        n = df.iat[r, 1]
        if isinstance(n, str) and n.strip() and n.strip() != "Atributo" and not pd.isna(df.iat[r, 6]):
            v = int(df.iat[r, 6])
            quarter = df.iat[r, 9]
            eighth = df.iat[r, 12]
            attr_map[n.strip()] = {
                "name": n.strip(),
                "value": v,
                "quarter": int(quarter) if not pd.isna(quarter) else round(v / 4),
                "eighth": int(eighth) if not pd.isna(eighth) else round(v / 8),
            }

    # skills blocks
    def parse_skills(start_row, end_row, name_col, attr_col, level_col, prof_col, total_col):
        out = []
        for r in range(start_row, min(end_row, df.shape[0])):
            nm = df.iat[r, name_col]
            if not isinstance(nm, str) or not nm.strip():
                continue
            out.append(
                {
                    "name": nm.strip(),
                    "attribute": df.iat[r, attr_col],
                    "level": None if pd.isna(df.iat[r, level_col]) else int(df.iat[r, level_col]),
                    "proficient": bool(df.iat[r, prof_col]) if not pd.isna(df.iat[r, prof_col]) else False,
                    "total": None if pd.isna(df.iat[r, total_col]) else int(df.iat[r, total_col]),
                }
            )
        return out

    physical = parse_skills(34, 90, 1, 5, 10, 12, 13)
    intellectual = parse_skills(34, 90, 16, 20, 25, 27, 28)

    # CA and misc
    ca_total = df.iat[23, 16]
    components = {}
    for r in range(23, 28):
        label = df.iat[r, 19]
        val = df.iat[r, 23]
        if isinstance(label, str) and not pd.isna(val):
            components[label.strip().lower()] = float(val)

    perception = df.iat[25, 25]
    luck = df.iat[25, 29]

    # tracks in known block
    tracks = {}
    for r in range(0, 40):
        label = df.iat[r, 16]
        if isinstance(label, str) and label.strip().startswith("P."):
            cur = 0 if pd.isna(df.iat[r, 20]) else int(df.iat[r, 20])
            maxv = None if pd.isna(df.iat[r, 24]) else int(df.iat[r, 24])
            temp = 0 if pd.isna(df.iat[r, 28]) else int(df.iat[r, 28])
            tracks[label.strip()] = {"current": cur, "max": maxv, "temp": temp}

    craft_tree_raw = str(df.iat[146, 1]) if not pd.isna(df.iat[146, 1]) else ""
    combat_raw = str(df.iat[146, 43]) if not pd.isna(df.iat[146, 43]) else ""
    combat_tree = parse_level_abilities(combat_raw)

    exclusive_raw = str(hab_df.iat[5, 1]) if not pd.isna(hab_df.iat[5, 1]) else ""

    stages = [
        str(x)
        for x in ess_df[1].dropna().astype(str).tolist()
        if "Estágio" in str(x)
    ]

    karma_positive = None if pd.isna(karma_df.iat[10, 9]) else int(karma_df.iat[10, 9])

    character = {
        "meta": {"name": name, "race": race, "class": cls, "professions": profs, "experience_raw": xp_raw},
        "attributes": list(attr_map.values()),
        "skills": {"physical": physical, "intellectual": intellectual},
        "stats": {"armor_class": {"total": ca_total, "components": components}, "perception": perception, "luck": luck, "tracks": tracks},
        "abilities": {"combat_tree": combat_tree, "craft_tree_raw": craft_tree_raw, "exclusive_raw": exclusive_raw},
        "notes": {"essence_stages": stages, "karma_positive": karma_positive},
        "actions": [
            {"name": "Teste: Lutar", "category": "Perícia", "roll": "1d20 + @skills.physical.Lutar.total"}
        ],
    }

    out_path = Path(__file__).parent / "data" / "character.json"
    out_path.write_text(json.dumps(character, ensure_ascii=False, indent=2), encoding="utf-8")
    print("OK ->", out_path)


if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Uso: python convert_xlsx_to_json.py <caminho_para_xlsx>")
        raise SystemExit(2)
    main(sys.argv[1])
