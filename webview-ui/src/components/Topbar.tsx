import {
  Check,
  ChevronDown,
  Download,
  GitBranch,
  LayoutGrid,
  Loader2,
  Maximize2,
  Play,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import logoLightUrl from "../../../assets/logo.svg";
import logoDarkUrl from "../../../assets/logo2.svg";
import "./Topbar.css";

type WorkspaceFileItem = {
  path: string;
  label: string;
};

type Props = {
  projectName: string;
  workspaceRootName: string | null;
  workspaceFiles: WorkspaceFileItem[];
  activeFilePath: string | null;
  onPickFile: (filePath: string) => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onAutoLayout: () => void;
  onFitToScreen: () => void;
  traceMode: boolean;
  onToggleTraceMode: () => void;

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
  workspaceRootName,
  workspaceFiles,
  activeFilePath,
  onPickFile,
  onRefresh,
  onGenerate,
  onAutoLayout,
  onFitToScreen,
  traceMode,
  onToggleTraceMode,
  onDownloadFlow,
  downloadEnabled,
  downloadStatus,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  const isDownloading = downloadStatus === "downloading";
  const isDone = downloadStatus === "done";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const pickerRef = useRef<HTMLDivElement | null>(null);

  const activeWorkspaceFile = useMemo(
    () => workspaceFiles.find((file) => file.path === activeFilePath) ?? null,
    [activeFilePath, workspaceFiles],
  );
  const filteredWorkspaceFiles = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return workspaceFiles;

    return workspaceFiles.filter((file) =>
      `${file.label} ${file.path}`.toLowerCase().includes(q),
    );
  }, [pickerQuery, workspaceFiles]);

  useEffect(() => {
    if (!pickerOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) setPickerQuery("");
  }, [pickerOpen]);

  return (
    <header className={["topbar", traceMode ? "topbar--traceOn" : ""].join(" ")}>
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

        <div className="projectPickerWrap" ref={pickerRef}>
          <button
            className={[
              "projectPicker",
              pickerOpen ? "projectPicker--open" : "",
            ].join(" ")}
            type="button"
            onClick={() => setPickerOpen((prev) => !prev)}
            aria-expanded={pickerOpen}
          >
            <span className="projectName">
              {activeWorkspaceFile?.label ?? projectName}
            </span>
            <ChevronDown className="icon" />
          </button>

          {pickerOpen ? (
            <div className="projectMenu">
              <div className="projectMenuHeader">
                <span className="projectMenuTitle">Workspace</span>
                <span className="projectMenuRoot">
                  {workspaceRootName ?? "No root"}
                </span>
              </div>

              <div className="projectMenuSearch">
                <Search className="icon" />
                <input
                  className="projectMenuSearchInput"
                  placeholder="Search files..."
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  autoFocus
                />
              </div>

              <div className="projectMenuList" role="listbox">
                {filteredWorkspaceFiles.length > 0 ? (
                  filteredWorkspaceFiles.map((file) => {
                    const active = file.path === activeFilePath;
                    return (
                      <button
                        key={file.path}
                        className={[
                          "projectMenuItem",
                          active ? "projectMenuItem--active" : "",
                        ].join(" ")}
                        type="button"
                        onClick={() => {
                          setPickerOpen(false);
                          onPickFile(file.path);
                        }}
                      >
                        <span className="projectMenuItemLabel">{file.label}</span>
                        {active ? <Check className="icon" /> : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="projectMenuEmpty">No matching files</div>
                )}
              </div>
            </div>
          ) : null}
        </div>

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

        <button
          className="iconBtn"
          title="Auto Layout"
          type="button"
          onClick={onAutoLayout}
        >
          <LayoutGrid className="icon" />
        </button>

        <button
          className="iconBtn"
          title="Fit to Screen"
          type="button"
          onClick={onFitToScreen}
        >
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

        <button
          className={["iconBtn", traceMode ? "iconBtn--traceOn" : ""].join(" ")}
          title={traceMode ? "Trace mode ON" : "Trace mode OFF"}
          type="button"
          onClick={onToggleTraceMode}
          aria-pressed={traceMode}
        >
          <GitBranch className="icon" />
          {traceMode ? <span className="traceDot" /> : null}
        </button>

        {traceMode ? <span className="tracePill">TRACE MODE</span> : null}

        <button className="primaryBtn" type="button" onClick={onGenerate}>
          <Play className="icon primaryBtnIcon" />
          {traceMode ? "Load Trace" : "Generate"}
        </button>
      </div>
    </header>
  );
}
