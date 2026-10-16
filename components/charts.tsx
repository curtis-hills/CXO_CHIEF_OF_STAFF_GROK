import { calendarDaysBetween } from "@/lib/metrics/calendar";
import { expectedTransactions, type PaceEvaluation } from "@/lib/metrics/pace";

export function Sparkline({ values }: { values: number[] }) {
  const width = 88;
  const height = 28;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values
    .map((value, index) => `${index * step},${height - 2 - (value / max) * (height - 4)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline fill="none" stroke="#0f5c56" strokeWidth="1.5" points={points} />
    </svg>
  );
}

export function PaceChart({
  pace,
  launchedAt,
  createdAts,
}: {
  pace: PaceEvaluation;
  launchedAt: string;
  createdAts: string[];
}) {
  const width = 680;
  const height = 220;
  const padL = 32;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const maxY = Math.max(25, pace.actual, Math.ceil(pace.projected));
  const x = (day: number) => padL + (day / 60) * (width - padL - padR);
  const y = (value: number) => height - padB - (value / maxY) * (height - padT - padB);
  const expected = Array.from({ length: 61 }, (_, day) => `${x(day)},${y(expectedTransactions(day))}`).join(" ");
  const actualDays = Math.min(60, Math.max(0, pace.day));
  const actual = Array.from({ length: actualDays + 1 }, (_, day) => {
    const count = createdAts.filter((iso) => calendarDaysBetween(launchedAt, iso) <= day).length;
    return `${x(day)},${y(count)}`;
  }).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label="Actual projects against the expected pace curve">
      <line x1={padL} y1={y(0)} x2={width - padR} y2={y(0)} stroke="#e4ddd0" />
      <line x1={padL} y1={padT} x2={padL} y2={y(0)} stroke="#e4ddd0" />
      {[0, 10, 25].map((tick) => (
        <g key={tick}>
          <line x1={padL} y1={y(tick)} x2={width - padR} y2={y(tick)} stroke="#efeae1" />
          <text x={4} y={y(tick) + 4} fill="#6b645b" fontSize="11">
            {tick}
          </text>
        </g>
      ))}
      {[0, 30, 60].map((day) => (
        <text key={day} x={x(day)} y={height - 8} textAnchor="middle" fill="#6b645b" fontSize="11">
          {day}
        </text>
      ))}
      <polyline fill="none" stroke="#c4b8a5" strokeWidth="1.5" points={expected} />
      <polyline fill="none" stroke="#0f5c56" strokeWidth="2" points={actual} />
      <circle cx={x(Math.min(60, pace.day))} cy={y(pace.actual)} r="3.5" fill="#0f5c56" />
    </svg>
  );
}
