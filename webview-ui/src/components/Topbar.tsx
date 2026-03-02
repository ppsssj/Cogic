import {
  ChevronDown,
  Download,
  LayoutGrid,
  Loader2,
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

  /** Flow 다운로드 */
  onDownloadFlow: () => void;

  /** 다운로드 가능 여부(그래프 존재 여부) */
  downloadEnabled: boolean;

  /** 다운로드 진행 상태 표시 */
  downloadStatus: "idle" | "downloading" | "done";

  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
};

export function Topbar({
  projectName,
  onRefresh,
  onGenerate,
  onDownloadFlow,
  downloadEnabled,
  downloadStatus,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  const isDownloading = downloadStatus === "downloading";
  const isDone = downloadStatus === "done";

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

        {/* ✅ FLOW 다운로드 */}
        <button
          className={[
            "iconBtn",
            !downloadEnabled ? "iconBtn--disabled" : "",
            isDownloading ? "iconBtn--busy" : "",
          ].join(" ")}
          title={
            !downloadEnabled
              ? "No graph to download"
              : isDownloading
              ? "Downloading…"
              : isDone
              ? "Download complete"
              : "Download Flow"
          }
          type="button"
          onClick={onDownloadFlow}
          aria-disabled={!downloadEnabled || isDownloading}
        >
          {isDownloading ? (
            <Loader2 className="icon spin" />
          ) : (
            <Download className="icon" />
          )}
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