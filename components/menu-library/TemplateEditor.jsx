'use client';
/**
 * TemplateEditor — sửa thông tin một thực đơn trong thư viện (Ảnh 3).
 *
 * Chỉ mở được khi API đã trả `can_edit` cho thực đơn đó; BE vẫn kiểm tra lại
 * bằng requireTemplateEditAccess nên ẩn nút không phải là hàng rào duy nhất.
 *
 * Gửi multipart khi có ảnh mới, JSON khi không — để lần sửa chữ không phải
 * gánh theo payload ảnh.
 */
import { useEffect, useRef, useState } from 'react';
import { MENU_CATEGORIES, getCategory } from '../../lib/family-menu/menu-categories';

const MAX_MB = 5;
const ACCEPT = 'image/jpeg,image/png,image/webp';

const listToText = (v) => (Array.isArray(v) ? v.join(', ') : (v || ''));

export default function TemplateEditor({ template, isAdmin, onCancel, onSave, onDelete, t, tn }) {
  const [form, setForm] = useState(() => ({
    title: template.title || '',
    description: template.description || '',
    category: template.category || getCategory(template.category).id,
    tags: listToText(template.tags),
    disease_target: listToText(template.disease_target),
    visibility: template.visibility === 'private' ? 'private' : 'public',
    is_system: !!template.is_system,
  }));
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(template.image_url || null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const fileRef = useRef(null);

  // Ảnh chọn tạm sống bằng blob URL — không thu hồi thì rò rỉ mỗi lần đổi ảnh.
  useEffect(() => {
    if (!file) return undefined;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  function pickFile(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) {
      setErr(tn('ml.e_img_size', { n: MAX_MB }, `Ảnh tối đa ${MAX_MB} MB.`));
      e.target.value = '';
      return;
    }
    setErr(null);
    setFile(f);
  }

  function clearImage() {
    setFile(null);
    setPreview(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function submit(e) {
    e.preventDefault();
    if (!form.title.trim()) { setErr(t('ml.e_title', 'Tiêu đề không được để trống.')); return; }
    setBusy(true);
    setErr(null);
    try {
      // Ảnh đã bị gỡ (không file mới, không preview) ⇒ gửi image_url rỗng để
      // BE xoá cột, khác hẳn với "không đụng tới ảnh" (không gửi trường nào).
      const removedImage = !file && !preview && !!template.image_url;
      await onSave({ ...form, ...(removedImage ? { image_url: '' } : {}) }, file);
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  const cat = getCategory(form.category);

  return (
    <div className="mp-modal-overlay open" onClick={onCancel}>
      <form className="mp-modal ml-editor" onClick={(ev) => ev.stopPropagation()} onSubmit={submit}>
        <div className="mp-modal-header">
          <h3>{t('ml.edit_title', 'Sửa thực đơn')}</h3>
          <button type="button" className="mp-modal-close" onClick={onCancel} aria-label={t('common.close', 'Đóng')}>
            <i className="fa-solid fa-xmark" />
          </button>
        </div>

        <div className="mp-modal-body">
          {err && <p className="ml-editor-err"><i className="fa-solid fa-circle-exclamation" /> {err}</p>}

          <div
            className="ml-editor-cover"
            style={{ '--ml-grad': `linear-gradient(135deg, ${cat.from}, ${cat.to})` }}
          >
            {preview
              ? <img src={preview} alt="" />
              : <i className={`fa-solid ${cat.icon}`} aria-hidden="true" />}
          </div>

          <div className="ml-editor-imgrow">
            <label className="btn btn-secondary">
              <i className="fa-solid fa-image" /> {t('ml.change_image', 'Chọn ảnh bìa')}
              <input ref={fileRef} type="file" accept={ACCEPT} onChange={pickFile} hidden />
            </label>
            {preview && (
              <button type="button" className="btn btn-secondary" onClick={clearImage}>
                <i className="fa-solid fa-trash-can" /> {t('ml.remove_image', 'Gỡ ảnh')}
              </button>
            )}
            <small>{tn('ml.image_hint', { n: MAX_MB }, `JPEG/PNG/WebP, tối đa ${MAX_MB} MB. Bỏ trống thì dùng bìa theo danh mục.`)}</small>
          </div>

          <label className="ml-editor-field">
            {t('ml.f_name', 'Tên menu')}
            <input type="text" value={form.title} onChange={set('title')} maxLength={200} required />
          </label>

          <label className="ml-editor-field">
            {t('ml.f_desc', 'Mô tả ngắn')}
            <textarea
              rows={2}
              value={form.description}
              onChange={set('description')}
              maxLength={300}
              placeholder={t('ml.f_desc_ph', 'Thực đơn 7 ngày ít tinh bột, hợp người tiểu đường tuýp 2')}
            />
          </label>

          <label className="ml-editor-field">
            {t('ml.f_category', 'Danh mục')}
            <select value={form.category} onChange={set('category')}>
              {MENU_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <label className="ml-editor-field">
            {t('ml.f_tags', 'Nhãn (phân cách bằng dấu phẩy)')}
            <input type="text" value={form.tags} onChange={set('tags')} placeholder="goal:lose, region:mien-nam" />
          </label>

          <label className="ml-editor-field">
            {t('ml.f_disease', 'Bệnh lý hướng đến')}
            <input type="text" value={form.disease_target} onChange={set('disease_target')} placeholder={t('ml.f_disease_ph', 'tiểu đường, gout...')} />
          </label>

          <label className="ml-editor-field">
            {t('ml.f_scope', 'Phạm vi')}
            <select value={form.visibility} onChange={set('visibility')}>
              <option value="public">{t('ml.scope_public', 'Công khai (mặc định)')}</option>
              <option value="private">{t('ml.scope_private', 'Chỉ gia đình tôi')}</option>
            </select>
          </label>

          {isAdmin && (
            <label className="ml-editor-check">
              <input
                type="checkbox"
                checked={form.is_system}
                onChange={(e) => setForm((f) => ({ ...f, is_system: e.target.checked }))}
              />
              <span>
                {t('ml.f_system', 'Thực đơn hệ thống')}
                <small>{t('ml.f_system_hint', 'Người dùng thường chỉ xem và áp dụng, không sửa được.')}</small>
              </span>
            </label>
          )}
        </div>

        <div className="ml-editor-foot">
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={busy}>
            <i className="fa-solid fa-trash-can" /> {t('ml.delete', 'Xoá thực đơn')}
          </button>
          <div className="ml-editor-foot-right">
            <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
              {t('common.cancel', 'Hủy')}
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? t('common.saving', 'Đang lưu...') : t('common.save', 'Lưu thay đổi')}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
