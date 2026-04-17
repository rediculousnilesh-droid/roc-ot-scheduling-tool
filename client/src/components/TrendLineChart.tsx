import { useRef } from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { AllFillRates } from '../types';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface Props {
  fillRates: AllFillRates | null;
  chartRef?: React.MutableRefObject<ChartJS<'line'> | null>;
}

export default function TrendLineChart({ fillRates, chartRef }: Props) {
  const localRef = useRef<ChartJS<'line'> | null>(null);
  const ref = chartRef || localRef;

  if (!fillRates) return null;

  const entries = Object.entries(fillRates.byDate).sort(([a], [b]) => a.localeCompare(b));
  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v.fillRate ?? 0);

  return (
    <div style={{ maxHeight: 280 }}>
      <Line
        ref={(r) => { ref.current = r ?? null; }}
        data={{
          labels,
          datasets: [
            {
              label: 'Fill Rate %',
              data: values,
              borderColor: 'rgba(74, 144, 217, 1)',
              backgroundColor: 'rgba(74, 144, 217, 0.1)',
              fill: true,
              tension: 0.3,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Fill Rate Trend by Date', font: { size: 13 } },
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: (ctx) => `${ctx.parsed.y?.toFixed(1)}%`,
              },
            },
          },
          scales: {
            y: { beginAtZero: true, max: 100, title: { display: true, text: '%' } },
          },
        }}
        height={260}
      />
    </div>
  );
}
