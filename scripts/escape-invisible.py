# Kaynak dosyalardaki görünmez/biçim karakterlerini \uXXXX kaçışına çevirir (lint + okunabilirlik).
import sys, unicodedata, pathlib
for path in sys.argv[1:]:
    p = pathlib.Path(path); s = p.read_text(encoding="utf-8"); out = []
    for ch in s:
        cat = unicodedata.category(ch)
        if ch not in "\n\t " and (cat in ("Cf", "Zl", "Zp") or (cat == "Zs") or (cat == "Cc")):
            out.append("\\u%04X" % ord(ch))
        else:
            out.append(ch)
    n = "".join(out)
    if n != s:
        p.write_text(n, encoding="utf-8"); print("escaped:", path)
