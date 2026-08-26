"""
test_dish_map.py — kiểm bảng ánh xạ tên món → class id.

Chạy:  py testmodel/test_dish_map.py

Vì sao đáng có test riêng: bảng ánh xạ hỏng sẽ KHÔNG báo lỗi, nó chỉ âm thầm
đẩy điểm task `app` xuống rồi mình đi đổ lỗi cho model. Các ca "phải trả -1"
quan trọng ngang các ca khớp đúng — chấm điểm rộng tay là tự thổi phồng kết quả.
"""
import sys
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dish_map import map_dish  # noqa: E402

CASES = [
    # (tên model trả về, class_id mong đợi, vì sao)
    ("Bún chả", 4, "bún chả Hà Nội"),
    ("Bún chả Hà Nội", 4, "có hậu tố vùng miền"),
    ("Bún thịt nướng", 6, "khác hẳn bún chả"),
    ("Bún thịt nướng Nam Bộ", 6, "có hậu tố vùng miền"),
    ("Bún đậu mắm tôm", 5, ""),
    ("Bún bò Huế", 3, "'bun bo hue' phải thắng 'bun bo'"),
    ("Phở bò", 11, ""),
    ("Phở bò tái nạm", 11, ""),
    ("Cơm tấm sườn bì chả", 9, "'com tam' phải thắng, không lẫn sang cơm rang"),
    ("Cơm rang dưa bò", 10, ""),
    ("Cơm chiên hải sản", 10, "cơm chiên = cơm rang"),
    ("Bánh cuốn nóng", 0, ""),
    ("Bánh giò", 1, ""),
    ("Bánh mì thịt nướng", 2, "'banh mi' phải thắng 'thit nuong'"),
    ("Cháo lòng", 7, ""),
    ("Gỏi cuốn tôm thịt", 12, "Spring Rolls ở bộ này là cuốn TƯƠI"),
    ("Xôi gấc", 13, ""),
    ("Cốm làng Vòng", 8, "cốm, không phải cơm"),

    # ── Phải trả -1: thà nhận 'không biết' còn hơn đoán bừa ──────────────────
    ("Nem rán", -1, "món CHIÊN, class 12 là gỏi cuốn tươi"),
    ("Chả giò", -1, "món CHIÊN"),
    ("Phở gà", -1, "class 11 là Beef Pho — phở BÒ"),
    ("Bún", -1, "mơ hồ giữa 4 món bún trong bộ"),
    ("Mì Quảng", -1, "không nằm trong 14 class"),
    ("Pizza", -1, "không nằm trong 14 class"),
    ("", -1, "tên rỗng"),

    # ── Luật loại trừ chỉ áp cho MÓN CHÍNH, không cho món ăn kèm ─────────────
    # Đo thật: app trả câu này cho một ảnh class 6, bản đầu loại nhầm vì thấy
    # chuỗi "nem rán" ở cuối câu.
    ("Bún thịt nướng kèm tôm và nem rán", 6, "món chính đứng trước, 'nem rán' là món kèm"),
    ("Gỏi cuốn và nem rán", 12, "gỏi cuốn là món chính"),
    ("Phở bò và phở gà", 11, "phở bò đứng trước"),
    ("Nem rán ăn kèm bún", -1, "'nem rán' ĐỨNG ĐẦU = món chính, vẫn phải loại"),
]


def main() -> int:
    bad = 0
    for name, want, why in CASES:
        got, reason = map_dish(name)
        ok = got == want
        bad += 0 if ok else 1
        print(f"{'ok ' if ok else 'SAI'} {name!r:26} → {got:>3} (mong {want:>3})  {reason}"
              + (f"   [{why}]" if why else ""))
    print(f"\n{len(CASES) - bad}/{len(CASES)} đúng")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
