"use client";

import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Search,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  DashboardTrainingContentCategory,
  DashboardTrainingContentFocusTopic,
  DashboardTrainingContentListItem,
  DashboardTrainingContentListResponse,
  TrainingContentType,
} from "@voicepractice/shared";

import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import { formatDateTime } from "@/src/lib/formatters";
import {
  trainingContentOrgQuery,
  trainingContentStatusLabel,
  trainingContentTypeLabel,
} from "@/src/lib/trainingContentPresentation";

const PAGE_SIZE = 10;

export interface TrainingContentLibraryFilters {
  q: string;
  categoryId: string;
  focusTopicId: string;
  contentType: string;
  status: string;
  sort: string;
}

interface CategoryState {
  open: boolean;
  page: number;
  response: DashboardTrainingContentListResponse | null;
  loading: boolean;
  error: string | null;
}

function defaultCategoryState(): CategoryState {
  return { open: false, page: 1, response: null, loading: false, error: null };
}

function isDefaultLibraryView(filters: TrainingContentLibraryFilters): boolean {
  return !filters.q.trim()
    && !filters.categoryId
    && !filters.focusTopicId
    && !filters.contentType
    && !filters.status
    && filters.sort === "library_order";
}

function listUrl(params: Record<string, string | number | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && String(value).trim()) {
      query.set(key, String(value));
    }
  }
  return `/api/admin/training-content?${query.toString()}`;
}

function showingRange(response: DashboardTrainingContentListResponse): string {
  if (response.total === 0) {
    return "Showing 0 of 0";
  }
  const first = (response.page - 1) * response.pageSize + 1;
  const last = Math.min(response.total, first + response.items.length - 1);
  return `Showing ${first}–${last} of ${response.total}`;
}

function fileLabel(item: DashboardTrainingContentListItem): string {
  if (item.currentAsset) {
    return `${item.currentAsset.originalFilename ?? "File"} (${item.currentAsset.uploadState})`;
  }
  return item.contentType === "native" || item.contentType === "external_url"
    ? "No file required"
    : "No ready file";
}

function ContentRows({
  items,
  orgId,
  showCategory,
}: {
  items: DashboardTrainingContentListItem[];
  orgId: string | null;
  showCategory: boolean;
}) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());

  const toggle = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return <div className="training-content-compact-list">
    {items.map((item) => {
      const open = expandedIds.has(item.id);
      const detailId = `training-content-${item.id}-details`;
      return <article key={item.id} className="training-content-compact-row">
        <div className="training-content-compact-row-main">
          <Link
            className="training-content-compact-title"
            href={`/app/admin/training-content/${encodeURIComponent(item.id)}${trainingContentOrgQuery(orgId)}`}
          >
            {item.title}
          </Link>
          <span className="training-content-compact-type">{trainingContentTypeLabel(item.contentType)}</span>
          <span className={`status-badge status-${item.publicationState}`}>
            {trainingContentStatusLabel(item.publicationState)}
          </span>
          {item.hasActiveVideoProcessing ? <span className="status-badge status-processing">Processing</span> : null}
          <time dateTime={item.updatedAt}>{formatDateTime(item.updatedAt)}</time>
          <button
            type="button"
            className="ghost-button compact-button training-content-row-toggle"
            aria-expanded={open}
            aria-controls={detailId}
            aria-label={`${open ? "Hide" : "Show"} details for ${item.title}`}
            onClick={() => toggle(item.id)}
          >
            <span>{open ? "Hide details" : "Details"}</span>
            {open ? <ChevronUp aria-hidden="true" size={17} /> : <ChevronDown aria-hidden="true" size={17} />}
          </button>
        </div>
        <div id={detailId} className="training-content-compact-details" hidden={!open}>
          {item.description ? <p>{item.description}</p> : <p className="muted-copy">No description provided.</p>}
          <dl>
            {showCategory ? <><dt>Content Category</dt><dd>{item.categoryName}</dd></> : null}
            <dt>Related Focus Topic</dt>
            <dd>{item.focusTopicName ?? "None"}{!item.focusTopicAvailable ? " (no longer available)" : ""}</dd>
            <dt>Availability</dt><dd>{item.assignmentSummary.label}</dd>
            <dt>File</dt><dd>{fileLabel(item)}</dd>
            {item.updatedByDisplayName ? <><dt>Updated by</dt><dd>{item.updatedByDisplayName}</dd></> : null}
          </dl>
        </div>
      </article>;
    })}
  </div>;
}

function Pagination({
  response,
  onPage,
  label,
}: {
  response: DashboardTrainingContentListResponse;
  onPage: (page: number) => void;
  label: string;
}) {
  if (response.totalPages <= 1) {
    return <p className="training-content-showing-count">{showingRange(response)}</p>;
  }
  return <nav className="training-content-pagination" aria-label={label}>
    <button type="button" className="ghost-button icon-text-button" disabled={response.page <= 1}
      onClick={() => onPage(response.page - 1)}>Previous</button>
    <span>{showingRange(response)} · Page {response.page} of {response.totalPages}</span>
    <button type="button" className="ghost-button icon-text-button" disabled={response.page >= response.totalPages}
      onClick={() => onPage(response.page + 1)}>Next</button>
  </nav>;
}

export function TrainingContentCategoryList({
  orgId,
  categories,
  focusTopics,
  initialFilters,
}: {
  orgId: string | null;
  categories: DashboardTrainingContentCategory[];
  focusTopics: DashboardTrainingContentFocusTopic[];
  initialFilters: TrainingContentLibraryFilters;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [flatPage, setFlatPage] = useState(1);
  const [flatResponse, setFlatResponse] = useState<DashboardTrainingContentListResponse | null>(null);
  const [flatLoading, setFlatLoading] = useState(false);
  const [flatError, setFlatError] = useState<string | null>(null);
  const [flatRetry, setFlatRetry] = useState(0);
  const [categoryStates, setCategoryStates] = useState<Record<string, CategoryState>>({});
  const categoryControllers = useRef(new Map<string, AbortController>());
  const categoryRequestIds = useRef(new Map<string, number>());
  const flatController = useRef<AbortController | null>(null);
  const flatRequestId = useRef(0);
  const defaultView = isDefaultLibraryView(filters);

  useEffect(() => {
    setFilters(initialFilters);
    setFlatPage(1);
    setFlatResponse(null);
    setFlatError(null);
    setCategoryStates({});
    for (const controller of categoryControllers.current.values()) controller.abort();
    categoryControllers.current.clear();
  }, [orgId, initialFilters]);

  const updateFilters = (patch: Partial<TrainingContentLibraryFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
    setFlatPage(1);
  };

  const loadCategory = useCallback(async (categoryId: string, page: number) => {
    categoryControllers.current.get(categoryId)?.abort();
    const controller = new AbortController();
    categoryControllers.current.set(categoryId, controller);
    const requestId = (categoryRequestIds.current.get(categoryId) ?? 0) + 1;
    categoryRequestIds.current.set(categoryId, requestId);
    setCategoryStates((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] ?? defaultCategoryState()),
        open: true,
        page,
        loading: true,
        error: null,
      },
    }));
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentListResponse>(listUrl({
        orgId,
        categoryId,
        sort: "library_order",
        page,
        pageSize: PAGE_SIZE,
      }), { signal: controller.signal });
      if (categoryRequestIds.current.get(categoryId) !== requestId) return;
      setCategoryStates((current) => ({
        ...current,
        [categoryId]: {
          ...(current[categoryId] ?? defaultCategoryState()),
          page: response.page,
          response,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      if (controller.signal.aborted || categoryRequestIds.current.get(categoryId) !== requestId) return;
      setCategoryStates((current) => ({
        ...current,
        [categoryId]: {
          ...(current[categoryId] ?? defaultCategoryState()),
          page,
          loading: false,
          error: error instanceof Error ? error.message : "Could not load this Content Category.",
        },
      }));
    }
  }, [orgId]);

  useEffect(() => {
    if (defaultView) {
      flatController.current?.abort();
      return;
    }
    flatController.current?.abort();
    const controller = new AbortController();
    flatController.current = controller;
    const requestId = flatRequestId.current + 1;
    flatRequestId.current = requestId;
    setFlatLoading(true);
    setFlatError(null);
    void fetchAdminApiJson<DashboardTrainingContentListResponse>(listUrl({
      orgId,
      ...filters,
      page: flatPage,
      pageSize: PAGE_SIZE,
    }), { signal: controller.signal }).then((response) => {
      if (flatRequestId.current !== requestId) return;
      setFlatResponse(response);
    }).catch((error: unknown) => {
      if (controller.signal.aborted || flatRequestId.current !== requestId) return;
      setFlatError(error instanceof Error ? error.message : "Could not load Learning Resources.");
      setFlatResponse(null);
    }).finally(() => {
      if (flatRequestId.current === requestId) setFlatLoading(false);
    });
    return () => controller.abort();
  }, [defaultView, filters, flatPage, flatRetry, orgId]);

  useEffect(() => {
    const query = new URLSearchParams();
    if (orgId) query.set("orgId", orgId);
    for (const [key, value] of Object.entries(filters)) {
      if (value && !(key === "sort" && value === "library_order")) query.set(key, value);
    }
    if (!defaultView && flatPage > 1) query.set("page", String(flatPage));
    const suffix = query.toString();
    window.history.replaceState(null, "", `/app/admin/training-content${suffix ? `?${suffix}` : ""}`);
  }, [defaultView, filters, flatPage, orgId]);

  const toggleCategory = (categoryId: string) => {
    const state = categoryStates[categoryId] ?? defaultCategoryState();
    if (state.open) {
      categoryControllers.current.get(categoryId)?.abort();
      categoryRequestIds.current.set(categoryId, (categoryRequestIds.current.get(categoryId) ?? 0) + 1);
      setCategoryStates((current) => ({ ...current, [categoryId]: { ...state, open: false } }));
      return;
    }
    if (state.response) {
      setCategoryStates((current) => ({ ...current, [categoryId]: { ...state, open: true } }));
      return;
    }
    void loadCategory(categoryId, state.page);
  };

  return <>
    <section className="training-content-band">
      <div className="training-content-filters" aria-label="Learning Resource filters">
        <label className="field-label training-content-search-field">Search
          <span className="input-with-icon"><Search size={17} aria-hidden="true" />
            <input className="text-input" value={filters.q} onChange={(event) => updateFilters({ q: event.target.value })}
              placeholder="Title, description, category, or Focus Topic" />
          </span>
        </label>
        <label className="field-label">Content Category
          <select className="text-input" value={filters.categoryId} onChange={(event) => updateFilters({ categoryId: event.target.value })}>
            <option value="">All Content Categories</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
          </select>
        </label>
        <label className="field-label">Related Focus Topic
          <select className="text-input" value={filters.focusTopicId} onChange={(event) => updateFilters({ focusTopicId: event.target.value })}>
            <option value="">All Focus Topics</option>
            {focusTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
          </select>
        </label>
        <label className="field-label">Type
          <select className="text-input" value={filters.contentType} onChange={(event) => updateFilters({ contentType: event.target.value })}>
            <option value="">All types</option>
            {(["native", "external_url", "video", "audio", "pdf", "docx", "image"] as TrainingContentType[])
              .map((type) => <option key={type} value={type}>{trainingContentTypeLabel(type)}</option>)}
          </select>
        </label>
        <label className="field-label">Status
          <select className="text-input" value={filters.status} onChange={(event) => updateFilters({ status: event.target.value })}>
            <option value="">Draft &amp; Published</option><option value="draft">Draft</option>
            <option value="published">Published</option><option value="archived">Archived</option>
          </select>
        </label>
        <label className="field-label">Sort
          <select className="text-input" value={filters.sort} onChange={(event) => updateFilters({ sort: event.target.value })}>
            <option value="library_order">Library order</option><option value="updated_desc">Recently updated</option>
            <option value="title_asc">Title A-Z</option>
          </select>
        </label>
        <div className="training-content-filter-actions">
          <button type="button" className="ghost-button" onClick={() => updateFilters({
            q: "", categoryId: "", focusTopicId: "", contentType: "", status: "", sort: "library_order",
          })}>Clear</button>
        </div>
      </div>
    </section>

    <section className="training-content-band">
      <div className="section-header"><div><p className="eyebrow">Library</p>
        <h2>{defaultView ? "Content Categories" : "Learning Resources"}</h2></div></div>
      {defaultView ? <div className="training-content-category-groups">
        {categories.map((category) => {
          const state = categoryStates[category.id] ?? defaultCategoryState();
          const contentId = `training-content-category-${category.id}`;
          return <section key={category.id} className="training-content-category-group" aria-labelledby={`${contentId}-heading`}>
            <div className="training-content-category-heading">
              <div><h3 id={`${contentId}-heading`}>{category.name}</h3>
                {category.description ? <p>{category.description}</p> : null}
                <span>{category.activeItemCount} active item{category.activeItemCount === 1 ? "" : "s"}</span>
              </div>
              <button type="button" className="ghost-button compact-button training-content-category-toggle"
                aria-expanded={state.open} aria-controls={`${contentId}-content`}
                aria-label={`${state.open ? "Collapse" : "Expand"} ${category.name}`}
                onClick={() => toggleCategory(category.id)}>
                <span>{state.open ? "Collapse" : "Expand"}</span>
                {state.open ? <ChevronDown aria-hidden="true" size={18} /> : <ChevronRight aria-hidden="true" size={18} />}
              </button>
            </div>
            <div id={`${contentId}-content`} className="training-content-category-body" hidden={!state.open}>
              {state.loading ? <p className="muted-copy training-content-loading"><LoaderCircle aria-hidden="true" size={18} /> Loading Learning Resources…</p> : null}
              {state.error ? <div className="notice" role="alert"><p>{state.error}</p>
                <button type="button" className="ghost-button" onClick={() => void loadCategory(category.id, state.page)}>Retry</button></div> : null}
              {state.response && !state.loading && !state.error ? <>
                {state.response.items.length === 0 ? <p className="muted-copy">No Learning Resources in this Content Category.</p>
                  : <ContentRows items={state.response.items} orgId={orgId} showCategory={false} />}
                <Pagination response={state.response} label={`${category.name} pages`} onPage={(page) => void loadCategory(category.id, page)} />
              </> : null}
            </div>
          </section>;
        })}
        {categories.length === 0 ? <div className="empty-state"><h3>No Content Categories</h3><p>Create a Content Category before adding Learning Resources.</p></div> : null}
      </div> : <>
        {flatLoading ? <p className="muted-copy training-content-loading"><LoaderCircle aria-hidden="true" size={18} /> Loading Learning Resources…</p> : null}
        {flatError ? <div className="notice" role="alert"><p>{flatError}</p>
          <button type="button" className="ghost-button" onClick={() => setFlatRetry((value) => value + 1)}>Retry</button></div> : null}
        {flatResponse && !flatLoading && !flatError ? <>
          {flatResponse.items.length === 0 ? <div className="empty-state"><h3>No Learning Resources found</h3><p>Adjust the current filters or add a new item.</p></div>
            : <ContentRows items={flatResponse.items} orgId={orgId} showCategory />}
          <Pagination response={flatResponse} label="Learning Resources pages" onPage={setFlatPage} />
        </> : null}
      </>}
    </section>
  </>;
}
