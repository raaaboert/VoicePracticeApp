import type {
  CustomerTrainingPackOrderListResponse,
  CustomerTrainingPackOrderSummary,
} from "@voicepractice/shared";

function minimizeTrainingPack(
  pack: CustomerTrainingPackOrderSummary
): CustomerTrainingPackOrderSummary {
  return {
    id: pack.id,
    title: pack.title,
    active: pack.active,
    displayOrder: pack.displayOrder,
  };
}

export function minimizeCustomerTrainingPackOrderResponse(
  response: CustomerTrainingPackOrderListResponse
): CustomerTrainingPackOrderListResponse {
  return {
    generatedAt: response.generatedAt,
    orgId: response.orgId,
    packs: response.packs.map(minimizeTrainingPack),
    orderRevision: response.orderRevision,
  };
}
