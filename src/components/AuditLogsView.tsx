import React, { useMemo, useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import type { DashboardPayload } from '../shared/types';

interface AuditLogsViewProps {
  data: DashboardPayload;
}

export function AuditLogsView({ data }: AuditLogsViewProps) {
  const [search, setSearch] = useState('');
  const [entityFilter, setEntityFilter] = useState('all');

  const entities = useMemo(() => {
    return Array.from(new Set(data.auditLogs.map((l) => l.entityType))).sort();
  }, [data.auditLogs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.auditLogs.filter((log) => {
      if (entityFilter !== 'all' && log.entityType !== entityFilter) return false;
      if (!q) return true;
      return `${log.action} ${log.actorEmail} ${log.summary} ${log.entityType} ${log.entityId}`
        .toLowerCase()
        .includes(q);
    });
  }, [data.auditLogs, search, entityFilter]);

  return (
    <div className="space-y-5">
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, actor email, or summary..."
            className="w-full pl-9 pr-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
          />
        </div>

        <select
          aria-label="Filter audit logs by entity"
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="px-3 py-2 text-xs font-medium bg-white border border-slate-200 rounded-lg text-slate-700"
        >
          <option value="all">All Entities</option>
          {entities.map((ent) => (
            <option key={ent} value={ent}>
              {ent}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ScrollText className="w-4 h-4 text-blue-700" />
            <h2 className="font-display text-sm font-semibold text-slate-900">
              Academy Security & Operations Audit Log
            </h2>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {filtered.length} entries
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-[11px] font-medium text-slate-500">
                <th className="py-2.5 px-5">Timestamp</th>
                <th className="py-2.5 px-4">Actor</th>
                <th className="py-2.5 px-4">Action</th>
                <th className="py-2.5 px-4">Entity</th>
                <th className="py-2.5 px-5">Summary</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {filtered.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50/70">
                  <td className="py-3 px-5 font-mono text-slate-500 whitespace-nowrap tabular-nums">
                    {new Date(log.createdAt).toLocaleString('en-US')}
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-medium text-slate-900">{log.actorEmail}</div>
                    <div className="text-slate-500 capitalize">{log.actorRole}</div>
                  </td>
                  <td className="py-3 px-4 font-mono font-semibold text-blue-700 whitespace-nowrap">
                    {log.action}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {log.entityType}:{log.entityId}
                  </td>
                  <td className="py-3 px-5 text-slate-700">{log.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
