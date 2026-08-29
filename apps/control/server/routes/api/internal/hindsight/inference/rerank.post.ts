import { defineHandler } from "nitro";
import { handleHindsightInference } from "../../../../../hindsight-inference/hindsight-inference-route";

export default defineHandler((event) => handleHindsightInference(event.req, "rerank"));
