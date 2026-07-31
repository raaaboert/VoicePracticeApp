"use client";

import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  LoaderCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type {
  DashboardTrainingContentOrderGroup,
  DashboardTrainingContentOrderResponse,
} from "@voicepractice/shared";

import { UnsavedChangesDialog } from "@/src/components/UnsavedChangesDialog";
import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import {
  trainingContentOrgQuery,
  trainingContentStatusLabel,
} from "@/src/lib/trainingContentPresentation";

function cloneGroups(
  groups: readonly DashboardTrainingContentOrderGroup[]
): DashboardTrainingContentOrderGroup[] {
  return groups.map((group) => ({
    ...group,
    items: group.items.map((item) => ({ ...item })),
  }));
}

function orderKey(groups: readonly DashboardTrainingContentOrderGroup[]): string {
  return groups
    .map((group) => `${group.categoryId}:${group.items.map((item) => item.id).join(",")}`)
    .join("|");
}

function withOrg(pathname: string, orgId: string | null): string {
  return orgId
    ? `${pathname}?orgId=${encodeURIComponent(orgId)}`
    : pathname;
}

export function TrainingContentReorder({
  initialGroups,
  initialOrderRevision,
  orgId,
}: {
  initialGroups: DashboardTrainingContentOrderGroup[];
  initialOrderRevision: string;
  orgId: string | null;
}) {
  const router = useRouter();
  const [groups, setGroups] = useState(() => cloneGroups(initialGroups));
  const [savedGroups, setSavedGroups] = useState(() => cloneGroups(initialGroups));
  const [savedOrderKey, setSavedOrderKey] = useState(() => orderKey(initialGroups));
  const [orderRevision, setOrderRevision] = useState(initialOrderRevision);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const dirty = orderKey(groups) !== savedOrderKey;
  const listPath = `/app/admin/training-content${trainingContentOrgQuery(orgId)}`;

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const requestNavigation = () => {
    if (dirty) {
      setPendingNavigation(listPath);
      return;
    }
    router.push(listPath);
  };

  const moveWithinCategory = (
    categoryId: string,
    itemId: string,
    direction: -1 | 1
  ) => {
    setGroups((current) => current.map((group) => {
      if (group.categoryId !== categoryId) {
        return group;
      }
      const index = group.items.findIndex((item) => item.id === itemId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= group.items.length) {
        return group;
      }
      const items = [...group.items];
      [items[index], items[nextIndex]] = [items[nextIndex]!, items[index]!];
      return { ...group, items };
    }));
    setError(null);
    setMessage(null);
  };

  const moveToCategory = (
    sourceCategoryId: string,
    itemId: string,
    destinationCategoryId: string
  ) => {
    if (sourceCategoryId === destinationCategoryId) {
      return;
    }
    setGroups((current) => {
      const item = current
        .find((group) => group.categoryId === sourceCategoryId)
        ?.items.find((entry) => entry.id === itemId);
      if (!item) {
        return current;
      }
      return current.map((group) => {
        if (group.categoryId === sourceCategoryId) {
          return {
            ...group,
            items: group.items.filter((entry) => entry.id !== itemId),
          };
        }
        if (group.categoryId === destinationCategoryId) {
          return {
            ...group,
            items: [...group.items, { ...item, categoryId: destinationCategoryId }],
          };
        }
        return group;
      });
    });
    setError(null);
    setMessage(null);
  };

  const saveOrder = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentOrderResponse>(
        withOrg("/api/admin/training-content/reorder", orgId),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedOrderRevision: orderRevision,
            categories: groups.map((group) => ({
              categoryId: group.categoryId,
              contentIds: group.items.map((item) => item.id),
            })),
          }),
        }
      );
      const next = cloneGroups(response.groups);
      setGroups(next);
      setSavedGroups(cloneGroups(next));
      setSavedOrderKey(orderKey(next));
      setOrderRevision(response.orderRevision);
      setMessage("Training Content order saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Training Content order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="training-content-reorder">
      <button
        className="training-content-back-link"
        type="button"
        onClick={requestNavigation}
        disabled={saving}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Training Content
      </button>

      {message ? <div className="notice success">{message}</div> : null}
      {error ? <div className="notice danger">{error}</div> : null}

      <div className="training-content-category-groups">
        {groups.map((group) => (
          <section key={group.categoryId} className="training-content-category-group">
            <div className="training-content-category-heading">
              <h2>{group.categoryName}</h2>
              <span>{group.items.length} item{group.items.length === 1 ? "" : "s"}</span>
            </div>
            {group.items.length === 0 ? (
              <p className="muted-copy">No active items in this category.</p>
            ) : (
              <div className="training-content-order-list">
                {group.items.map((item, index) => (
                  <div key={item.id} className="training-content-order-row">
                    <div className="training-content-order-copy">
                      <strong>{item.title}</strong>
                      <small>{trainingContentStatusLabel(item.publicationState)}</small>
                    </div>
                    <div className="training-content-order-controls">
                      <button
                        className="icon-button"
                        type="button"
                        title={`Move ${item.title} up`}
                        aria-label={`Move ${item.title} up`}
                        onClick={() => moveWithinCategory(group.categoryId, item.id, -1)}
                        disabled={index === 0 || saving}
                      >
                        <ArrowUp size={17} aria-hidden="true" />
                      </button>
                      <button
                        className="icon-button"
                        type="button"
                        title={`Move ${item.title} down`}
                        aria-label={`Move ${item.title} down`}
                        onClick={() => moveWithinCategory(group.categoryId, item.id, 1)}
                        disabled={index === group.items.length - 1 || saving}
                      >
                        <ArrowDown size={17} aria-hidden="true" />
                      </button>
                      <label className="training-content-move-select">
                        <span>Move to category</span>
                        <select
                          className="text-input"
                          value={group.categoryId}
                          onChange={(event) =>
                            moveToCategory(group.categoryId, item.id, event.target.value)
                          }
                          disabled={saving}
                          aria-label={`Move ${item.title} to category`}
                        >
                          {groups.map((option) => (
                            <option key={option.categoryId} value={option.categoryId}>
                              {option.categoryName}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>

      <div className="training-content-sticky-actions training-content-editor-actions">
        <button
          className="ghost-button"
          type="button"
          onClick={() => {
            setGroups(cloneGroups(savedGroups));
            setMessage(null);
            setError(null);
          }}
          disabled={!dirty || saving}
        >
          Cancel changes
        </button>
        <div className="page-actions">
          <button className="ghost-button" type="button" onClick={requestNavigation} disabled={saving}>
            Close
          </button>
          <button
            className="primary-button icon-text-button"
            type="button"
            onClick={saveOrder}
            disabled={!dirty || saving}
          >
            {saving
              ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
              : <Check size={17} aria-hidden="true" />}
            Save order
          </button>
        </div>
      </div>

      <UnsavedChangesDialog
        open={pendingNavigation !== null}
        onStay={() => setPendingNavigation(null)}
        onLeave={() => {
          const destination = pendingNavigation;
          setPendingNavigation(null);
          if (destination) {
            router.push(destination);
          }
        }}
      />
    </div>
  );
}
