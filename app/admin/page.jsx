'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import ActionButton from '../../components/ActionButton';
import { useToast } from '../../lib-client/ToastContext';
import { useTranslation } from '../../lib-client/I18nContext';
import '../../styles/admin.css';

const API = '/api/admin';

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
// status -> [Vietnamese fallback label, css class]
const STATUS_MAP = {
  ready: ['Đã tải', 'badge'],
  error: ['Lỗi', 'badge bad'],
  uploaded: ['Đã nhận', 'badge gray'],
  extracting: ['Trích text…', 'badge gray'],
  chunking: ['Chia đoạn…', 'badge gray'],
  saving: ['Đang lưu…', 'badge gray'],
};
const STATUS_KEY = {
  ready: 'adm.st_ready', error: 'adm.st_error', uploaded: 'adm.st_uploaded',
  extracting: 'adm.st_extracting', chunking: 'adm.st_chunking', saving: 'adm.st_saving',
};
function truncateName(name, maxLen = 42) {
  if (name.length <= maxLen) return name;
  const dotIdx = name.lastIndexOf('.');
  const ext = dotIdx !== -1 ? name.slice(dotIdx) : '';
  return name.slice(0, maxLen - ext.length - 3) + '...' + ext;
}

export default function AdminPage() {
  const [phase, setPhase] = useState('loading'); // loading | denied | ready
  const [deniedMsg, setDeniedMsg] = useState('');
  const [statusData, setStatusData] = useState(null);
  const [pdfs, setPdfs] = useState(null); // null = loading
  const [pdfsError, setPdfsError] = useState(null);
  const [files, setFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);

  const fileInputRef = useRef(null);
  const showToast = useToast();
  const { t, tn } = useTranslation();
  const router = useRouter();

  function statusBadge(s) {
    const [label, cls] = STATUS_MAP[s] || [s || '—', 'badge gray'];
    const text = STATUS_KEY[s] ? t(STATUS_KEY[s], label) : label;
    return <span className={cls}>{text}</span>;
  }

  function authHeaders(token, extra = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  async function loadPdfs(token) {
    setPdfs(null);
    setPdfsError(null);
    try {
      const res = await fetch(`${API}?action=list`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('adm.err_list', 'Không tải được danh sách'));
      setStatusData(data);
      setPdfs(data.pdfs || []);
    } catch (err) {
      setPdfsError(err.message);
      setPdfs([]);
    }
  }

  useEffect(() => {
    const token = window.localStorage.getItem('calorie_ai_token');
    if (!token) { router.push('/signin'); return; }

    (async () => {
      try {
        const res = await fetch(`${API}?action=whoami`, { headers: authHeaders(token) });
        if (res.status === 401) { router.push('/signin'); return; }
        const data = await res.json();
        if (!data.isAdmin) {
          setDeniedMsg(tn('adm.denied_msg', { email: data.email || '' }, `Tài khoản ${data.email || ''} chưa có quyền quản trị. Liên hệ quản trị viên để được cấp quyền.`));
          setPhase('denied');
          return;
        }
        setStatusData(data);
        setPhase('ready');
        await loadPdfs(token);
      } catch (err) {
        showToast(t('adm.err_conn', 'Lỗi kết nối') + ': ' + err.message, 'error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onFilesChosen(fileList) {
    setFiles(Array.from(fileList || []));
  }

  function onDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer?.files?.length) onFilesChosen(e.dataTransfer.files);
  }

  async function doUpload() {
    if (!files.length) { showToast(t('adm.toast_pick', 'Hãy chọn một hoặc nhiều tệp PDF trước.'), 'error'); return; }
    const invalid = files.filter((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf');
    if (invalid.length) { showToast(tn('adm.toast_notpdf', { name: invalid[0].name }, `File "${invalid[0].name}" không phải PDF.`), 'error'); return; }

    const token = window.localStorage.getItem('calorie_ai_token');
    setUploading(true);
    let successCount = 0, failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgressMsg(tn('adm.progress', { i: i + 1, n: files.length, name: file.name }, `Đang xử lý file ${i + 1}/${files.length}: "${file.name}"…`));
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}?action=upload`, { method: 'POST', headers: authHeaders(token), body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || t('adm.err_upload', 'Tải lên thất bại'));
        const d = data.document || {};
        showToast(tn('adm.toast_uploaded', { name: d.file_name, chunks: d.chunk_count }, `✓ "${d.file_name}": ${d.chunk_count} đoạn (đã lập chỉ mục Full Text Search).`), 'success');
        if (data.warning) showToast(data.warning, 'error');
        successCount++;
      } catch (err) {
        showToast(`✗ "${file.name}": ${err.message}`, 'error');
        failCount++;
      }
    }

    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (files.length > 1) showToast(tn('adm.toast_done', { s: successCount, f: failCount }, `Hoàn tất: ${successCount} thành công, ${failCount} thất bại.`), successCount ? 'success' : 'error');

    setUploading(false);
    await loadPdfs(token);
  }

  async function deletePdf(id) {
    if (!window.confirm(t('adm.confirm_delete', 'Xóa tài liệu này? Các đoạn văn bản và file trên Cloudinary sẽ bị xóa.'))) return;
    const token = window.localStorage.getItem('calorie_ai_token');
    try {
      const res = await fetch(`${API}?action=delete&id=${encodeURIComponent(id)}`, { method: 'POST', headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || t('adm.err_delete', 'Xóa thất bại'));
      showToast(t('adm.toast_deleted', 'Đã xóa tài liệu.'), 'success');
      await loadPdfs(token);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (phase === 'loading') {
    return (
      <PageShell variant="admin">
        <div className="admin-page-loader" style={{ position: 'relative' }}>
          <div className="admin-loader-inner">
            <div className="admin-loader-spinner" />
            <p>{t('adm.checking_access', 'Đang kiểm tra quyền truy cập…')}</p>
          </div>
        </div>
      </PageShell>
    );
  }

  if (phase === 'denied') {
    return (
      <PageShell variant="admin">
        <div className="admin-denied">
          <i className="fa-solid fa-lock" />
          <h2>{t('adm.denied_title', 'Khu vực quản trị')}</h2>
          <p>{deniedMsg}</p>
          <a className="btn-ghost" href="/guide"><i className="fa-solid fa-arrow-left" /> {t('adm.back_to_guide', 'Về trang hướng dẫn')}</a>
        </div>
      </PageShell>
    );
  }

  const store = statusData?.store || {};

  return (
    <PageShell variant="admin">
      <div className="admin-head">
        <div>
          <h1><i className="fa-solid fa-book-medical" /> {t('adm.title', 'Knowledge Base cho AI')}</h1>
          <p className="muted" dangerouslySetInnerHTML={{ __html: t('adm.desc_html', 'Tải tài liệu PDF lên để AI tham khảo khi tư vấn. Quy trình: lưu file gốc vào <strong>Supabase Storage</strong> → trích văn bản → chia đoạn → lưu vào Supabase → PostgreSQL tự tạo chỉ mục <strong>Full Text Search</strong> (tsvector + GIN + ts_rank). Không dùng embedding. Có hiệu lực ngay, không cần deploy lại.') }} />
        </div>
      </div>

      <div className="status-bar">
        <div className={`status-pill ${store.ready ? 'ok' : 'bad'}`}><i className="fa-solid fa-database" /> <span>{store.ready ? t('adm.store_ready', 'Kho dữ liệu sẵn sàng') : t('adm.store_notready', 'Chưa tạo bảng Supabase')}</span></div>
        <div className="status-pill"><i className="fa-solid fa-file-pdf" /> <span>{store.pdfs ?? 0} {t('adm.unit_docs', 'tài liệu')}</span></div>
        <div className="status-pill"><i className="fa-solid fa-layer-group" /> <span>{store.chunks ?? 0} {t('adm.unit_chunks', 'đoạn')}</span></div>
        <div className={`status-pill ${statusData?.storage ? 'ok' : 'bad'}`}><i className="fa-solid fa-box-archive" /> <span>{t('adm.storage', 'Lưu file')}: {statusData?.storage ? 'Supabase Storage' : t('adm.notconfigured', 'Chưa cấu hình')}</span></div>
        <div className={`status-pill ${statusData?.cloudinary ? 'ok' : ''}`}><i className="fa-solid fa-cloud" /> <span>{t('adm.cloudinary', 'Cloudinary (tùy chọn)')}: {statusData?.cloudinary ? t('adm.on', 'Đã bật') : t('adm.off', 'Tắt')}</span></div>
        <div className="status-pill ok"><i className="fa-solid fa-magnifying-glass" /> <span>Full Text Search: Postgres (tsvector + GIN)</span></div>
      </div>

      <div className="admin-grid">
        <section className="card">
          <h2><i className="fa-solid fa-cloud-arrow-up" /> {t('adm.upload_title', 'Tải tài liệu PDF')}</h2>

          <label
            className={`dropzone${files.length ? ' has-file' : ''}${dragOver ? ' dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={onDrop}
          >
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => onFilesChosen(e.target.files)} />
            <i className="fa-solid fa-file-pdf" />
            {files.length === 0 && <span>{t('adm.dropzone', 'Bấm để chọn một hoặc nhiều tệp PDF')}</span>}
            {files.length > 0 && files.length <= 3 && (
              <div className="file-chips-wrap">
                {files.map((f, i) => <span className="file-chip" key={i}><i className="fa-solid fa-file-pdf" /> {truncateName(f.name)}</span>)}
              </div>
            )}
            {files.length > 3 && <span>{tn('adm.selected_count', { n: files.length }, `Đã chọn ${files.length} file`)}</span>}
          </label>

          <ActionButton className="btn-primary" disabled={uploading} onClick={doUpload} loadingText={t('common.processing', 'Đang xử lý...')}><i className="fa-solid fa-upload" /> {t('adm.upload_btn', 'Tải lên & xử lý')}</ActionButton>
          {uploading && (
            <div className="progress" style={{ display: 'flex' }}>
              <div className="spinner" />
              <span>{progressMsg}</span>
            </div>
          )}
          <p className="hint">{t('adm.hint', 'Lưu ý: PDF dạng scan ảnh (không có text) sẽ không trích được nội dung.')}</p>
        </section>

        <section className="card">
          <div className="card-head-row">
            <h2><i className="fa-solid fa-folder-open" /> {t('adm.docs_title', 'Tài liệu đã tải lên')}</h2>
            <div className="card-actions">
              <ActionButton className="btn-ghost" onClick={() => loadPdfs(window.localStorage.getItem('calorie_ai_token'))}><i className="fa-solid fa-rotate" /> {t('adm.refresh', 'Làm mới')}</ActionButton>
            </div>
          </div>

          {pdfs === null ? (
            <div className="table-skeleton">
              <div className="skeleton-row"><div className="sk sk-full" /></div>
              <div className="skeleton-row"><div className="sk sk-full" /></div>
              <div className="skeleton-row"><div className="sk sk-full" /></div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="docs-table">
                <thead>
                  <tr><th>{t('adm.th_file', 'Tệp')}</th><th>{t('adm.th_size', 'Kích thước')}</th><th>{t('adm.th_status', 'Trạng thái')}</th><th>{t('adm.th_chunks', 'Đoạn')}</th><th>{t('adm.th_index', 'Chỉ mục')}</th><th>{t('adm.th_download', 'File')}</th><th /></tr>
                </thead>
                <tbody>
                  {pdfsError ? (
                    <tr><td colSpan={7} className="empty">{pdfsError}</td></tr>
                  ) : pdfs.length === 0 ? (
                    <tr><td colSpan={7} className="empty">{t('adm.empty', 'Chưa có tài liệu nào. Hãy tải PDF lên.')}</td></tr>
                  ) : (
                    pdfs.map((p) => {
                      const fullName = p.file_name || '';
                      const shortName = fullName.length > 48 ? fullName.slice(0, 44) + '…' + (fullName.lastIndexOf('.') > 44 ? fullName.slice(fullName.lastIndexOf('.')) : '') : fullName;
                      const indexed = (p.chunk_count ?? 0) > 0;
                      return (
                        <tr key={p.id}>
                          <td className="doc-name" title={fullName}>{shortName}</td>
                          <td>{fmtBytes(p.file_size)}</td>
                          <td title={p.status === 'error' ? p.error_message : undefined}>{statusBadge(p.status)}</td>
                          <td className="chip-count">{p.chunk_count ?? 0}</td>
                          <td>{indexed ? <span className="tick"><i className="fa-solid fa-check" /> FTS</span> : <span className="cross">—</span>}</td>
                          <td>
                            {p.download_url ? (
                              <a className="btn-ghost" href={p.download_url} target="_blank" rel="noopener noreferrer" download={(p.file_name || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')} title={p.download_kind === 'cloudinary' ? t('adm.dl_cloudinary', 'Tải PDF (Cloudinary)') : t('adm.dl', 'Tải PDF')}>
                                <i className="fa-solid fa-download" />
                              </a>
                            ) : <span className="cross" title={t('adm.no_file', 'Chưa có file gốc để tải')}>—</span>}
                          </td>
                          <td><ActionButton className="icon-btn" title={t('common.delete', 'Xóa')} onClick={() => deletePdf(p.id)}><i className="fa-solid fa-trash" /></ActionButton></td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PageShell>
  );
}
