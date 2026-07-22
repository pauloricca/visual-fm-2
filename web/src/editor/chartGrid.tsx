export interface ChartGridTick {
  fraction: number;
  label?: string;
  major?: boolean;
  origin?: boolean;
}

interface ChartGridProps {
  width: number;
  height: number;
  columns: ChartGridTick[];
  rows: ChartGridTick[];
  className?: string;
  showRowLabels?: boolean;
}

export function ChartGrid({
  width,
  height,
  columns,
  rows,
  className = '',
  showRowLabels = false,
}: ChartGridProps) {
  return (
    <div className={['audio-chart-grid-layer', className].filter(Boolean).join(' ')} aria-hidden="true">
      <svg className="audio-chart-grid" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" focusable="false">
        {columns.map((tick) => (
          <line
            key={`column-${tick.fraction}`}
            className={tick.major ? 'audio-chart-grid-line audio-chart-grid-line-major' : 'audio-chart-grid-line'}
            x1={tick.fraction * width}
            y1="0"
            x2={tick.fraction * width}
            y2={height}
          />
        ))}
        {rows.map((tick) => (
          <line
            key={`row-${tick.fraction}`}
            className={[
              'audio-chart-grid-line',
              tick.major === false ? '' : 'audio-chart-grid-line-major',
              tick.origin ? 'audio-chart-grid-line-origin' : '',
            ].filter(Boolean).join(' ')}
            x1="0"
            y1={tick.fraction * height}
            x2={width}
            y2={tick.fraction * height}
          />
        ))}
      </svg>
      {showRowLabels ? (
        <span className="audio-chart-grid-scale">
          {rows.map((tick) => tick.label === undefined ? null : (
            <span
              key={`label-${tick.fraction}`}
              className={[
                'audio-chart-grid-scale-label',
                tick.fraction === 0 ? 'audio-chart-grid-scale-label-top' : '',
                tick.fraction === 1 ? 'audio-chart-grid-scale-label-bottom' : '',
              ].filter(Boolean).join(' ')}
              style={{ top: `${tick.fraction * 100}%` }}
            >
              {tick.label}
            </span>
          ))}
        </span>
      ) : null}
    </div>
  );
}

export function chartScaleTicks(
  start: number,
  end: number,
  size: number,
  orientation: 'horizontal' | 'vertical',
): ChartGridTick[] {
  const divisions = chartLabelDivisions(size, orientation);
  return Array.from({ length: divisions + 1 }, (_, index) => {
    const fraction = index / divisions;
    return {
      fraction,
      label: formatChartValue(start + (end - start) * fraction),
      major: true,
    };
  });
}

export function chartGridColumns(width: number): ChartGridTick[] {
  const labelDivisions = chartLabelDivisions(width, 'horizontal');
  const divisions = width >= 560
    ? 64
    : width >= 400
      ? 48
      : width >= 280
        ? 32
        : width >= 200
          ? 24
          : 12;
  const majorStep = divisions / labelDivisions;

  return Array.from({ length: divisions + 1 }, (_, index) => ({
    fraction: index / divisions,
    major: index % majorStep === 0,
  }));
}

export function chartGridRows(height: number): ChartGridTick[] {
  const rows = height >= 112
    ? 8
    : height >= 84
      ? 6
      : height >= 64
        ? 4
        : 2;
  return Array.from({ length: rows }, (_, index) => ({
    fraction: (index + 1) / (rows + 1),
    major: false,
  }));
}

function chartLabelDivisions(size: number, orientation: 'horizontal' | 'vertical'): number {
  return orientation === 'horizontal'
    ? size >= 560 ? 8 : size >= 360 ? 4 : 2
    : size >= 176 ? 8 : size >= 104 ? 4 : 2;
}

function formatChartValue(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const absoluteValue = Math.abs(value);
  const formatted = absoluteValue >= 100
    ? `${Math.round(value)}`
    : absoluteValue >= 10
      ? value.toFixed(1)
      : absoluteValue >= 1
        ? value.toFixed(2)
        : value.toFixed(3);
  return formatted.includes('.') ? formatted.replace(/\.?0+$/, '') : formatted;
}
