import { useRef } from 'react';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import type { AllFillRates } from '../types';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

interface Props {
  fillRates: AllFillRates | null;
  chartRef?: React.MutableRefObject<ChartJS<'bar'> | null>;
}

export default function ManagerBarChart({ fillRates, chartRef }: Props) {
  const localRef = useRef<ChartJS<'bar'> | null>(null);
  const ref = chartRef || localRef;

  if (!fillRates) return null;

  const entries = Object.entries(fillRates.byManager);
  const labels = entries.map(([k]) => k);
  const values = entries.map(([, v]) => v.fillRate ?? 0);

  return (
    <div style={{ maxHeight: 280 }}>
      <Bar
        ref={(r) => { ref.current = r ?? null; }}
        data={{
          labels,
          datasets: [
            {
              label: 'Fill Rate %',
              data: values,
              backgroundColor: 'rgba(76, 175, 80, 0.7)',
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Fill Rate by Manager', font: { size: 13 } },
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
