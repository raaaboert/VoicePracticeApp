import { requestJson } from "../lib/api";
import { createFocusTopicCatalogClient } from "./client";

export const fetchFocusTopicCatalog = createFocusTopicCatalogClient(requestJson);
