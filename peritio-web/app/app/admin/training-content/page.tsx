import {
  ArrowLeft,
  ArrowRight,
  FilePlus2,
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
  getDashboardTrainingContentFocusTopics,
} from "@/src/lib/auth";
import { buildDashboardSessionResetPath } from "@/src/lib/dashboardSession";
import { formatDateTime } from "@/src/lib/formatters";
import {
  trainingContentOrgQuery,
  trainingContentStatusLabel,
  trainingContentTypeLabel,
} from "@/src/lib/trainingContentPresentation";

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

export default async function TrainingContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const orgId = single(raw.orgId).trim() || null;
  const q = single(raw.q);
  const focusTopicId = single(raw.focusTopicId);
  const contentType = single(raw.contentType);
  const status = single(raw.status);
  const sort = single(raw.sort) || "updated_desc";
  const page = single(raw.page) || "1";

  let payload;
  let topicsPayload;
  try {
    [payload, topicsPayload] = await Promise.all([
      getDashboardTrainingContent({
        orgId,
        q,
        focusTopicId,
        contentType,
        status,
        sort,
        page,
        pageSize: 25,
      }),
      getDashboardTrainingContentFocusTopics(orgId),
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
    focusTopicId,
    contentType,
    status,
    sort,
  })) {
    if (value) {
      queryState[key] = value;
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Admin"
        title="Training Content"
        description={`Manage learning resources for ${payload.org.name}.`}
        actions={
          <Link
            className="primary-button icon-text-button"
            href={`/app/admin/training-content/new${trainingContentOrgQuery(orgId)}`}
          >
            <FilePlus2 size={18} aria-hidden="true" />
            Add Training Content
          </Link>
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
                placeholder="Title, description, or Focus Topic"
              />
            </span>
          </label>
          <label className="field-label">
            Focus Topic
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
            <h3>No Training Content found</h3>
            <p>Adjust the current filters or add a new item.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="data-table training-content-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Type</th>
                  <th>Focus Topic</th>
                  <th>Status</th>
                  <th>Availability</th>
                  <th>File</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {payload.items.map((item) => (
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
                    <td>{trainingContentTypeLabel(item.contentType)}</td>
                    <td>
                      {item.focusTopicName ?? "General"}
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
                      {item.currentAsset
                        ? `${item.currentAsset.originalFilename ?? "File"} (${item.currentAsset.uploadState})`
                        : item.contentType === "native" || item.contentType === "external_url"
                          ? "-"
                          : "No ready file"}
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
        )}

        {payload.totalPages > 1 ? (
          <nav className="training-content-pagination" aria-label="Training Content pages">
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
