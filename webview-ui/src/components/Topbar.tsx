import {
  Check,
  ChevronDown,
  Download,
  GitBranch,
  LayoutGrid,
  Loader2,
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
  graphDepth: number;
  onPickFile: (filePath: string) => void;
  onGraphDepthChange: (depth: number) => void;
  onRefresh: () => void;
  onGenerate: () => void;
  onAutoLayout: () => void;
  traceMode: boolean;
  onToggleTraceMode: () => void;
  onExportJson: () => void;
  onExportJpg: () => void;
  exportEnabled: boolean;
  exportStatus: "idle" | "exporting" | "done";
  exportFormat: "json" | "jpg" | null;
  searchQuery: string;
  onSearchQueryChange: (v: string) => void;
};

export function Topbar({
  projectName,
  workspaceRootName,
  workspaceFiles,
  activeFilePath,
  graphDepth,
  onPickFile,
  onGraphDepthChange,
  onRefresh,
  onGenerate,
  onAutoLayout,
  traceMode,
  onToggleTraceMode,
  onExportJson,
  onExportJpg,
  exportEnabled,
  exportStatus,
  exportFormat,
  searchQuery,
  onSearchQueryChange,
}: Props) {
  const isExporting = exportStatus === "exporting";
  const isDone = exportStatus === "done";
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const exportRef = useRef<HTMLDivElement | null>(null);

  const closePicker = () => {
    setPickerOpen(false);
    setPickerQuery("");
  };

  const togglePicker = () => {
    if (pickerOpen) {
      closePicker();
      return;
    }

    setExportMenuOpen(false);
    setPickerOpen(true);
  };

  const closeExportMenu = () => {
    setExportMenuOpen(false);
  };

  const toggleExportMenu = () => {
    if (!exportEnabled || isExporting) return;
    if (exportMenuOpen) {
      closeExportMenu();
      return;
    }

    closePicker();
    setExportMenuOpen(true);
  };

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
    if (!pickerOpen && !exportMenuOpen) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (!pickerRef.current?.contains(target)) {
        closePicker();
      }

      if (!exportRef.current?.contains(target)) {
        closeExportMenu();
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePicker();
        closeExportMenu();
      }
    };

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [exportMenuOpen, pickerOpen]);

  return (
    <header className={["topbar", traceMode ? "topbar--traceOn" : ""].join(" ")}>
      <div className="topbarLeft">
        <div className="brand">
          <img
            className="brandLogoIcon logoLight"
            src={logoLightUrl}
            alt="Cogic"
          />
          <img
            className="brandLogoIcon logoDark"
            src={logoDarkUrl}
            alt="Cogic"
          />
          <h1 className="brandTitle">Cogic</h1>
        </div>

        <div className="projectPickerWrap" ref={pickerRef}>
          <button
            className={[
              "projectPicker",
              pickerOpen ? "projectPicker--open" : "",
            ].join(" ")}
            type="button"
            onClick={togglePicker}
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
                          closePicker();
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

        <label className="depthControl" title="How many additional external hops to preload into the graph">
          <select
            className="depthSelect"
            value={String(graphDepth)}
            onChange={(e) => onGraphDepthChange(Number(e.target.value))}
            aria-label="Graph depth"
          >
            <option value="0">0 · file only</option>
            <option value="1">1 · direct</option>
            <option value="2">2 · one more</option>
            <option value="3">3 · two more</option>
          </select>
        </label>

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

        <div className="exportMenuWrap" ref={exportRef}>
          <button
            className={[
              "iconBtn",
              !exportEnabled ? "iconBtn--disabled" : "",
              isExporting ? "iconBtn--busy" : "",
              exportMenuOpen ? "iconBtn--activeMenu" : "",
            ].join(" ")}
            title={
              isExporting
                ? `Exporting ${exportFormat?.toUpperCase() ?? "graph"}`
                : isDone
                ? "Export complete"
                : !exportEnabled
                ? "No graph to export"
                : "Export graph"
            }
            type="button"
            onClick={toggleExportMenu}
            aria-disabled={!exportEnabled || isExporting}
            aria-expanded={exportMenuOpen}
          >
            {isExporting ? (
              <Loader2 className="icon spin" />
            ) : (
              <Download className="icon" />
            )}
          </button>

          {exportMenuOpen ? (
            <div className="exportMenu">
              <button
                className="exportMenuItem"
                type="button"
                onClick={() => {
                  closeExportMenu();
                  onExportJson();
                }}
              >
                <span className="exportMenuItemTitle">JSON export</span>
                <span className="exportMenuItemMeta">.json</span>
              </button>
              <button
                className="exportMenuItem"
                type="button"
                onClick={() => {
                  closeExportMenu();
                  onExportJpg();
                }}
              >
                <span className="exportMenuItemTitle">JPG snapshot</span>
                <span className="exportMenuItemMeta">.jpg</span>
              </button>
            </div>
          ) : null}
        </div>

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
