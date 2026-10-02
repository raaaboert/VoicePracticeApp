import { requestJson } from "../lib/api";
import {
  createFocusTopicCatalogClient,
  createFocusTopicDetailClient,
} from "./client";

export const fetchFocusTopicCatalog = createFocusTopicCatalogClient(requestJson);
export const fetchFocusTopicDetail = createFocusTopicDetailClient(requestJson);
