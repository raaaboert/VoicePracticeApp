"use client";

import {
  ArrowLeft,
  AudioLines,
  ExternalLink,
  File,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Video,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import type {
  CreateDashboardTrainingContentRequest,
  DashboardTrainingContentCategory,
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentFocusTopic,
  DashboardTrainingContentScenarioOption,
  TrainingContentType,
} from "@voicepractice/shared";

import { UnsavedChangesDialog } from "@/src/components/UnsavedChangesDialog";
import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import {
  trainingContentOrgQuery,
  trainingContentTypeLabel,
} from "@/src/lib/trainingContentPresentation";

const CONTENT_TYPES: Array<{
  value: TrainingContentType;
  description: string;
  icon: typeof FileText;
}> = [
  { value: "native", description: "Write and preview Markdown content.", icon: FileText },
  { value: "external_url", description: "Link to a secure external resource.", icon: ExternalLink },
  { value: "video", description: "Upload an MP4 video.", icon: Video },
  { value: "audio", description: "Upload an MP3 or M4A recording.", icon: AudioLines },
  { value: "pdf", description: "Upload a PDF document.", icon: File },
  { value: "docx", description: "Upload a DOCX document.", icon: FileText },
  { value: "image", description: "Upload a JPG, PNG, or WebP image.", icon: ImageIcon },
];

export function TrainingContentCreateForm({
  orgId,
  categories,
  focusTopics,
  scenarioOptions: _scenarioOptions,
}: {
  orgId: string | null;
  categories: DashboardTrainingContentCategory[];
  focusTopics: DashboardTrainingContentFocusTopic[];
  scenarioOptions: DashboardTrainingContentScenarioOption[];
}) {
  const router = useRouter();
  const defaultCategoryId = categories.find((category) => category.isDefault)?.id
    ?? categories[0]?.id
    ?? "";
  const [contentType, setContentType] = useState<TrainingContentType | null>(null);
  const [categoryId, setCategoryId] = useState(defaultCategoryId);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [focusTopicId, setFocusTopicId] = useState("");
  const [nativeBody, setNativeBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);
  const listPath = `/app/admin/training-content${trainingContentOrgQuery(orgId)}`;
  const dirty = Boolean(
    contentType
    || title
    || description
    || focusTopicId
    || nativeBody
    || externalUrl
    || categoryId !== defaultCategoryId
  );

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  const navigateAway = () => {
    if (dirty) {
      setPendingNavigation(listPath);
      return;
    }
    router.push(listPath);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!contentType) {
      setError("Select a Learning Resource type.");
      return;
    }
    if (!categoryId) {
      setError("Select a Content Category.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CreateDashboardTrainingContentRequest = {
        contentType,
        categoryId,
        title,
        description,
        focusTopicId: focusTopicId || null,
      };
      if (contentType === "native") {
        input.nativeBody = nativeBody || null;
      }
      if (contentType === "external_url") {
        input.externalUrl = externalUrl || null;
      }
      const response = await fetchAdminApiJson<DashboardTrainingContentDetailResponse>(
        `/api/admin/training-content${trainingContentOrgQuery(orgId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
        }
      );
      router.push(
        `/app/admin/training-content/${encodeURIComponent(response.item.id)}${trainingContentOrgQuery(orgId)}`
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create Learning Resource.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="training-content-create" onSubmit={submit}>
      <button
        className="training-content-back-link"
        type="button"
        onClick={navigateAway}
        disabled={saving}
      >
        <ArrowLeft size={17} aria-hidden="true" />
        Back to Learning Resources
      </button>
      <section className="training-content-band">
        <div className="section-header">
          <div>
            <p className="eyebrow">Content type</p>
            <h2>Select a format</h2>
          </div>
        </div>
        <div className="training-content-type-grid" role="radiogroup" aria-label="Content type">
          {CONTENT_TYPES.map((option) => {
            const Icon = option.icon;
            const selected = contentType === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`training-content-type-option${selected ? " selected" : ""}`}
                onClick={() => setContentType(option.value)}
                disabled={saving}
              >
                <Icon size={20} aria-hidden="true" />
                <span>
                  <strong>{trainingContentTypeLabel(option.value)}</strong>
                  <small>{option.description}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {contentType ? (
        <>
          <section className="training-content-band">
            <div className="section-header">
              <div>
                <p className="eyebrow">Basic information</p>
                <h2>Content details</h2>
              </div>
            </div>
            <div className="training-content-form-grid">
              <label className="field-label full-span">
                Title
                <input
                  className="text-input"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  maxLength={200}
                  required
                  disabled={saving}
                />
              </label>
              <label className="field-label full-span">
                Description
                <textarea
                  className="text-input training-content-description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={2000}
                  disabled={saving}
                />
              </label>
              <label className="field-label">
                Content Category
                <select
                  className="text-input"
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                  required
                  disabled={saving}
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}{category.isDefault ? " (Default)" : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field-label">
                Related Focus Topic
                <select
                  className="text-input"
                  value={focusTopicId}
                  onChange={(event) => setFocusTopicId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">None</option>
                  {focusTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          {contentType === "native" ? (
            <section className="training-content-band">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Content</p>
                  <h2>Native content</h2>
                </div>
              </div>
              <label className="field-label">
                Markdown
                <textarea
                  className="text-input training-content-native-editor"
                  value={nativeBody}
                  onChange={(event) => setNativeBody(event.target.value)}
                  disabled={saving}
                />
              </label>
            </section>
          ) : null}

          {contentType === "external_url" ? (
            <section className="training-content-band">
              <div className="section-header">
                <div>
                  <p className="eyebrow">Content</p>
                  <h2>External resource</h2>
                </div>
              </div>
              <label className="field-label">
                HTTPS URL
                <input
                  className="text-input"
                  type="url"
                  inputMode="url"
                  placeholder="https://"
                  value={externalUrl}
                  onChange={(event) => setExternalUrl(event.target.value)}
                  disabled={saving}
                />
              </label>
            </section>
          ) : null}

          {error ? <div className="notice danger">{error}</div> : null}
          <div className="training-content-sticky-actions">
            <button
              type="button"
              className="ghost-button"
              onClick={navigateAway}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}
              {saving ? "Creating..." : "Create draft"}
            </button>
          </div>
        </>
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
    </form>
  );
}
