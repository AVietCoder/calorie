/**
 * account-deletion.js — xoá tài khoản vĩnh viễn (chính sách Google Play).
 *
 * Thứ tự có chủ đích, không đảo được:
 *
 *   1. Kiểm tra service role TRƯỚC khi đụng vào bất cứ thứ gì. Thiếu key thì
 *      không xoá nổi dòng auth.users, mà lỡ xoá dữ liệu rồi mới phát hiện thì
 *      để lại tài khoản nửa vời.
 *   2. Đọc public_id của ảnh Cloudinary — phải lấy TRƯỚC khi xoá dòng DB, xoá
 *      xong là mất đường tra file.
 *   3. Gọi hàm SQL delete_user_account: toàn bộ dữ liệu ứng dụng, MỘT transaction.
 *   4. Xoá file Cloudinary. Nằm ngoài transaction vì là hệ thống khác — và
 *      rollback cũng không lấy lại được file đã xoá.
 *   5. Xoá dòng auth.users bằng Admin API.
 *
 * Bước 3 trước bước 5 là cố ý: nếu bước 5 hỏng, người dùng vẫn đăng nhập được
 * vào một tài khoản rỗng và bấm xoá lại. Làm ngược lại thì họ mất quyền đăng
 * nhập trong khi dữ liệu cá nhân vẫn còn nguyên và không ai xoá hộ được.
 */
import { supabaseAdmin, hasServiceRole } from './supabase.js';
import { destroyAsset, cloudinaryCanDelete } from './cloudinary.js';

/** Đang xoá dở cho user nào — chặn double-submit trong cùng một tiến trình. */
const inFlight = new Set();

export class AccountDeletionError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @param {string} userId  id của CHÍNH người gọi (route đã xác thực)
 * @returns {Promise<{stats: object, images: {found:number, destroyed:number}}>}
 */
export async function deleteUserAccount(userId) {
  if (!userId) throw new AccountDeletionError(400, 'Thiếu userId.');

  // Thiếu service role thì Admin API không chạy được ⇒ dừng ngay, đừng xoá nửa vời.
  if (!hasServiceRole) {
    throw new AccountDeletionError(
      503,
      'Máy chủ chưa cấu hình SUPABASE_SERVICE_ROLE_KEY nên chưa xoá tài khoản được.'
    );
  }

  if (inFlight.has(userId)) {
    throw new AccountDeletionError(409, 'Yêu cầu xoá tài khoản đang được xử lý.');
  }
  inFlight.add(userId);

  try {
    // ── 2. Danh sách file trên Cloudinary, lấy trước khi mất dòng DB ──────
    const { data: images, error: imgErr } = await supabaseAdmin
      .from('chat_images')
      .select('cloudinary_public_id')
      .eq('user_id', userId);
    if (imgErr) throw imgErr;

    const publicIds = (images || []).map((r) => r.cloudinary_public_id).filter(Boolean);

    // ── 3. Toàn bộ dữ liệu ứng dụng, một transaction ──────────────────────
    const { data: stats, error: rpcErr } = await supabaseAdmin.rpc('delete_user_account', {
      p_user_id: userId,
    });
    if (rpcErr) {
      // Hàm chưa được tạo là lỗi VẬN HÀNH, không phải lỗi người dùng — nói rõ
      // thay vì để nó rơi xuống thành "500 không rõ nguyên nhân".
      if (/could not find the function|does not exist/i.test(rpcErr.message || '')) {
        throw new AccountDeletionError(
          503,
          'Máy chủ chưa chạy migrations/account_deletion.sql nên chưa xoá tài khoản được.'
        );
      }
      throw rpcErr;
    }

    // ── 4. File ảnh (best-effort, ngoài transaction) ──────────────────────
    let destroyed = 0;
    if (publicIds.length && cloudinaryCanDelete()) {
      const results = await Promise.allSettled(
        publicIds.map((id) => destroyAsset(id, 'image'))
      );
      destroyed = results.filter((r) => r.status === 'fulfilled' && r.value).length;
      if (destroyed < publicIds.length) {
        // Không làm hỏng cả thao tác vì chuyện này: dòng DB đã sạch, ảnh còn sót
        // trên Cloudinary sẽ hết hạn theo vòng đời backup (nêu ở /delete-account).
        console.warn(
          `⚠️ [account-deletion] ${publicIds.length - destroyed}/${publicIds.length} ảnh chưa xoá được khỏi Cloudinary (user ${userId}).`
        );
      }
    }

    // ── 5. Dòng auth.users ────────────────────────────────────────────────
    const { error: authErr } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (authErr) {
      console.error(
        `❌ [account-deletion] Đã xoá dữ liệu nhưng KHÔNG xoá được auth.users cho ${userId}: ${authErr.message}`
      );
      throw new AccountDeletionError(
        500,
        'Đã xoá dữ liệu nhưng chưa xoá được tài khoản đăng nhập. Vui lòng thử lại.'
      );
    }

    console.log(
      `🗑️ [account-deletion] user=${userId} ${JSON.stringify(stats)} ảnh=${destroyed}/${publicIds.length}`
    );

    return { stats: stats || {}, images: { found: publicIds.length, destroyed } };
  } finally {
    inFlight.delete(userId);
  }
}

export default { deleteUserAccount, AccountDeletionError };
