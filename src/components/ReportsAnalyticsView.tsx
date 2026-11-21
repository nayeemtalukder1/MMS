import React from 'react';
import { Download } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export interface ReportsOverviewData {
  summary: {
    totalTeachers: number;
    totalFaculties: number;
    totalDepartments: number;
    totalMeetings: number;
    upcomingMeetings: number;
    liveMeetings: number;
    completedMeetings: number;
    cancelledMeetings: number;
    pendingActions: number;
    completedActions: number;
  };
  byDepartment: Array<{
    department: string;
    meetings: number;
    online: number;
    physical: number;
    hybrid: number;
  }>;
  byType: Array<{ type: string; count: number }>;
  attendanceBreakdown: Array<{ status: string; count: number }>;
  actionBreakdown: Array<{ status: string; count: number }>;
}

const CHART_COLORS = ['#0F766E', '#0F2942', '#D97706', '#DC2626'];

export const ReportsAnalyticsView: React.FC<{ data: ReportsOverviewData | null }> = ({ data }) => {
  if (!data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-xs text-slate-500">
        Loading university analytics...
      </div>
    );
  }

  const exportSummaryCsv = () => {
    const lines = [
      'Department,Total Meetings,Online,Physical,Hybrid',
      ...data.byDepartment.map((d) => `"${d.department}",${d.meetings},${d.online},${d.physical},${d.hybrid}`),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'utmms-departmental-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-display text-sm font-semibold text-slate-900">
            University Meeting Reports & Analytics
          </h3>
          <p className="text-xs text-slate-500">
            Departmental activity, format distribution, attendance rates, and action completion metrics.
          </p>
        </div>
        <button
          type="button"
          onClick={exportSummaryCsv}
          className="px-3.5 py-2 border border-slate-300 hover:bg-slate-50 text-xs font-medium rounded-lg inline-flex items-center gap-1.5"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Report CSV</span>
        </button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Meetings', val: data.summary.totalMeetings },
          { label: 'Upcoming / Live', val: data.summary.upcomingMeetings + data.summary.liveMeetings },
          { label: 'Completed', val: data.summary.completedMeetings },
          { label: 'Cancelled', val: data.summary.cancelledMeetings },
          {
            label: 'Action Completion',
            val: `${data.summary.completedActions}/${data.summary.completedActions + data.summary.pendingActions}`,
          },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs text-slate-500">{item.label}</p>
            <p className="font-display text-2xl font-semibold text-slate-900 tabular-nums mt-1">{item.val}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5">
          <h4 className="font-display text-sm font-semibold text-slate-900 mb-4">
            Department-Wise Meetings by Format
          </h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byDepartment}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="department" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="online" name="Online" fill="#0F766E" radius={[4, 4, 0, 0]} />
                <Bar dataKey="hybrid" name="Hybrid" fill="#0F2942" radius={[4, 4, 0, 0]} />
                <Bar dataKey="physical" name="Physical" fill="#64748B" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5">
          <h4 className="font-display text-sm font-semibold text-slate-900 mb-4">
            Attendance & Participation Distribution
          </h4>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.attendanceBreakdown}
                  dataKey="count"
                  nameKey="status"
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={88}
                  paddingAngle={3}
                >
                  {data.attendanceBreakdown.map((entry, idx) => (
                    <Cell key={entry.status} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
