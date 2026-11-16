import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Download,
  FileText,
  Plus,
  Upload,
  X,
} from 'lucide-react';
import type { DashboardPayload, DocumentCategory } from '../shared/types';
import { api } from '../utils/api';

interface DocumentsViewProps {
  data: DashboardPayload;
  onUploadDocument: (payload: {
    ownerUserId?: string;
    courseId?: string;
    title: string;
    category: DocumentCategory;
    fileName: string;
    mimeType: string;
    contentBase64: string;
  }) => Promise<void>;
  onArchiveDocument: (docId: string) => Promise<void>;
}

export function DocumentsView({
  data,
  onUploadDocument,
  onArchiveDocument,
}: DocumentsViewProps) {
  const isStaff = data.user.role === 'admin' || data.user.role === 'instructor';
  const [categoryFilter, setCategoryFilter] = useState<'All' | DocumentCategory>('All');
  const [modalOpen, setModalOpen] = useState(false);

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DocumentCategory>(
    isStaff ? 'Syllabus' : 'Assignment'
  );
  const [ownerUserId, setOwnerUserId] = useState(data.user.id);
  const [courseId, setCourseId] = useState(data.courses[0]?.id ?? '');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formError, setFormError] = useState('');
  const [notice, setNotice] = useState('');
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const visibleDocs = useMemo(() => {
    return data.documents.filter((d) => {
      if (d.isArchived) return false;
      if (categoryFilter !== 'All' && d.category !== categoryFilter) return false;
      return true;
    });
  }, [data.documents, categoryFilter]);

  function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const res = typeof reader.result === 'string' ? reader.result : '';
        const commaIdx = res.indexOf(',');
        resolve(commaIdx >= 0 ? res.slice(commaIdx + 1) : res);
      };
      reader.onerror = () => reject(new Error('Failed to read selected file.'));
      reader.readAsDataURL(file);
    });
  }

  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (!selectedFile) {
      setFormError('Please choose a file (max 2 MB) to upload.');
      return;
    }
    if (selectedFile.size > 2 * 1024 * 1024) {
      setFormError('File exceeds the 2 MB PostgreSQL document upload limit.');
      return;
    }
    setUploading(true);
    try {
      const contentBase64 = await fileToBase64(selectedFile);
      await onUploadDocument({
        ownerUserId: isStaff ? ownerUserId : undefined,
        courseId: courseId || undefined,
        title: title.trim() || selectedFile.name,
        category,
        fileName: selectedFile.name,
        mimeType: selectedFile.type || 'application/octet-stream',
        contentBase64,
      });
      setModalOpen(false);
      setTitle('');
      setSelectedFile(null);
      setNotice(`Document "${title.trim() || selectedFile.name}" stored securely in the Document Vault.`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {(
            ['All', 'Syllabus', 'ID Verification', 'Transcript', 'Assignment', 'Receipt', 'Other'] as const
          ).map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategoryFilter(cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer whitespace-nowrap shrink-0 ${
                categoryFilter === cat
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => {
            setFormError('');
            setModalOpen(true);
          }}
          className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer whitespace-nowrap"
        >
          <Plus className="w-4 h-4" />
          <span>Upload Document</span>
        </button>
      </div>

      {notice && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-800"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-slate-900">
            Academy Document Vault
          </h2>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {visibleDocs.length} active documents
          </span>
        </div>

        {visibleDocs.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">
            No documents available in this category.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                  <th className="py-2.5 px-5">Document Title</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Course</th>
                  <th className="py-2.5 px-4 text-right">Size</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {visibleDocs.map((doc) => {
                  const course = data.courses.find((c) => c.id === doc.courseId);
                  const canArchive =
                    data.user.role === 'admin' ||
                    doc.ownerUserId === data.user.id ||
                    doc.uploadedByUserId === data.user.id;
                  return (
                    <tr key={doc.id} className="hover:bg-slate-50/70">
                      <td className="py-3 px-5">
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-blue-700 shrink-0" />
                          <div>
                            <div className="font-medium text-slate-900">{doc.title}</div>
                            <div className="font-mono text-xs text-slate-500">
                              {doc.fileName}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-slate-700">{doc.category}</td>
                      <td className="py-3 px-4 text-xs text-slate-600">
                        {course ? `${course.code}` : 'General'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-500 tabular-nums">
                        {Math.max(1, Math.round(doc.sizeBytes / 1024))} KB
                      </td>
                      <td className="py-3 px-5 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            disabled={downloadingId === doc.id}
                            onClick={async () => {
                              setDownloadingId(doc.id);
                              try {
                                await api.downloadDocumentAsset(doc.id, doc.fileName);
                              } catch (err) {
                                setNotice(
                                  err instanceof Error ? err.message : 'Unable to download document.'
                                );
                              } finally {
                                setDownloadingId(null);
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md cursor-pointer disabled:opacity-60"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>{downloadingId === doc.id ? 'Downloading...' : 'Download'}</span>
                          </button>
                          {canArchive && (
                            <button
                              type="button"
                              onClick={() => onArchiveDocument(doc.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 bg-white border border-slate-200 hover:bg-slate-100 rounded-md cursor-pointer"
                            >
                              <Archive className="w-3.5 h-3.5" />
                              <span>Archive</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md bg-white border border-slate-200 rounded-xl p-6 shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <div className="flex items-center gap-2">
                <Upload className="w-4 h-4 text-blue-700" />
                <h3 className="font-display text-base font-semibold text-slate-900">
                  Upload Document
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1.5 rounded-md text-slate-400 hover:text-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {formError && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-xs text-red-800">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{formError}</span>
              </div>
            )}
            <form onSubmit={handleUploadSubmit} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Document Title
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Lab 2 Architecture Brief"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as DocumentCategory)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    {isStaff && <option value="Syllabus">Syllabus</option>}
                    <option value="ID Verification">ID Verification</option>
                    {isStaff && <option value="Transcript">Transcript</option>}
                    <option value="Assignment">Assignment</option>
                    {isStaff && <option value="Receipt">Receipt</option>}
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Course (Optional)
                  </label>
                  <select
                    value={courseId}
                    onChange={(e) => setCourseId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="">General</option>
                    {data.courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {isStaff && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Document Owner
                  </label>
                  <select
                    value={ownerUserId}
                    onChange={(e) => setOwnerUserId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value={data.user.id}>{data.user.name} (Self)</option>
                    {data.students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.studentCode})
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Select File (Max 2 MB)
                </label>
                <input
                  type="file"
                  required
                  onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
                  className="w-full text-xs text-slate-600 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-slate-100 file:text-slate-700"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploading}
                  className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer"
                >
                  {uploading ? 'Uploading...' : 'Save to Vault'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
