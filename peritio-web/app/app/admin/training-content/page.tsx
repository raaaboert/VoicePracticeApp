import {
  ArrowLeft,
  ArrowRight,
  FilePlus2,
  FolderCog,
  ListOrdered,
  Search,
} from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/src/components/PageHeader";
import { TrainingContentAdminNav } from "@/src/components/TrainingContentAdminNav";
import {
  DashboardApiError,
  DashboardSessionInvalidError,
  getDashboardTrainingContent,
  getDashboardTrainingContentCategories,
  getDashboardTrainingContentFocusTopics,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime } from "@/src/lib/formatters";
import {
  trainingContentOrgQuery,
  trainingContentStatusLabel,
  trainingContentTypeLabel,
} from "@/src/lib/trainingContentPresentation";
import type { DashboardTrainingContentListItem } from "@voicepractice/shared";

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function pageHref(
  params: Record<string, string>,
  page: number
): string {
  const query = new URLSearchParams(params);
  query.set("page", String(page));
  return `/app/admin/training-content?${query.toString()}`;
}

function ContentTable({
  items,
  orgId,
  showCategory,
}: {
  items: DashboardTrainingContentListItem[];
  orgId: string | null;
  showCategory: boolean;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table training-content-table">
        <thead>
          <tr>
            <th>Title</th>
            {showCategory ? <th>Content Category</th> : null}
            <th>Type</th>
            <th>Related Focus Topic</th>
            <th>Status</th>
            <th>Availability</th>
            <th>File</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id}>
              <td>
                <Link
                  className="table-primary-link"
                  href={`/app/admin/training-content/${encodeURIComponent(item.id)}${trainingContentOrgQuery(orgId)}`}
                >
                  {item.title}
                </Link>
                {item.description ? (
                  <span className="table-secondary-text">{item.description}</span>
                ) : null}
              </td>
              {showCategory ? <td>{item.categoryName}</td> : null}
              <td>{trainingContentTypeLabel(item.contentType)}</td>
              <td>
                {item.focusTopicName ?? "None"}
                {!item.focusTopicAvailable ? (
                  <span className="table-secondary-text">No longer available</span>
                ) : null}
              </td>
              <td>
                <span className={`status-badge status-${item.publicationState}`}>
                  {trainingContentStatusLabel(item.publicationState)}
                </span>
              </td>
              <td>{item.assignmentSummary.label}</td>
              <td>
                {item.hasActiveVideoProcessing ? (
                  <span className="status-badge status-processing">Processing</span>
                ) : null}
                <span className={item.hasActiveVideoProcessing ? "table-secondary-text" : undefined}>
                  {item.currentAsset
                    ? `${item.currentAsset.originalFilename ?? "File"} (${item.currentAsset.uploadState})`
                    : item.contentType === "native" || item.contentType === "external_url"
                      ? "-"
                      : "No ready file"}
                </span>
              </td>
              <td>
                {formatDateTime(item.updatedAt)}
                {item.updatedByDisplayName ? (
                  <span className="table-secondary-text">{item.updatedByDisplayName}</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function TrainingContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const orgId = single(raw.orgId).trim() || null;
  const q = single(raw.q);
  const categoryId = single(raw.categoryId);
  const focusTopicId = single(raw.focusTopicId);
  const contentType = single(raw.contentType);
  const status = single(raw.status);
  const sort = single(raw.sort) || "library_order";
  const page = single(raw.page) || "1";

  let payload;
  let topicsPayload;
  let categoriesPayload;
  try {
    [payload, topicsPayload, categoriesPayload] = await Promise.all([
      getDashboardTrainingContent({
        orgId,
        q,
        categoryId,
        focusTopicId,
        contentType,
        status,
        sort,
        page,
        pageSize: 100,
      }),
      getDashboardTrainingContentFocusTopics(orgId),
      getDashboardTrainingContentCategories(orgId),
    ]);
  } catch (error) {
    if (error instanceof DashboardSessionInvalidError) {
      redirect(buildDashboardSessionResetPath());
    }
    if (
      error instanceof DashboardApiError
      && ["module_disabled", "dashboard_scope_denied"].includes(error.code ?? "")
    ) {
      redirect("/app/access-denied");
    }
    throw error;
  }

  const queryState: Record<string, string> = {};
  for (const [key, value] of Object.entries({
    orgId: orgId ?? "",
    q,
    categoryId,
    focusTopicId,
    contentType,
    status,
    sort,
  })) {
    if (value) {
      queryState[key] = value;
    }
  }
  const grouped = !q
    && !categoryId
    && !focusTopicId
    && !contentType
    && !status
    && sort === "library_order";

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Learning Resources"
        description={`Manage learning resources for ${payload.org.name}.`}
        actions={
          <div className="page-actions training-content-page-actions">
            <Link
              className="ghost-button icon-text-button"
              href={`/app/admin/training-content/categories${trainingContentOrgQuery(orgId)}`}
            >
              <FolderCog size={18} aria-hidden="true" />
              Manage Categories
            </Link>
            <Link
              className="ghost-button icon-text-button"
              href={`/app/admin/training-content/reorder${trainingContentOrgQuery(orgId)}`}
            >
              <ListOrdered size={18} aria-hidden="true" />
              Reorder Content
            </Link>
            <Link
              className="primary-button icon-text-button"
              href={`/app/admin/training-content/new${trainingContentOrgQuery(orgId)}`}
            >
              <FilePlus2 size={18} aria-hidden="true" />
              Add Learning Resource
            </Link>
          </div>
        }
      />
      <TrainingContentAdminNav orgId={orgId} active="training-content" />

      <section className="training-content-band">
        <form className="training-content-filters" action="/app/admin/training-content" method="get">
          {orgId ? <input type="hidden" name="orgId" value={orgId} /> : null}
          <label className="field-label training-content-search-field">
            Search
            <span className="input-with-icon">
              <Search size={17} aria-hidden="true" />
              <input
                className="text-input"
                name="q"
                defaultValue={q}
                placeholder="Title, description, category, or Focus Topic"
              />
            </span>
          </label>
          <label className="field-label">
            Content Category
            <select className="text-input" name="categoryId" defaultValue={categoryId}>
              <option value="">All Content Categories</option>
              {categoriesPayload.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Related Focus Topic
            <select className="text-input" name="focusTopicId" defaultValue={focusTopicId}>
              <option value="">All Focus Topics</option>
              {topicsPayload.focusTopics.map((topic) => (
                <option key={topic.id} value={topic.id}>
                  {topic.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            Type
            <select className="text-input" name="contentType" defaultValue={contentType}>
              <option value="">All types</option>
              {(["native", "external_url", "video", "audio", "pdf", "docx", "image"] as const)
                .map((type) => (
                  <option key={type} value={type}>
                    {trainingContentTypeLabel(type)}
                  </option>
                ))}
            </select>
          </label>
          <label className="field-label">
            Status
            <select className="text-input" name="status" defaultValue={status}>
              <option value="">Draft &amp; Published</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="archived">Archived</option>
            </select>
          </label>
          <label className="field-label">
            Sort
            <select className="text-input" name="sort" defaultValue={sort}>
              <option value="library_order">Library order</option>
              <option value="updated_desc">Recently updated</option>
              <option value="title_asc">Title A-Z</option>
            </select>
          </label>
          <div className="training-content-filter-actions">
            <button className="primary-button" type="submit">Apply</button>
            <Link
              className="ghost-button"
              href={`/app/admin/training-content${trainingContentOrgQuery(orgId)}`}
            >
              Clear
            </Link>
          </div>
        </form>
      </section>

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Library</p>
            <h2>{payload.total} item{payload.total === 1 ? "" : "s"}</h2>
          </div>
        </div>
        {payload.items.length === 0 ? (
          <div className="empty-state">
            <h3>No Learning Resources found</h3>
            <p>Adjust the current filters or add a new item.</p>
          </div>
        ) : grouped ? (
          <div className="training-content-category-groups">
            {categoriesPayload.categories.map((category) => {
              const items = payload.items.filter((item) => item.categoryId === category.id);
              return (
                <section key={category.id} className="training-content-category-group">
                  <div className="training-content-category-heading">
                    <div>
                      <h3>{category.name}</h3>
                      {category.description ? <p>{category.description}</p> : null}
                    </div>
                    <span>{category.activeItemCount} item{category.activeItemCount === 1 ? "" : "s"}</span>
                  </div>
                  {items.length > 0
                    ? <ContentTable items={items} orgId={orgId} showCategory={false} />
                    : <p className="muted-copy">No active items in this category.</p>}
                </section>
              );
            })}
          </div>
        ) : (
          <ContentTable items={payload.items} orgId={orgId} showCategory />
        )}

        {payload.totalPages > 1 ? (
          <nav className="training-content-pagination" aria-label="Learning Resources pages">
            {payload.page > 1 ? (
              <Link className="icon-text-button" href={pageHref(queryState, payload.page - 1)}>
                <ArrowLeft size={17} aria-hidden="true" />
                Previous
              </Link>
            ) : <span />}
            <span>Page {payload.page} of {payload.totalPages}</span>
            {payload.page < payload.totalPages ? (
              <Link className="icon-text-button" href={pageHref(queryState, payload.page + 1)}>
                Next
                <ArrowRight size={17} aria-hidden="true" />
              </Link>
            ) : <span />}
          </nav>
        ) : null}
      </section>
    </>
  );
}
