// import "./../App.css";
import { Check } from "lucide-react";
import "./FiltersBar.css";
export type ChipKey =
  | "functions"
  | "classes"
  | "files"
  | "interfaces"
  | "variables";

type Props = {
  active: ChipKey;
  onChange: (k: ChipKey) => void;
};

const chips: Array<{ key: ChipKey; label: string }> = [
  { key: "functions", label: "Functions" },
  { key: "classes", label: "Classes" },
  { key: "files", label: "Files" },
  { key: "interfaces", label: "Interfaces" },
  { key: "variables", label: "Variables" },
];

export function FiltersBar({ active, onChange }: Props) {
  return (
    <div className="filtersBar">
      <span className="filtersLabel">Filters:</span>

      {chips.map((c) => {
        const isActive = active === c.key;
        return (
          <button
            key={c.key}
            className={`chip ${isActive ? "chip--active" : ""}`}
            type="button"
            onClick={() => onChange(c.key)}
          >
            {isActive ? <Check className="icon chipCheck" /> : null}
            {c.label}
          </button>
        );
      })}
    </div>
  );
}
