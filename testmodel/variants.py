"""
variants.py — các BIẾN THỂ cách gọi model, để A/B trên cùng một bộ ảnh.

Một variant = một cách gọi model (prompt + tham số decode + số lượt gọi).
Model không đổi, trọng số không đổi — đây vẫn là benchmark, không phải training.

Vì sao tách ra file riêng: muốn trả lời "chỉnh gì trong API thì nhận diện tốt
lên" thì phải đo được nhiều cách gọi trên CÙNG bộ ảnh, chứ đổi một chỗ rồi chạy
lại một lần thì không phân biệt được cải thiện thật với nhiễu.

Chạy:
    py testmodel/benchmark.py --variant base,gloss --models project
    py testmodel/benchmark.py --variant all --models project
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable


# ─────────────────────────────────────────────────────────────────────────────
# Chú giải nhãn
# ─────────────────────────────────────────────────────────────────────────────
# Tên tiếng Anh trong data.yaml đặt rất sát nhau, có cặp gần như trùng chữ. Đo
# thật trên 28 ảnh: 4/8 lỗi là model đảo qua đảo lại đúng một cặp
#
#     "Grilled Pork with Vermicelli"  <->  "Grilled Pork Vermicelli"
#
# Mở ảnh gốc ra xem thì hai class đó là hai món KHÁC HẲN nhau, và ánh xạ sang
# tiếng Anh thì NGƯỢC với trực giác:
#     class 4 "Grilled Pork with Vermicelli" = Bún chả
#     class 6 "Grilled Pork Vermicelli"      = Bún thịt nướng
# Model phân biệt đúng hai món rồi chọn nhầm chuỗi — đó là lỗi ĐẶT TÊN NHÃN,
# không phải lỗi nhìn. Không model nào đoán ra quy ước này nếu không được nói.
#
# ĐÃ XEM ẢNH GỐC để xác nhận: class 4, 5, 6, 8, 12. Các class còn lại tên đủ rõ
# nên suy từ tên (bánh cuốn, bánh giò, bánh mì, bún bò Huế, cháo lòng, cơm tấm,
# cơm rang, phở bò, xôi). Nếu sau này thêm class thì PHẢI xem ảnh trước khi viết
# chú giải — đoán theo tên đã sai một lần rồi: "Spring Rolls" ở bộ này là GỎI
# CUỐN tươi, không phải nem rán.
CLASS_GLOSS = {
    "Steamed Rice Rolls":
        "Bánh cuốn — lá bột gạo tráng MỎNG như tờ giấy, cuộn nhân thịt băm + mộc nhĩ, "
        "rắc hành phi, ăn với chén nước mắm loãng. Bánh MỀM ƯỚT, không chiên.",
    "Vietnamese pyramid rice dumpling":
        "Bánh giò — khối bột gạo hình CHÓP/KIM TỰ THÁP gói lá chuối, bóc ra thấy bột "
        "trắng ngà mềm nhuyễn, nhân thịt băm + mộc nhĩ ở giữa.",
    "Grilled Pork Banh Mi":
        "Bánh mì thịt nướng — Ổ BÁNH MÌ vỏ giòn rạch dọc, nhét thịt nướng + rau thơm "
        "+ đồ chua. Phải THẤY Ổ BÁNH MÌ mới chọn nhãn này.",
    "Hue-style Spicy Beef Noodle Soup":
        "Bún bò Huế — tô nước dùng ĐỎ CAY váng ớt sả, sợi bún TRÒN TO, có giò heo "
        "khoanh tròn và/hoặc chả cua, bắp bò.",
    "Grilled Pork with Vermicelli":
        "BÚN CHẢ (Hà Nội) — dấu hiệu THEN CHỐT: thịt nướng (chả miếng dẹt tròn và/hoặc "
        "ba chỉ cháy cạnh) NẰM NGÂM trong BÁT NƯỚC CHẤM loãng màu cam/nâu, thường có "
        "đu đủ/cà rốt thái lát nổi trong nước. Bún để RIÊNG ra đĩa/rổ, KHÔNG trộn chung "
        "với thịt. Đây KHÔNG phải 'Grilled Pork Vermicelli'.",
    "Vermicelli with Tofu":
        "Bún đậu mắm tôm — bày trên MẸT TRE lót lá: đậu phụ RÁN VÀNG cắt vuông, bún LÁ "
        "cắt miếng (khối bún trắng dẹt, KHÔNG phải bánh cuốn), thịt luộc/chả cốm, rau "
        "sống, và bát MẮM TÔM màu nâu tím sẫm.",
    "Grilled Pork Vermicelli":
        "BÚN THỊT NƯỚNG — dấu hiệu THEN CHỐT: bún và thịt nướng thái lát TRỘN CHUNG "
        "trong MỘT tô/đĩa, rắc ĐẬU PHỘNG RANG giã + đồ chua (cà rốt/củ cải sợi) + rau "
        "sống thái nhỏ; nước mắm để riêng một chén nhỏ, thịt KHÔNG ngâm trong nước. "
        "Đây KHÔNG phải 'Grilled Pork with Vermicelli'.",
    "Pork Offal Porridge":
        "Cháo lòng — bát CHÁO trắng sánh, bên trên có lòng/dồi/tim/gan heo thái lát, "
        "rắc hành lá + tiêu.",
    "Flattened green rice":
        "CỐM (cốm làng Vòng) — hạt lúa non DẸT màu XANH LÁ MẠ, thường GÓI TRONG LÁ SEN "
        "buộc bằng sợi rơm nếp. Là NGUYÊN LIỆU/quà, không phải món bày đĩa. Gói lá sen "
        "xanh KHÔNG phải 'Spring Rolls'.",
    "Broken Rice":
        "Cơm tấm — ĐĨA cơm hạt gãy nhỏ + sườn heo nướng miếng dẹt, thường kèm trứng ốp "
        "la, chả trứng miếng vuông, bì, đồ chua.",
    "Fried Rice":
        "Cơm rang/chiên — hạt cơm RỜI xào vàng bóng dầu, lẫn trứng/rau củ/thịt hạt lựu, "
        "đảo đều nên màu ĐỒNG NHẤT khắp đĩa.",
    "Beef Pho":
        "Phở bò — tô nước dùng TRONG, sợi bánh phở DẸT BẢN, thịt bò thái lát mỏng, "
        "hành lá + hành tây, rau thơm để riêng.",
    "Spring Rolls":
        "GỎI CUỐN (cuốn TƯƠI, KHÔNG chiên) — vỏ bánh tráng TRONG SUỐT nhìn thấy nhân "
        "bên trong (tôm hồng, bún, rau, thịt), chấm tương đậu phộng sệt rắc đậu phộng. "
        "Nếu vỏ VÀNG GIÒN do chiên thì KHÔNG phải nhãn này.",
    "Sticky Rice":
        "Xôi — hạt nếp NGUYÊN HẠT, bóng dẻo, DÍNH THÀNH KHỐI (không rời như cơm), có "
        "thể màu trắng/tím/vàng gấc/xanh lá dứa; hay gói lá chuối hoặc gói giấy báo.",
}


def _listing(classes: list[str], gloss: bool) -> str:
    if not gloss:
        return "\n".join(f"- {c}" for c in classes)
    out = []
    for c in classes:
        g = CLASS_GLOSS.get(c)
        out.append(f"- {c}\n    ({g})" if g else f"- {c}")
    return "\n".join(out)


# ─────────────────────────────────────────────────────────────────────────────
# Prompt
# ─────────────────────────────────────────────────────────────────────────────
def prompt_base(classes: list[str]) -> str:
    """Prompt đang dùng — giữ NGUYÊN VĂN làm mốc so sánh. Đừng sửa dòng nào."""
    return (
        "You are a food image classifier for Vietnamese street food.\n"
        "Look at the image and choose EXACTLY ONE label from this list:\n\n"
        f"{_listing(classes, gloss=False)}\n\n"
        "Rules:\n"
        "- Answer with the label copied EXACTLY as written above.\n"
        "- You must choose one of the labels, even if you are unsure.\n"
        "- Reply with ONLY a JSON object, no markdown, no explanation:\n"
        '{"label": "<one label from the list>"}'
    )


def prompt_gloss(classes: list[str]) -> str:
    """Y HỆT prompt_base, chỉ thêm chú giải cho từng nhãn.

    Cố ý không đổi gì khác (không thêm chain-of-thought, không đổi định dạng
    output) để nếu điểm có lên thì biết chắc là nhờ chú giải."""
    return (
        "You are a food image classifier for Vietnamese street food.\n"
        "Look at the image and choose EXACTLY ONE label from this list.\n"
        "The note in parentheses tells you what each label actually refers to —\n"
        "several English names look almost identical but are different dishes,\n"
        "so read the notes before deciding:\n\n"
        f"{_listing(classes, gloss=True)}\n\n"
        "Rules:\n"
        "- Answer with the label copied EXACTLY as written above.\n"
        "- You must choose one of the labels, even if you are unsure.\n"
        "- Reply with ONLY a JSON object, no markdown, no explanation:\n"
        '{"label": "<one label from the list>"}'
    )


def prompt_cascade_pass1(classes: list[str]) -> str:
    """Lượt 1 của cascade: xin thêm ứng viên #2 và độ chắc chắn để biết khi nào cần hỏi lại."""
    return (
        "You are a food image classifier for Vietnamese street food.\n"
        "Look at the image and choose EXACTLY ONE label from this list.\n"
        "The note in parentheses tells you what each label actually refers to —\n"
        "several English names look almost identical but are different dishes,\n"
        "so read the notes before deciding:\n\n"
        f"{_listing(classes, gloss=True)}\n\n"
        "Rules:\n"
        "- Copy labels EXACTLY as written above.\n"
        "- Also name the SECOND most likely label, and how sure you are.\n"
        "- Reply with ONLY a JSON object, no markdown, no explanation:\n"
        '{"label": "<best label>", "second_choice": "<runner-up label>", '
        '"confidence": "high|medium|low"}'
    )


def prompt_refine(classes: list[str], a: str, b: str) -> str:
    """Lượt 2: chỉ so HAI ứng viên, kèm đúng dấu hiệu phân biệt của từng bên.

    Bài toán 2 lựa chọn dễ hơn hẳn bài toán chọn 1 trong 14, và model được nhìn
    lại ảnh với câu hỏi hẹp thay vì phải nhớ cả danh sách."""
    ga = CLASS_GLOSS.get(a, "(không có chú giải)")
    gb = CLASS_GLOSS.get(b, "(không có chú giải)")
    return (
        "Look at this food image again. It is ONE of exactly these two dishes.\n"
        "Decide which one, using the distinguishing details below.\n\n"
        f"A. {a}\n    {ga}\n\n"
        f"B. {b}\n    {gb}\n\n"
        "Check the details one by one against what you actually see.\n"
        "Reply with ONLY a JSON object, no markdown, no explanation:\n"
        '{"label": "<copy either A\'s or B\'s label exactly>"}'
    )


# ─────────────────────────────────────────────────────────────────────────────
@dataclass
class Variant:
    name: str
    desc: str
    prompt: Callable[[list[str]], str] = prompt_base
    # Ghi đè tham số ở cấp payload (temperature, max_tokens, logprobs…)
    params: dict = field(default_factory=dict)
    # Ghi đè bên trong extra_body (mm_processor_kwargs…)
    extra_body: dict = field(default_factory=dict)
    # >1 = gọi nhiều lượt rồi bỏ phiếu theo đa số (self-consistency)
    samples: int = 1
    # True = chạy lượt 2 thu hẹp khi lượt 1 không chắc
    cascade: bool = False


# max_tokens phải rộng hơn cho cascade vì lượt 1 trả 3 trường chứ không phải 1.
VARIANTS: dict[str, Variant] = {
    "base": Variant(
        "base", "mốc so sánh — y hệt cách app đang gọi",
        prompt=prompt_base,
        # logprobs KHÔNG đổi kết quả (decode vẫn greedy), chỉ đính kèm xác suất
        # token để sau này phân tích xem 'độ chắc chắn thật' có dự đoán được lỗi
        # không. An toàn để bật trên chính mốc so sánh.
        params={"logprobs": True, "top_logprobs": 5},
    ),
    "gloss": Variant(
        "gloss", "thêm chú giải tên Việt + dấu hiệu phân biệt cho từng nhãn",
        prompt=prompt_gloss,
        params={"logprobs": True, "top_logprobs": 5},
    ),
    "hires": Variant(
        "hires", "ép upscale ảnh (min_pixels 1.0MP) — xem thêm điểm ảnh có giúp không",
        prompt=prompt_base,
        extra_body={"mm_processor_kwargs": {"min_pixels": 1_000_000, "max_pixels": 3_211_264}},
    ),
    "gloss_hires": Variant(
        "gloss_hires", "gloss + upscale — xem hai cải tiến có cộng dồn không",
        prompt=prompt_gloss,
        extra_body={"mm_processor_kwargs": {"min_pixels": 1_000_000, "max_pixels": 3_211_264}},
    ),
    "vote3": Variant(
        "vote3", "3 lượt temp 0.8 rồi bỏ phiếu — đo TRẦN TRÊN của self-consistency",
        prompt=prompt_gloss,
        params={"temperature": 0.8, "top_p": 0.95, "seed": None},
        samples=3,
    ),
    "cascade": Variant(
        "cascade", "1 lượt; không chắc thì hỏi lại lượt 2 chỉ giữa 2 ứng viên",
        prompt=prompt_cascade_pass1,
        params={"max_tokens": 160},
        cascade=True,
    ),
}

# Thứ tự chạy khi --variant all. base đứng đầu để có mốc ngay.
ALL_ORDER = ["base", "gloss", "hires", "gloss_hires", "cascade", "vote3"]
