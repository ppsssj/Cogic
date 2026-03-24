// import "./../App.css";
import { Check } from "lucide-react";
import "./FiltersBar.css";
export type ChipKey =
  | "all"
  | "functions"
  | "classes"
  | "files"
  | "interfaces"
  | "variables";

type Props = {
  active: ChipKey[];
  onChange: (next: ChipKey[]) => void;
};

const chips: Array<{ key: ChipKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "functions", label: "Functions" },
  { key: "classes", label: "Classes" },
  { key: "files", label: "Files" },
  { key: "interfaces", label: "Interfaces" },
  { key: "variables", label: "Variables" },
];

export function FiltersBar({ active, onChange }: Props) {
  const toggleChip = (chip: ChipKey) => {
    if (chip === "all") {
      onChange(["all"]);
      return;
    }

    const current = active.includes("all")
      ? []
      : active.filter((key) => key !== "all");
    const next = current.includes(chip)
      ? current.filter((key) => key !== chip)
      : [...current, chip];

    onChange(next.length > 0 ? next : ["all"]);
  };

  return (
    <div className="filtersBar">
      <span className="filtersLabel">Filters:</span>

      {chips.map((c) => {
        const isActive = active.includes(c.key);
        return (
          <button
            key={c.key}
            className={`chip ${isActive ? "chip--active" : ""}`}
            type="button"
            onClick={() => toggleChip(c.key)}
          >
            {isActive ? <Check className="icon chipCheck" /> : null}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
