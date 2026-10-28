"""Write JSON for people to read and diff: objects indented, short arrays and
arrays of numbers on one line."""
import json


def dumps(v, ind=0, width=110):
    pad, flat = " " * ind, json.dumps(v, ensure_ascii=False)
    if not isinstance(v, (dict, list)) or len(flat) + ind <= width and not (isinstance(v, dict) and any(isinstance(x, (dict, list)) and x for x in v.values()) and len(v) > 2):
        return flat
    if isinstance(v, list):
        if all(not isinstance(x, (dict, list)) for x in v):
            return flat
        return "[\n" + ",\n".join(pad + "  " + dumps(x, ind + 2, width) for x in v) + "\n" + pad + "]"
    return "{\n" + ",\n".join(f'{pad}  {json.dumps(k, ensure_ascii=False)}: {dumps(x, ind + 2, width)}' for k, x in v.items()) + "\n" + pad + "}"


def dump(v, path):
    with open(path, "w", encoding="utf8") as f:
        f.write(dumps(v) + "\n")
