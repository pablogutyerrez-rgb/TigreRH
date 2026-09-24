interface CampaignMultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (campaigns: string[]) => void;
  allLabel: string;
  summaryClassName: string;
}

export default function CampaignMultiSelect({
  options,
  selected,
  onChange,
  allLabel,
  summaryClassName,
}: CampaignMultiSelectProps) {
  const summary = selected.length === 0
    ? allLabel
    : selected.length === 1
      ? selected[0]
      : `${selected.length} campañas`;

  const toggle = (campaign: string) => {
    onChange(selected.includes(campaign)
      ? selected.filter((item) => item !== campaign)
      : [...selected, campaign]);
  };

  return (
    <details className="relative">
      <summary className={`cursor-pointer list-none ${summaryClassName}`} title={selected.join(', ')}>
        <span className="block truncate">{summary}</span>
      </summary>
      <div className="absolute left-0 z-50 mt-1 max-h-60 min-w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
        <label className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-700 hover:bg-indigo-50">
          <input type="checkbox" checked={selected.length === 0} onChange={() => onChange([])} className="h-4 w-4 accent-indigo-600" />
          <span className="whitespace-nowrap">{allLabel}</span>
        </label>
        {options.map((campaign) => (
          <label key={campaign} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs text-slate-700 hover:bg-indigo-50">
            <input type="checkbox" checked={selected.includes(campaign)} onChange={() => toggle(campaign)} className="h-4 w-4 accent-indigo-600" />
            <span className="whitespace-nowrap">{campaign}</span>
          </label>
        ))}
      </div>
    </details>
  );
}
