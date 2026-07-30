export interface VideoDiagnosticSnapshot {
  sourceLoadFired: boolean;
  trackCount: number;
  reportedWidth: number | null;
  reportedHeight: number | null;
  calculatedAspectRatio: number;
  wrapperWidth: number | null;
  wrapperHeight: number | null;
  wrapperPageY: number | null;
  videoViewWidth: number | null;
  videoViewHeight: number | null;
  diagnosticPanelPageY: number | null;
  sourceLoadBeforeFirstFrame: boolean | null;
}

export interface VideoDiagnosticRow {
  label: string;
  value: string;
}

export function createInitialVideoDiagnosticSnapshot(
  fallbackAspectRatio: number
): VideoDiagnosticSnapshot {
  return {
    sourceLoadFired: false,
    trackCount: 0,
    reportedWidth: null,
    reportedHeight: null,
    calculatedAspectRatio: fallbackAspectRatio,
    wrapperWidth: null,
    wrapperHeight: null,
    wrapperPageY: null,
    videoViewWidth: null,
    videoViewHeight: null,
    diagnosticPanelPageY: null,
    sourceLoadBeforeFirstFrame: null,
  };
}

function formatDimension(value: number | null): string {
  return value !== null && Number.isFinite(value) && value >= 0
    ? String(Math.round(value))
    : "Pending";
}

function formatAspectRatio(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "Pending";
  }
  return String(Math.round(value * 10_000) / 10_000);
}

function formatPosition(value: number | null): string {
  return value !== null && Number.isFinite(value)
    ? String(Math.round(value))
    : "Pending";
}

export function buildVideoDiagnosticRows(
  platform: string,
  activeAspectRatio: number,
  snapshot: VideoDiagnosticSnapshot
): VideoDiagnosticRow[] {
  return [
    { label: "Platform", value: platform },
    {
      label: "SourceLoad fired",
      value: snapshot.sourceLoadFired ? "Yes" : "No",
    },
    { label: "Track count", value: String(snapshot.trackCount) },
    {
      label: "Reported video width",
      value: formatDimension(snapshot.reportedWidth),
    },
    {
      label: "Reported video height",
      value: formatDimension(snapshot.reportedHeight),
    },
    {
      label: "Calculated aspect ratio",
      value: formatAspectRatio(snapshot.calculatedAspectRatio),
    },
    {
      label: "Active aspect ratio",
      value: formatAspectRatio(activeAspectRatio),
    },
    {
      label: "Wrapper width",
      value: formatDimension(snapshot.wrapperWidth),
    },
    {
      label: "Wrapper height",
      value: formatDimension(snapshot.wrapperHeight),
    },
    {
      label: "Wrapper pageY (screen)",
      value: formatPosition(snapshot.wrapperPageY),
    },
    {
      label: "VideoView width",
      value: formatDimension(snapshot.videoViewWidth),
    },
    {
      label: "VideoView height",
      value: formatDimension(snapshot.videoViewHeight),
    },
    {
      label: "Diagnostic panel pageY (screen)",
      value: formatPosition(snapshot.diagnosticPanelPageY),
    },
    {
      label: "SourceLoad before first frame",
      value:
        snapshot.sourceLoadBeforeFirstFrame === null
          ? "Pending"
          : snapshot.sourceLoadBeforeFirstFrame
            ? "Yes"
            : "No",
    },
  ];
}
