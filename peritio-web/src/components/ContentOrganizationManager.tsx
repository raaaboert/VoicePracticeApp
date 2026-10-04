"use client";

import { ArrowDown, ArrowUp, Check, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  CustomerTrainingPackOrderListResponse,
  CustomerTrainingPackOrderSummary,
  OrgTrainingListResponse,
  OrgTrainingSummary,
} from "@voicepractice/shared";

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

function moveItem<T extends { id: string }>(items: readonly T[], id: string, direction: -1 | 1): T[] {
  const index = items.findIndex((item) => item.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items.slice();
  const next = items.slice();
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
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
  initialTrainingPacks,
  initialTrainingPackOrderRevision,
}: {
  orgId: string;
  initialFocusTopics: OrgTrainingSummary[];
  initialFocusTopicOrderRevision: string;
  initialTrainingPacks: CustomerTrainingPackOrderSummary[];
  initialTrainingPackOrderRevision: string;
}) {
  const initialActiveFocusTopics = projectActiveFocusTopicOrder(initialFocusTopics);
  const [focusTopicRecords, setFocusTopicRecords] = useState(initialFocusTopics);
  const [focusTopics, setFocusTopics] = useState(initialActiveFocusTopics);
  const [savedFocusTopicKey, setSavedFocusTopicKey] = useState(orderKey(initialActiveFocusTopics));
  const [focusTopicRevision, setFocusTopicRevision] = useState(initialFocusTopicOrderRevision);
  const [trainingPacks, setTrainingPacks] = useState(initialTrainingPacks);
  const [savedTrainingPackKey, setSavedTrainingPackKey] = useState(orderKey(initialTrainingPacks));
  const [trainingPackRevision, setTrainingPackRevision] = useState(initialTrainingPackOrderRevision);
  const [saving, setSaving] = useState<"focus-topics" | "training-packs" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const focusTopicsDirty = orderKey(focusTopics) !== savedFocusTopicKey;
  const trainingPacksDirty = orderKey(trainingPacks) !== savedTrainingPackKey;
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
      if (focusTopicsDirty || trainingPacksDirty) event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [focusTopicsDirty, trainingPacksDirty]);

  const beginAction = (kind: "focus-topics" | "training-packs") => {
    setSaving(kind);
    setMessage(null);
    setError(null);
  };

  const saveFocusTopics = async () => {
    beginAction("focus-topics");
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
      setSaving(null);
    }
  };

  const saveTrainingPacks = async () => {
    beginAction("training-packs");
    try {
      const response = await fetchAdminApiJson<CustomerTrainingPackOrderListResponse>(
        `/api/admin/content-organization/training-packs?orgId=${encodeURIComponent(orgId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedOrderRevision: trainingPackRevision,
            trainingPackIds: trainingPacks.map((pack) => pack.id),
          }),
        }
      );
      setTrainingPacks(response.packs);
      setSavedTrainingPackKey(orderKey(response.packs));
      setTrainingPackRevision(response.orderRevision);
      setMessage("Training Pack order saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save Training Pack order.");
    } finally {
      setSaving(null);
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
            disabled={!focusTopicsDirty || saving !== null}
          >
            {saving === "focus-topics"
              ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
              : <Check size={17} aria-hidden="true" />}
            Save company order
          </button>
        </div>
        <OrderList
          items={focusTopics}
          label={(topic) => topic.name}
          describe={(_topic, index) => `Position ${index + 1}`}
          saving={saving !== null}
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

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="eyebrow">Delivery configuration</p>
            <h2>Training Packs</h2>
            <p className="muted-copy">Organize Training Packs for customer administration. Order does not change assignments or scoring.</p>
          </div>
          <button
            className="primary-button icon-text-button"
            type="button"
            onClick={saveTrainingPacks}
            disabled={!trainingPacksDirty || saving !== null}
          >
            {saving === "training-packs"
              ? <LoaderCircle size={17} className="spin" aria-hidden="true" />
              : <Check size={17} aria-hidden="true" />}
            Save order
          </button>
        </div>
        <OrderList
          items={trainingPacks}
          label={(pack) => pack.title}
          describe={(pack, index) => `Position ${index + 1} · ${pack.active ? "Active" : "Inactive"}`}
          saving={saving !== null}
          onMove={(id, direction) => {
            setTrainingPacks((current) => moveItem(current, id, direction));
            setMessage(null);
            setError(null);
          }}
        />
      </section>
    </div>
  );
}
