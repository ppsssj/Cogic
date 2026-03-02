// import "./../App.css";
import {
  ChevronDown,
  Download,
  LayoutGrid,
  Maximize2,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import logoLightUrl from "../../../assets/logo.svg";
import logoDarkUrl from "../../../assets/logo2.svg";
import "./Topbar.css";

type Props = {
  projectName: string;
  onRefresh: () => void;
  onGenerate: () => void;
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
};

export function Topbar({
  projectName,
  onRefresh,
  onGenerate,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  return (
    <header className="topbar">
      <div className="topbarLeft">
        <div className="brand">
          <img
            className="brandLogoWide logoLight"
            src={logoLightUrl}
            alt="CodeGraph"
          />
          <img
            className="brandLogoWide logoDark"
            src={logoDarkUrl}
            alt="CodeGraph"
          />
          <h1 className="brandTitle">CodeGraph</h1>
        </div>

        <button className="projectPicker" type="button" onClick={onRefresh}>
          <span className="projectName">{projectName}</span>
          <ChevronDown className="icon" />
        </button>

        <div className="searchWrap">
          <div className="searchBox">
            <span className="searchIcon">
              <Search className="icon" />
            </span>
            <input
              className="searchInput"
              placeholder="Search nodes, files, symbols..."
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="topbarRight">
        <button
          className="iconBtn"
          title="Refresh (active file)"
          type="button"
          onClick={onRefresh}
        >
          <RefreshCw className="icon" />
        </button>

        <button className="iconBtn" title="Auto Layout" type="button">
          <LayoutGrid className="icon" />
        </button>

        <button className="iconBtn" title="Fit to Screen" type="button">
          <Maximize2 className="icon" />
        </button>

        <button className="iconBtn" title="Export" type="button">
          <Download className="icon" />
        </button>

        <div className="divider" />

        <button className="primaryBtn" type="button" onClick={onGenerate}>
          <Play className="icon primaryBtnIcon" />
          Generate
        </button>
      </div>
    </header>
  );
}
