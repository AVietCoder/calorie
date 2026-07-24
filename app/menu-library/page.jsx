'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useApi } from '../../lib-client/useApi';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/menu-library.css';

export default function MenuLibraryPage() {
  const [household, setHousehold] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ranked, setRanked] = useState([]);
  const [selectedTag, setSelectedTag] = useState(null);
  const [form, setForm] = useState({ title: '', tags: '', disease: '', visibility: 'public' });

  const fileInputRef = useRef(null);
  const { get, post, postForm } = useApi();
  const showToast = useToast();
  const { t } = useTranslation();
  const router = useRouter();

  async function loadTemplates(tag) {
    const data = await get('/api/family-menu', { resource: 'templates', ...(tag ? { tag } : {}) });
    setRanked(Array.isArray(data) ? data : []);
  }

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }
    (async () => {
      try {
        const data = await get('/api/family-menu', { resource: 'household' });
        const h = data?.household || null;
        setHousehold(h);
        if (h) await loadTemplates(null);
      } catch (e) {
        showToast(e.message, 'error');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSelectTag(tag) {
    setSelectedTag(tag);
    try { await loadTemplates(tag); } catch (e) { showToast(e.message, 'error'); }
  }

  async function generatePlanFromTemplate(templateId) {
    try {
      const plan = await post('/api/family-menu', { action: 'generate_plan', household_id: household.id, template_id: templateId });
      showToast(t('ml.toast_generated', 'Đã tạo thực đơn cho gia đình!'), 'success');
      router.push(`/menu-plan?household_id=${household.id}&plan_id=${plan.id}`);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  // Tạo & tải file Excel MẪU đúng cấu trúc cột để người dùng điền theo. Dùng
  // dynamic import 'xlsx' (chỉ nạp khi bấm → không phình bundle) + tải bằng Blob
  // (an toàn trên trình duyệt, không phụ thuộc fs).
  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const headers = [
      'day_index', 'meal_type', 'dish_name', 'base_grams', 'calories', 'protein', 'fat',
      'carbs', 'fiber', 'sugar', 'sodium', 'dish_tags', 'ingredient_name',
      'ingredient_grams', 'ingredient_unit', 'ingredient_tags',
    ];
    // Vài dòng mẫu: 2 nguyên liệu cho 1 món (lặp thông tin món) + các bữa khác.
    const rows = [
      { day_index: 1, meal_type: 'breakfast', dish_name: 'Phở gà', base_grams: 400, calories: 450, protein: 28, fat: 12, carbs: 58, fiber: 2, sugar: 4, sodium: 920, dish_tags: 'gà,healthy', ingredient_name: 'Bánh phở', ingredient_grams: 180, ingredient_unit: 'g', ingredient_tags: 'tinh bột' },
      { day_index: 1, meal_type: 'breakfast', dish_name: 'Phở gà', base_grams: 400, calories: 450, protein: 28, fat: 12, carbs: 58, fiber: 2, sugar: 4, sodium: 920, dish_tags: 'gà,healthy', ingredient_name: 'Thịt gà', ingredient_grams: 100, ingredient_unit: 'g', ingredient_tags: 'đạm' },
      { day_index: 1, meal_type: 'lunch', dish_name: 'Cơm tấm sườn bì chả', base_grams: 500, calories: 620, protein: 34, fat: 22, carbs: 68, fiber: 3, sugar: 5, sodium: 1100, dish_tags: '', ingredient_name: 'Cơm tấm', ingredient_grams: 250, ingredient_unit: 'g', ingredient_tags: 'tinh bột' },
      { day_index: 1, meal_type: 'dinner', dish_name: 'Canh chua cá + cơm', base_grams: 450, calories: 480, protein: 30, fat: 10, carbs: 60, fiber: 4, sugar: 6, sodium: 900, dish_tags: '', ingredient_name: '', ingredient_grams: '', ingredient_unit: '', ingredient_tags: '' },
      { day_index: 1, meal_type: 'snack', dish_name: 'Sữa chua Hy Lạp + trái cây', base_grams: 150, calories: 150, protein: 10, fat: 3, carbs: 18, fiber: 1, sugar: 12, sodium: 50, dish_tags: 'snack', ingredient_name: '', ingredient_grams: '', ingredient_unit: '', ingredient_tags: '' },
    ];
    const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(11, h.length + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Menu');
    const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'calorie-ai-menu-template.xlsx';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(t('ml.template_downloaded', 'Đã tải file mẫu — điền theo mẫu rồi tải lên nhé!'), 'success');
  }

  async function uploadTemplate() {
    const file = fileInputRef.current?.files?.[0];
    if (!file) { showToast(t('ml.toast_pick_excel', 'Chọn file Excel trước.'), 'error'); return; }
    const fd = new FormData();
    fd.append('action', 'upload_template_excel');
    fd.append('title', form.title.trim());
    fd.append('tags', form.tags.trim());
    fd.append('disease_target', form.disease.trim());
    fd.append('visibility', form.visibility);
    if (household) fd.append('household_id', household.id);
    fd.append('file', file);

    try {
      await postForm('/api/family-menu', fd);
      showToast(t('ml.toast_added', 'Đã thêm menu vào thư viện!'), 'success');
      if (fileInputRef.current) fileInputRef.current.value = '';
      setForm((f) => ({ ...f, title: '' }));
      await loadTemplates(selectedTag);
    } catch (e) {
      showToast(e.message, 'error');
    }
  }

  const tags = new Set();
  for (const r of ranked) for (const tg of r.template.tags || []) tags.add(tg);

  if (loading) {
    return (
      <PageShell>
        <div className="loading-overlay" style={{ position: 'fixed' }}>
          <div className="typing-indicator"><div className="typing-dot" /><div className="typing-dot" /><div className="typing-dot" /></div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <div className="schedule-hero">
        <div className="schedule-hero-text">
          <div className="schedule-hero-icon"><i className="fa-solid fa-book-open" /></div>
          <div>
            <h1>{t('ml.title', 'Thư viện thực đơn chuẩn')}</h1>
            <p>{t('ml.subtitle', 'AI chọn thực đơn phù hợp nhất với gia đình bạn từ thư viện có sẵn — không tự bịa món')}</p>
          </div>
        </div>
      </div>

      {!household ? (
        <div className="card">
          <p>{t('fm.need_household', 'Bạn cần tạo hồ sơ gia đình trước.')} <Link href="/household">{t('fm.create_now', 'Tạo ngay →')}</Link></p>
        </div>
      ) : (
        <div>
          <div className="tag-filter">
            <span className={`tag-chip${!selectedTag ? ' selected' : ''}`} onClick={() => onSelectTag(null)}>{t('ml.all', 'Tất cả')}</span>
            {[...tags].map((tg) => (
              <span key={tg} className={`tag-chip${selectedTag === tg ? ' selected' : ''}`} onClick={() => onSelectTag(tg)}>{tg}</span>
            ))}
          </div>

          <div className="template-grid">
            {ranked.length === 0 ? (
              <p style={{ color: 'var(--text-sub)' }}>{t('ml.empty', 'Chưa có thực đơn phù hợp trong thư viện — hãy tải lên một menu mới ở dưới.')}</p>
            ) : (
              ranked.map((r) => (
                <div className="template-card" key={r.template.id}>
                  <span className="tpl-score">{t('ml.score', 'Độ phù hợp')}: {r.score}</span>
                  <h4>{r.template.title}</h4>
                  <div className="tpl-tags">{(r.template.tags || []).map((tg, i) => <span className="tpl-tag" key={i}>{tg}</span>)}</div>
                  <ActionButton className="btn btn-primary" onClick={() => generatePlanFromTemplate(r.template.id)} loadingText={t('common.creating', 'Đang tạo...')}>
                    <i className="fa-solid fa-wand-magic-sparkles" /> {t('ml.generate', 'Tạo thực đơn cho gia đình')}
                  </ActionButton>
                </div>
              ))
            )}
          </div>

          <div className="section-title">
            <h2>{t('ml.add_title', 'Tự thêm menu vào thư viện')}</h2>
            <p>{t('ml.add_sub', 'Tải lên Excel hoặc nhập tay — mặc định công khai cho mọi người dùng')}</p>
          </div>
          <div className="card">
            <div className="upload-row">
              <label>{t('ml.f_name', 'Tên menu')} <input type="text" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder={t('ml.f_name_ph', 'Menu giảm cân 7 ngày')} /></label>
              <label>{t('ml.f_tags', 'Nhãn (phân cách bằng dấu phẩy)')} <input type="text" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} placeholder="goal:lose, region:mien-nam" /></label>
              <label>{t('ml.f_disease', 'Bệnh lý hướng đến')} <input type="text" value={form.disease} onChange={(e) => setForm((f) => ({ ...f, disease: e.target.value }))} placeholder={t('ml.f_disease_ph', 'tiểu đường, gout...')} /></label>
              <label>{t('ml.f_scope', 'Phạm vi')}
                <select value={form.visibility} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.value }))}>
                  <option value="public">{t('ml.scope_public', 'Công khai (mặc định)')}</option>
                  <option value="private">{t('ml.scope_private', 'Chỉ gia đình tôi')}</option>
                </select>
              </label>
            </div>
            <div className="upload-row">
              <label>{t('ml.f_excel', 'File Excel (.xlsx)')} <input ref={fileInputRef} type="file" accept=".xlsx,.xls" /></label>
              <div style={{ display: 'flex', gap: 10, alignSelf: 'flex-end', flexWrap: 'wrap' }}>
                <ActionButton className="btn btn-secondary" onClick={downloadTemplate}><i className="fa-solid fa-file-arrow-down" /> {t('ml.download_template', 'Tải file mẫu (.xlsx)')}</ActionButton>
                <ActionButton className="btn btn-primary" onClick={uploadTemplate} loadingText={t('common.uploading', 'Đang tải lên...')}><i className="fa-solid fa-upload" /> {t('ml.upload_btn', 'Tải lên')}</ActionButton>
              </div>
            </div>
            <p style={{ color: 'var(--text-sub)', fontSize: 13, marginTop: 8 }}>
              {t('ml.excel_cols', 'Cột Excel')}: day_index, meal_type, dish_name, base_grams, calories, protein, fat, carbs, fiber, sugar, sodium, dish_tags, ingredient_name, ingredient_grams, ingredient_unit, ingredient_tags
            </p>
          </div>
        </div>
      )}
    </PageShell>
  );
}
