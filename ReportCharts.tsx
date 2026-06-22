import React from 'react';
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

interface ReportChartItem {
  name: string;
  value: number;
  color: string;
}

interface ReportChartsProps {
  data: ReportChartItem[];
  theme: 'light' | 'dark';
}

const ReportCharts: React.FC<ReportChartsProps> = ({ data, theme }) => {
  const tooltipStyle = theme === 'dark'
    ? { backgroundColor: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, color: '#f4f4f5' }
    : { backgroundColor: '#ffffff', border: '1px solid #e4e4e7', borderRadius: 8, color: '#18181b' };

  if (!data.length) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 px-5 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950/40 dark:text-zinc-400">
        Não há dados suficientes para gerar os gráficos.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <div className="flex h-64 flex-col items-center rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
        <span className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Distribuição proporcional</span>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} innerRadius={45} outerRadius={62} dataKey="value" stroke="none" paddingAngle={5}>
              {data.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={entry.color} />)}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend verticalAlign="bottom" height={36} wrapperStyle={{ fontSize: '10px', paddingTop: '15px' }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex h-64 flex-col items-center rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-950/40">
        <span className="mb-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Volume por status</span>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: -10, right: 10 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" stroke={theme === 'dark' ? '#a1a1aa' : '#71717a'} fontSize={10} width={90} />
            <Tooltip cursor={{ fill: 'transparent' }} contentStyle={tooltipStyle} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {data.map((entry, index) => <Cell key={`${entry.name}-${index}`} fill={entry.color} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ReportCharts;
