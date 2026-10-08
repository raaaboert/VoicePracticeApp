"use client";

import { ArrowDown, ArrowUp, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { OrgTrainingListResponse, OrgTrainingSummary } from "@voicepractice/shared";

import { fetchAdminApiJson } from "@/src/lib/adminApiClient";
import {
  buildFocusTopicOrderRequest,
  moveActiveFocusTopic,
  projectActiveFocusTopicOrder,
  projectInactiveFocusTopics,
} from "@/src/lib/contentOrganizationOrdering";

function orderKey(items: readonly { id: string }[]): string {
  return items.map((item) => item.id).join("|");
}

function OrderList<T extends { id: string }>({
  items,
  label,
  describe,
  saving,
  onMove,
}: {
  items: readonly T[];
  label: (item: T) => string;
  describe: (item: T, index: number) => string;
  saving: boolean;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  if (items.length === 0) return <p className="muted-copy">Nothing is available to order.</p>;
  return (
    <div className="training-content-order-list">
      {items.map((item, index) => {
        const itemLabel = label(item);
        return (
          <div className="training-content-order-row" key={item.id}>
            <div className="training-content-order-copy">
              <strong>{itemLabel}</strong>
              <small>{describe(item, index)}</small>
            </div>
            <div className="training-content-order-controls">
              <button
                className="icon-button"
                type="button"
                title={`Move ${itemLabel} up`}
                aria-label={`Move ${itemLabel} up`}
                onClick={() => onMove(item.id, -1)}
                disabled={index === 0 || saving}
              >
                <ArrowUp size={17} aria-hidden="true" />
              </button>
              <button
                className="icon-button"
                type="button"
                title={`Move ${itemLabel} down`}
                aria-label={`Move ${itemLabel} down`}
                onClick={() => onMove(item.id, 1)}
                disabled={index === items.length - 1 || saving}
              >
                <ArrowDown size={17} aria-hidden="true" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ContentOrganizationManager({
  orgId,
  initialFocusTopics,
  initialFocusTopicOrderRevision,
}: {
  orgId: string;
  initialFocusTopics: OrgTrainingSummary[];
  initialFocusTopicOrderRevision: string;
}) {
  const initialActiveFocusTopics = projectActiveFocusTopicOrder(initialFocusTopics);
  const [focusTopicRecords, setFocusTopicRecords] = useState(initialFocusTopics);
  const [focusTopics, setFocusTopics] = useState(initialActiveFocusTopics);
  const [savedFocusTopicKey, setSavedFocusTopicKey] = useState(orderKey(initialActiveFocusTopics));
  const [focusTopicRevision, setFocusTopicRevision] = useState(initialFocusTopicOrderRevision);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusTopicsDirty = orderKey(focusTopics) !== savedFocusTopicKey;
  const inactiveFocusTopics = projectInactiveFocusTopics(focusTopicRecords);

  useEffect(() => {
    const activeTopics = projectActiveFocusTopicOrder(initialFocusTopics);
    setFocusTopicRecords(initialFocusTopics);
    setFocusTopics(activeTopics);
    setSavedFocusTopicKey(orderKey(activeTopics));
    setFocusTopicRevision(initialFocusTopicOrderRevision);
  }, [initialFocusTopics, initialFocusTopicOrderRevision]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (focusTopicsDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [focusTopicsDirty]);

  const saveFocusTopics = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetchAdminApiJson<OrgTrainingListResponse>(
        `/api/admin/content-organization/focus-topics?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildFocusTopicOrderRequest(focusTopics, focusTopicRevision)),
        }
      );
      const activeTopics = projectActiveFocusTopicOrder(response.trainings);
      setFocusTopicRecords(response.trainings);
      setFocusTopics(activeTopics);
      setSavedFocusTopicKey(orderKey(activeTopics));
      setFocusTopicRevision(response.orderRevision);
      setMessage("Focus Topic order saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Focus Topic order.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack content-organization-manager">
      {message ? <div className="notice success" role="status">{message}</div> : null}
      {error ? <div className="notice danger" role="alert">{error}</div> : null}

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Learner discovery</p>
            <h2>Focus Topics</h2>
            <p className="muted-copy">Set the company order used by learner Focus Topic discovery and Setup.</p>
          </div>
          <button
            className="primary-button icon-text-button"
            type="button"
            onClick={saveFocusTopics}
            disabled={!focusTopicsDirty || saving}
          >
            {saving
              ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
              : <Check size={17} aria-hidden="true" />}
            Save company order
          </button>
        </div>
        <OrderList
          items={focusTopics}
          label={(topic) => topic.name}
          describe={(_topic, index) => `Position ${index + 1}`}
          saving={saving}
          onMove={(id, direction) => {
            setFocusTopics((current) => moveActiveFocusTopic(current, id, direction));
            setMessage(null);
            setError(null);
          }}
        />
        {inactiveFocusTopics.length > 0 ? (
          <div className="content-organization-inactive-topics">
            <h3>Inactive Focus Topics</h3>
            <p className="muted-copy">Draft and archived topics are not part of company order.</p>
            <div className="training-content-order-list">
              {inactiveFocusTopics.map((topic) => (
                <div className="training-content-order-row" key={topic.id}>
                  <div className="training-content-order-copy">
                    <strong>{topic.name}</strong>
                    <small>{topic.status === "draft" ? "Draft" : "Archived"} · Not active</small>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

    </div>
  );
}
