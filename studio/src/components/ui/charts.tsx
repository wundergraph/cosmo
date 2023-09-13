export const CustomTooltip = ({ active, payload, label, valueLabel }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="rounded-md border border-popover bg-popover p-2 text-sm shadow-md outline-0 backdrop-blur-lg">
        <div className="label">{label}</div>
        <div className="intro">
          {valueLabel || payload[0].name}: {payload[0].value}
        </div>
      </div>
    );
  }
  return null;
};
