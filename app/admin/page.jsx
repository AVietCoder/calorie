'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import PageShell from '../../components/PageShell';
import { useToast } from '../../lib-client/ToastContext';
import '../../styles/admin.css';

const API = '/api/admin';

function fmtBytes(n) {
  if (!n && n !== 0) return '—';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
const STATUS_MAP = {
  ready: ['Đã tải', 'badge'],
  error: ['Lỗi', 'badge bad'],
  uploaded: ['Đã nhận', 'badge gray'],
  extracting: ['Trích text…', 'badge gray'],
  chunking: ['Chia đoạn…', 'badge gray'],
  saving: ['Đang lưu…', 'badge gray'],
};
function statusBadge(s) {
  const [label, cls] = STATUS_MAP[s] || [s || '—', 'badge gray'];
  return <span className={cls}>{label}</span>;
}
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
  const router = useRouter();

  function authHeaders(token, extra = {}) {
    return { Authorization: `Bearer ${token}`, ...extra };
  }

  async function loadPdfs(token) {
    setPdfs(null);
    setPdfsError(null);
    try {
      const res = await fetch(`${API}?action=list`, { headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Không tải được danh sách');
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
          setDeniedMsg(`Tài khoản ${data.email || ''} chưa có quyền quản trị. Liên hệ quản trị viên để được cấp quyền.`);
          setPhase('denied');
          return;
        }
        setStatusData(data);
        setPhase('ready');
        await loadPdfs(token);
      } catch (err) {
        showToast('Lỗi kết nối: ' + err.message, 'error');
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
    if (!files.length) { showToast('Hãy chọn một hoặc nhiều tệp PDF trước.', 'error'); return; }
    const invalid = files.filter((f) => !/\.pdf$/i.test(f.name) && f.type !== 'application/pdf');
    if (invalid.length) { showToast(`File "${invalid[0].name}" không phải PDF.`, 'error'); return; }

    const token = window.localStorage.getItem('calorie_ai_token');
    setUploading(true);
    let successCount = 0, failCount = 0;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setProgressMsg(`Đang xử lý file ${i + 1}/${files.length}: "${file.name}"…`);
      try {
        const fd = new FormData();
        fd.append('file', file);
        const res = await fetch(`${API}?action=upload`, { method: 'POST', headers: authHeaders(token), body: fd });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Tải lên thất bại');
        const d = data.document || {};
        showToast(`✓ "${d.file_name}": ${d.chunk_count} đoạn (đã lập chỉ mục Full Text Search).`, 'success');
        if (data.warning) showToast(data.warning, 'error');
        successCount++;
      } catch (err) {
        showToast(`✗ "${file.name}": ${err.message}`, 'error');
        failCount++;
      }
    }

    setFiles([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (files.length > 1) showToast(`Hoàn tất: ${successCount} thành công, ${failCount} thất bại.`, successCount ? 'success' : 'error');

    setUploading(false);
    await loadPdfs(token);
  }

  async function deletePdf(id) {
    if (!window.confirm('Xóa tài liệu này? Các đoạn văn bản và file trên Cloudinary sẽ bị xóa.')) return;
    const token = window.localStorage.getItem('calorie_ai_token');
    try {
      const res = await fetch(`${API}?action=delete&id=${encodeURIComponent(id)}`, { method: 'POST', headers: authHeaders(token) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Xóa thất bại');
      showToast('Đã xóa tài liệu.', 'success');
      await loadPdfs(token);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  if (phase === 'loading') {
    return (
      <PageShell>
        <div className="admin-page-loader" style={{ position: 'relative' }}>
          <div className="admin-loader-inner">
            <div className="admin-loader-spinner" />
            <p>Đang kiểm tra quyền truy cập…</p>
          </div>
        </div>
      </PageShell>
    );
  }

  if (phase === 'denied') {
    return (
      <PageShell>
        <div className="admin-denied">
          <i className="fa-solid fa-lock" />
          <h2>Khu vực quản trị</h2>
          <p>{deniedMsg}</p>
          <a className="btn-ghost" href="/guide"><i className="fa-solid fa-arrow-left" /> Về trang hướng dẫn</a>
        </div>
      </PageShell>
    );
  }

  const store = statusData?.store || {};

  return (
    <PageShell>
      <div className="admin-head">
        <div>
          <h1><i className="fa-solid fa-book-medical" /> Knowledge Base cho AI</h1>
          <p className="muted">Tải tài liệu PDF lên để AI tham khảo khi tư vấn. Quy trình: lưu file gốc vào <strong>Supabase Storage</strong> → trích văn bản → chia đoạn → lưu vào Supabase → PostgreSQL tự tạo chỉ mục <strong>Full Text Search</strong> (tsvector + GIN + ts_rank). Không dùng embedding. Có hiệu lực ngay, không cần deploy lại.</p>
        </div>
      </div>

      <div className="status-bar">
        <div className={`status-pill ${store.ready ? 'ok' : 'bad'}`}><i className="fa-solid fa-database" /> <span>{store.ready ? 'Kho dữ liệu sẵn sàng' : 'Chưa tạo bảng Supabase'}</span></div>
        <div className="status-pill"><i className="fa-solid fa-file-pdf" /> <span>{store.pdfs ?? 0} tài liệu</span></div>
        <div className="status-pill"><i className="fa-solid fa-layer-group" /> <span>{store.chunks ?? 0} đoạn</span></div>
        <div className={`status-pill ${statusData?.storage ? 'ok' : 'bad'}`}><i className="fa-solid fa-box-archive" /> <span>Lưu file: {statusData?.storage ? 'Supabase Storage' : 'Chưa cấu hình'}</span></div>
        <div className={`status-pill ${statusData?.cloudinary ? 'ok' : ''}`}><i className="fa-solid fa-cloud" /> <span>Cloudinary (tùy chọn): {statusData?.cloudinary ? 'Đã bật' : 'Tắt'}</span></div>
        <div className="status-pill ok"><i className="fa-solid fa-magnifying-glass" /> <span>Full Text Search: Postgres (tsvector + GIN)</span></div>
      </div>

      <div className="admin-grid">
        <section className="card">
          <h2><i className="fa-solid fa-cloud-arrow-up" /> Tải tài liệu PDF</h2>

          <label
            className={`dropzone${files.length ? ' has-file' : ''}${dragOver ? ' dragover' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
            onDrop={onDrop}
          >
            <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => onFilesChosen(e.target.files)} />
            <i className="fa-solid fa-file-pdf" />
            {files.length === 0 && <span>Bấm để chọn một hoặc nhiều tệp PDF</span>}
            {files.length > 0 && files.length <= 3 && (
              <div className="file-chips-wrap">
                {files.map((f, i) => <span className="file-chip" key={i}><i className="fa-solid fa-file-pdf" /> {truncateName(f.name)}</span>)}
              </div>
            )}
            {files.length > 3 && <span>Đã chọn {files.length} file</span>}
          </label>

          <button className="btn-primary" disabled={uploading} onClick={doUpload}><i className="fa-solid fa-upload" /> Tải lên & xử lý</button>
          {uploading && (
            <div className="progress" style={{ display: 'flex' }}>
              <div className="spinner" />
              <span>{progressMsg}</span>
            </div>
          )}
          <p className="hint">Lưu ý: PDF dạng scan ảnh (không có text) sẽ không trích được nội dung.</p>
        </section>

        <section className="card">
          <div className="card-head-row">
            <h2><i className="fa-solid fa-folder-open" /> Tài liệu đã tải lên</h2>
            <div className="card-actions">
              <button className="btn-ghost" onClick={() => loadPdfs(window.localStorage.getItem('calorie_ai_token'))}><i className="fa-solid fa-rotate" /> Làm mới</button>
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
                  <tr><th>Tệp</th><th>Kích thước</th><th>Trạng thái</th><th>Đoạn</th><th>Chỉ mục</th><th>File</th><th /></tr>
                </thead>
                <tbody>
                  {pdfsError ? (
                    <tr><td colSpan={7} className="empty">{pdfsError}</td></tr>
                  ) : pdfs.length === 0 ? (
                    <tr><td colSpan={7} className="empty">Chưa có tài liệu nào. Hãy tải PDF lên.</td></tr>
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
                              <a className="btn-ghost" href={p.download_url} target="_blank" rel="noopener noreferrer" download={(p.file_name || 'document.pdf').replace(/[^a-zA-Z0-9._-]/g, '_')} title={p.download_kind === 'cloudinary' ? 'Tải PDF (Cloudinary)' : 'Tải PDF'}>
                                <i className="fa-solid fa-download" />
                              </a>
                            ) : <span className="cross" title="Chưa có file gốc để tải">—</span>}
                          </td>
                          <td><button className="icon-btn" title="Xóa" onClick={() => deletePdf(p.id)}><i className="fa-solid fa-trash" /></button></td>
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
