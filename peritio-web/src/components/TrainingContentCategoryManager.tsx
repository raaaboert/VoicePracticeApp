"use client";

import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type {
  DashboardTrainingContentCategoriesResponse,
  DashboardTrainingContentCategory,
  DashboardTrainingContentCategoryMutationResponse,
} from "@voicepractice/shared";

import { UnsavedChangesDialog } from "@/src/components/UnsavedChangesDialog";
import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import { trainingContentOrgQuery } from "@/src/lib/trainingContentPresentation";

function withOrg(pathname: string, orgId: string | null): string {
  if (!orgId) {
    return pathname;
  }
  const separator = pathname.includes("?") ? "&" : "?";
  return `${pathname}${separator}orgId=${encodeURIComponent(orgId)}`;
}

function ids(categories: readonly DashboardTrainingContentCategory[]): string {
  return categories.map((category) => category.id).join("|");
}

export function TrainingContentCategoryManager({
  initialCategories,
  initialOrderRevision,
  orgId,
}: {
  initialCategories: DashboardTrainingContentCategory[];
  initialOrderRevision: string;
  orgId: string | null;
}) {
  const router = useRouter();
  const initialActive = initialCategories.filter((category) => !category.archivedAt);
  const [categories, setCategories] = useState(initialCategories);
  const [savedActiveIds, setSavedActiveIds] = useState(ids(initialActive));
  const [orderRevision, setOrderRevision] = useState(initialOrderRevision);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [archiveTarget, setArchiveTarget] =
    useState<DashboardTrainingContentCategory | null>(null);
  const [destinationCategoryId, setDestinationCategoryId] = useState("");
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const active = useMemo(
    () => categories.filter((category) => !category.archivedAt),
    [categories]
  );
  const archived = useMemo(
    () => categories.filter((category) => category.archivedAt),
    [categories]
  );
  const orderDirty = ids(active) !== savedActiveIds;
  const editDirty = editingId !== null && (() => {
    const current = categories.find((category) => category.id === editingId);
    return Boolean(
      current
      && (editName !== current.name || editDescription !== current.description)
    );
  })();
  const dirty = orderDirty || editDirty || Boolean(newName || newDescription);
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

  const clearNotices = () => {
    setError(null);
    setMessage(null);
  };

  const createCategory = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    clearNotices();
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentCategoryMutationResponse>(
        withOrg("/api/admin/training-content/categories", orgId),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName, description: newDescription }),
        }
      );
      setCategories((current) => [...current, response.category]);
      setSavedActiveIds((current) => `${current}${current ? "|" : ""}${response.category.id}`);
      setOrderRevision(response.orderRevision);
      setNewName("");
      setNewDescription("");
      setMessage("Content Category created.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create Content Category.");
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (category: DashboardTrainingContentCategory) => {
    setEditingId(category.id);
    setEditName(category.name);
    setEditDescription(category.description);
    clearNotices();
  };

  const saveEdit = async () => {
    const category = categories.find((entry) => entry.id === editingId);
    if (!category) {
      return;
    }
    setSaving(true);
    clearNotices();
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentCategoryMutationResponse>(
        withOrg(
          `/api/admin/training-content/categories/${encodeURIComponent(category.id)}`,
          orgId
        ),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: category.updatedAt,
            name: editName,
            description: editDescription,
          }),
        }
      );
      setCategories((current) =>
        current.map((entry) => entry.id === category.id ? response.category : entry)
      );
      setOrderRevision(response.orderRevision);
      setEditingId(null);
      setMessage("Content Category updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update Content Category.");
    } finally {
      setSaving(false);
    }
  };

  const moveCategory = (categoryId: string, direction: -1 | 1) => {
    const currentIndex = active.findIndex((category) => category.id === categoryId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= active.length) {
      return;
    }
    const reordered = [...active];
    [reordered[currentIndex], reordered[nextIndex]] = [
      reordered[nextIndex]!,
      reordered[currentIndex]!,
    ];
    setCategories([...reordered, ...archived]);
    clearNotices();
  };

  const saveOrder = async () => {
    setSaving(true);
    clearNotices();
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentCategoriesResponse>(
        withOrg("/api/admin/training-content/categories/reorder", orgId),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedOrderRevision: orderRevision,
            categoryIds: active.map((category) => category.id),
          }),
        }
      );
      setCategories([...response.categories, ...archived]);
      setSavedActiveIds(ids(response.categories));
      setOrderRevision(response.orderRevision);
      setMessage("Content Category order saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Content Category order.");
    } finally {
      setSaving(false);
    }
  };

  const beginArchive = (category: DashboardTrainingContentCategory) => {
    const defaultDestination = active.find(
      (entry) => entry.isDefault && entry.id !== category.id
    ) ?? active.find((entry) => entry.id !== category.id);
    setArchiveTarget(category);
    setDestinationCategoryId(defaultDestination?.id ?? "");
    clearNotices();
  };

  const archiveCategory = async () => {
    if (!archiveTarget || !destinationCategoryId) {
      return;
    }
    setSaving(true);
    clearNotices();
    try {
      const response = await fetchAdminApiJson<DashboardTrainingContentCategoryMutationResponse>(
        withOrg(
          `/api/admin/training-content/categories/${encodeURIComponent(archiveTarget.id)}/archive`,
          orgId
        ),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: archiveTarget.updatedAt,
            destinationCategoryId,
          }),
        }
      );
      setCategories((current) =>
        current.map((entry) => entry.id === archiveTarget.id ? response.category : entry)
      );
      setSavedActiveIds(ids(active.filter((entry) => entry.id !== archiveTarget.id)));
      setOrderRevision(response.orderRevision);
      setArchiveTarget(null);
      setMessage(
        `Content Category archived. ${response.movedItemCount ?? 0} item${
          response.movedItemCount === 1 ? "" : "s"
        } moved.`
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not archive Content Category.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="training-content-category-manager">
      <button
        className="training-content-back-link"
        type="button"
        onClick={requestNavigation}
        disabled={saving}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Learning Resources
      </button>

      {message ? <div className="notice success">{message}</div> : null}
      {error ? <div className="notice danger">{error}</div> : null}

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">New category</p>
            <h2>Add Content Category</h2>
          </div>
        </div>
        <form className="training-content-category-create" onSubmit={createCategory}>
          <label className="field-label">
            Name
            <input
              className="text-input"
              value={newName}
              maxLength={120}
              required
              disabled={saving}
              onChange={(event) => setNewName(event.target.value)}
            />
          </label>
          <label className="field-label">
            Description
            <input
              className="text-input"
              value={newDescription}
              maxLength={1000}
              disabled={saving}
              onChange={(event) => setNewDescription(event.target.value)}
            />
          </label>
          <button className="primary-button icon-text-button" type="submit" disabled={saving}>
            <Plus size={17} aria-hidden="true" />
            Add category
          </button>
        </form>
      </section>

      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Library organization</p>
            <h2>Active categories</h2>
          </div>
          <button
            className="primary-button icon-text-button"
            type="button"
            onClick={saveOrder}
            disabled={!orderDirty || saving}
          >
            {saving
              ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
              : <Check size={17} aria-hidden="true" />}
            Save order
          </button>
        </div>
        <div className="training-content-order-list">
          {active.map((category, index) => (
            <div key={category.id} className="training-content-order-row">
              {editingId === category.id ? (
                <div className="training-content-category-edit">
                  <label className="field-label">
                    Name
                    <input
                      className="text-input"
                      value={editName}
                      maxLength={120}
                      onChange={(event) => setEditName(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <label className="field-label">
                    Description
                    <input
                      className="text-input"
                      value={editDescription}
                      maxLength={1000}
                      onChange={(event) => setEditDescription(event.target.value)}
                      disabled={saving}
                    />
                  </label>
                  <div className="page-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={() => setEditingId(null)}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      className="primary-button"
                      type="button"
                      onClick={saveEdit}
                      disabled={saving || !editName.trim()}
                    >
                      Save changes
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="training-content-order-copy">
                    <strong>
                      {category.name}{category.isDefault ? " (Default)" : ""}
                    </strong>
                    {category.description ? <span>{category.description}</span> : null}
                    <small>
                      {category.activeItemCount} active
                      {" | "}
                      {category.archivedItemCount} archived
                    </small>
                  </div>
                  <div className="training-content-order-controls">
                    <button
                      className="icon-button"
                      type="button"
                      title={`Move ${category.name} up`}
                      aria-label={`Move ${category.name} up`}
                      onClick={() => moveCategory(category.id, -1)}
                      disabled={index === 0 || saving}
                    >
                      <ArrowUp size={17} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={`Move ${category.name} down`}
                      aria-label={`Move ${category.name} down`}
                      onClick={() => moveCategory(category.id, 1)}
                      disabled={index === active.length - 1 || saving}
                    >
                      <ArrowDown size={17} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button"
                      type="button"
                      title={`Edit ${category.name}`}
                      aria-label={`Edit ${category.name}`}
                      onClick={() => beginEdit(category)}
                      disabled={saving}
                    >
                      <Pencil size={17} aria-hidden="true" />
                    </button>
                    <button
                      className="icon-button danger-button"
                      type="button"
                      title={category.isDefault
                        ? "The default Content Category cannot be archived"
                        : orderDirty
                          ? "Save the category order before archiving"
                        : `Archive ${category.name}`}
                      aria-label={category.isDefault
                        ? "The default Content Category cannot be archived"
                        : orderDirty
                          ? "Save the category order before archiving"
                        : `Archive ${category.name}`}
                      onClick={() => beginArchive(category)}
                      disabled={category.isDefault || orderDirty || saving}
                    >
                      <Archive size={17} aria-hidden="true" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </section>

      {archived.length > 0 ? (
        <section className="training-content-band">
          <div className="section-header">
            <div>
              <p className="eyebrow">History</p>
              <h2>Archived categories</h2>
            </div>
          </div>
          <div className="training-content-archived-categories">
            {archived.map((category) => (
              <div key={category.id}>
                <strong>{category.name}</strong>
                <span>{category.archivedItemCount} archived items</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="training-content-sticky-actions">
        <button className="ghost-button" type="button" onClick={requestNavigation} disabled={saving}>
          Close
        </button>
      </div>

      {archiveTarget ? (
        <div className="confirmation-backdrop" role="presentation">
          <div
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="archive-category-title"
          >
            <div className="confirmation-dialog-header">
              <div>
                <h2 id="archive-category-title">Archive {archiveTarget.name}?</h2>
                <p>All active and archived content must move to another category.</p>
              </div>
              <button
                className="icon-button"
                type="button"
                title="Close"
                onClick={() => setArchiveTarget(null)}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </div>
            <label className="field-label">
              Move the content in this category to
              <select
                className="text-input"
                value={destinationCategoryId}
                onChange={(event) => setDestinationCategoryId(event.target.value)}
                disabled={saving}
              >
                {active
                  .filter((category) => category.id !== archiveTarget.id)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}{category.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
              </select>
            </label>
            <div className="confirmation-dialog-actions">
              <button
                className="ghost-button"
                type="button"
                onClick={() => setArchiveTarget(null)}
                disabled={saving}
              >
                Cancel
              </button>
              <button
                className="primary-button"
                type="button"
                onClick={archiveCategory}
                disabled={saving || !destinationCategoryId}
              >
                Archive category
              </button>
            </div>
          </div>
        </div>
      ) : null}

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
