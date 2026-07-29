"use client";

import {
  AudioLines,
  ExternalLink,
  File,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  Video,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import type {
  CreateDashboardTrainingContentRequest,
  DashboardTrainingContentDetailResponse,
  DashboardTrainingContentFocusTopic,
  TrainingContentType,
} from "@voicepractice/shared";

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
  focusTopics,
}: {
  orgId: string | null;
  focusTopics: DashboardTrainingContentFocusTopic[];
}) {
  const router = useRouter();
  const [contentType, setContentType] = useState<TrainingContentType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [focusTopicId, setFocusTopicId] = useState("");
  const [nativeBody, setNativeBody] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!contentType) {
      setError("Select a Training Content type.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const input: CreateDashboardTrainingContentRequest = {
        contentType,
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
      setError(caught instanceof Error ? caught.message : "Could not create Training Content.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="training-content-create" onSubmit={submit}>
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
                Focus Topic
                <select
                  className="text-input"
                  value={focusTopicId}
                  onChange={(event) => setFocusTopicId(event.target.value)}
                  disabled={saving}
                >
                  <option value="">General</option>
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
            <button type="submit" className="primary-button" disabled={saving}>
              {saving ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : null}
              {saving ? "Creating..." : "Create draft"}
            </button>
          </div>
        </>
      ) : null}
    </form>
  );
}
