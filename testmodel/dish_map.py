"""
dish_map.py — ánh xạ TÊN MÓN TIẾNG VIỆT (do pipeline thật của app trả về) về
1 trong 14 class của Vietnamese_StreetFood_14Class.

Vì sao cần: benchmark `closed14` bắt model chọn 1 trong 14 nhãn cho sẵn, còn
app thật hỏi mở ("món này là món gì") và nhận về tên tự do tiếng Việt. Điểm cao
ở bài đóng KHÔNG bảo đảm app thật nhận đúng. Muốn đo cái app thật làm thì phải
dịch được câu trả lời tự do về nhãn để so với ground truth.

KỶ LUẬT — giống parse_label() trong benchmark.py:
  Không đoán mò. Chỉ khớp khi tên món chứa một cụm ĐỦ ĐẶC TRƯNG cho đúng một
  class. Tên không khớp được → trả -1 = INVALID = tính là SAI.

  Cám dỗ ở đây là viết luật kiểu "có chữ 'bún' thì chắc là bún chả" — làm thế
  là chấm điểm hộ model và thổi phồng kết quả. Bộ này có tới 4 món bắt đầu bằng
  "bún" (bún bò Huế, bún chả, bún đậu, bún thịt nướng): mơ hồ thì phải tính là
  không nhận ra, chứ không được chọn bừa.
"""
from __future__ import annotations

import re
import unicodedata


def _norm(s: str) -> str:
    """Bỏ dấu, bỏ ký tự lạ, gộp khoảng trắng → so khớp không phụ thuộc dấu.

    Cần bỏ dấu vì model lúc viết "phở" lúc viết "pho", lúc "bún" lúc "bun".
    """
    s = unicodedata.normalize("NFD", str(s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = s.replace("đ", "d").replace("Đ", "d")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# class_id → các cụm nhận dạng (đã bỏ dấu). Khớp theo CHUỖI CON.
# Thứ tự trong danh sách không quan trọng; xung đột giữa các class xử lý bên dưới.
ALIASES: dict[int, list[str]] = {
    0:  ["banh cuon", "banh uot"],
    1:  ["banh gio"],
    2:  ["banh mi"],
    3:  ["bun bo hue", "bun bo"],
    4:  ["bun cha"],                      # bún chả (Hà Nội)
    5:  ["bun dau", "bun dau mam tom"],
    6:  ["bun thit nuong"],
    7:  ["chao long"],
    8:  ["com lang vong", "com det", "com xanh", "com non"],   # CỐM, không phải cơm
    9:  ["com tam"],
    10: ["com rang", "com chien"],
    11: ["pho bo", "pho tai", "pho chin", "pho gau"],
    12: ["goi cuon", "nem cuon", "spring roll", "summer roll"],
    13: ["xoi"],
}

# Cụm nào là khúc con của cụm khác thì phải xét cụm DÀI trước, nếu không
# "bun bo" sẽ nuốt mất "bun bo hue" và "com" sẽ nuốt "com tam".
_FLAT: list[tuple[str, int]] = sorted(
    ((a, cid) for cid, arr in ALIASES.items() for a in arr),
    key=lambda x: -len(x[0]),
)

# Những cụm CHẮC CHẮN không phải class nào trong 14 — bắt được thì trả -1 luôn
# thay vì để chuỗi con khớp nhầm. Ví dụ "nem rán/chả giò" là món CHIÊN, không
# phải "Spring Rolls" (= gỏi cuốn tươi) của bộ này; "phở gà" không phải "Beef Pho".
NEGATIVE: list[tuple[str, str]] = [
    ("nem ran", "nem rán là món chiên, class 12 là gỏi cuốn tươi"),
    ("cha gio", "chả giò là món chiên, class 12 là gỏi cuốn tươi"),
    ("pho ga", "class 11 là Beef Pho (phở bò), không phải phở gà"),
]


def map_dish(name: str) -> tuple[int, str]:
    """
    Tên món tự do → (class_id, lý do). class_id = -1 nghĩa là KHÔNG nhận ra.

    Trả kèm lý do để cột `match` trong predictions.csv đọc được, và để khi
    tỉ lệ INVALID cao thì biết ngay là do bảng ánh xạ thiếu hay do model sai.
    """
    flat = _norm(name)
    if not flat:
        return -1, "tên rỗng"

    hits = [(a, cid, flat.index(a)) for a, cid in _FLAT if a in flat]

    # Luật loại trừ chỉ áp cho MÓN CHÍNH, không áp cho món ăn kèm.
    #
    # Đo thật: app trả "Bún thịt nướng kèm tôm và nem rán" — đúng là class 6,
    # nhưng bản đầu thấy chuỗi "nem ran" ở cuối câu là loại thẳng cả dòng. Tên
    # món chính đứng TRƯỚC, phần "kèm ..." đứng sau; nên chỉ loại khi cụm cấm
    # xuất hiện TRƯỚC mọi cụm khớp hợp lệ (hoặc không có cụm hợp lệ nào).
    first_ok = min((i for _, _, i in hits), default=len(flat) + 1)
    for bad, why in NEGATIVE:
        i = flat.find(bad)
        if i >= 0 and i <= first_ok:
            return -1, f"loại trừ: {why}"

    if not hits:
        return -1, "không khớp món nào trong 14 class"

    # Cụm dài nhất thắng (đã sắp sẵn). Nhưng nếu cụm dài nhất mơ hồ giữa 2 class
    # khác nhau thì thà báo không nhận ra còn hơn chọn bừa.
    best_len = len(hits[0][0])
    top = {cid for a, cid, _ in hits if len(a) == best_len}
    if len(top) > 1:
        return -1, "khớp nhiều class ngang nhau, không chọn bừa"
    return hits[0][1], f"khớp '{hits[0][0]}'"
