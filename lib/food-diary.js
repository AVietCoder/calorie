// lib/food-diary.js — D: "Nhật ký ảnh món ăn" trên bảng chat_images.
// Mỗi ảnh người dùng phân tích (Chat hoặc "Thêm món ngoài thực đơn") được lưu
// lên Cloudinary + 1 dòng chat_images kèm analysis (tên món + dinh dưỡng).
// Toàn bộ là FIRE-AND-FORGET: lỗi/không cấu hình Cloudinary KHÔNG chặn phân tích.
// Ghi/đọc chat_images từ SERVER. Bảng bật RLS (migrations/admin.sql) và client
// anon không mang JWT người dùng (auth.uid()=NULL) → INSERT/SELECT đều bị chặn.
// Dùng service-role để bypass RLS; SELECT vẫn tự lọc theo user_id nên an toàn.
import { supabaseAdmin as supabase } from "./supabase.js";
import { uploadImage, cloudinaryConfigured } from "./cloudinary.js";

const num = (v) => {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** Lưu 1 ảnh đã phân tích vào nhật ký. Không await ở caller (fire-and-forget).
 *  @param {{ userId, buffer, analysis, conversationRef? }} p
 *    analysis: object dinh dưỡng (food/description, calories, protein, fat, carbs, confidence, source) */
export async function saveFoodPhoto({ userId, buffer, analysis = {}, conversationRef = null }) {
  try {
    if (!userId || !buffer || !cloudinaryConfigured()) return;
    const up = await uploadImage(buffer, "food.jpg");
    if (!up || !up.url) return;
    const compact = {
      food: String(analysis.food || analysis.description || "Món ăn").slice(0, 120),
      calories: num(analysis.calories),
      protein: analysis.protein != null ? String(analysis.protein) : null,
      fat: analysis.fat != null ? String(analysis.fat) : null,
      carbs: analysis.carbs != null ? String(analysis.carbs) : null,
      confidence: analysis.confidence || null,
      source: analysis.source || null,
    };
    await supabase.from("chat_images").insert({
      user_id: userId,
      cloudinary_public_id: up.public_id || null,
      cloudinary_url: up.url,
      width: up.width || null,
      height: up.height || null,
      bytes: up.bytes || null,
      format: up.format || "jpg",
      conversation_ref: conversationRef,
      analysis: compact,
    });
  } catch (err) {
    console.warn("[food-diary] saveFoodPhoto lỗi (bỏ qua):", err.message);
  }
}

/** Đọc nhật ký ảnh của user (mới nhất trước). Trả [] nếu bảng/dữ liệu trống. */
export async function getFoodPhotos(userId, limit = 60) {
  try {
    const { data, error } = await supabase
      .from("chat_images")
      .select("id, cloudinary_url, width, height, analysis, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(Number(limit) || 60, 1), 200));
    if (error || !Array.isArray(data)) return [];
    // Chỉ trả ảnh CÓ phân tích (bỏ ảnh rác/không nhận diện được món)
    return data.filter((r) => r.analysis && r.analysis.food);
  } catch {
    return [];
  }
}
